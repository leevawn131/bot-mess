const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { execute } = require('../../modules/utils/database');
const { ensureAccountClusterSchema } = require('../../modules/utils/accountSchema');

const CONFIG_PATH = path.join(__dirname, '../../runtime/account_profiles.json');
const APPSTATE_PATH = path.join(__dirname, '../../runtime/appstate.json');
const ACTIVE_PROFILE_PATH = path.join(__dirname, '../../runtime/active_profile.json');

class AccountProfilesManager {
  constructor() {
    this.config = null;
  }

  loadConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        if (raw && raw.trim().length > 0) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.clusters) && parsed.clusters.length > 0) {
            this.config = parsed;
            return this.config;
          }
        }
      } catch (e) {
        console.error('❌ Lỗi khi đọc file runtime/account_profiles.json:', e.message);
        // Nếu đã có cấu hình trong bộ nhớ thì giữ nguyên, TUYỆT ĐỐI KHÔNG GHI ĐÈ XÓA FILE CỦA USER
        if (this.config && Array.isArray(this.config.clusters) && this.config.clusters.length > 0) {
          return this.config;
        }
      }
    }

    if (this.config && Array.isArray(this.config.clusters) && this.config.clusters.length > 0) {
      return this.config;
    }

    // Chỉ khởi tạo mặc định nếu file hoàn toàn chưa từng tồn tại
    if (!fs.existsSync(CONFIG_PATH)) {
      this.config = {
        max_groups_per_account: 5,
        clusters: [
          {
            cluster_id: 1,
            name: "Cụm 1",
            active_profile: "Default",
            profiles: ["Default", "Profile 1"]
          }
        ]
      };
      this.saveConfig();
    }
    return this.config;
  }

  saveConfig() {
    try {
      if (!this.config || !Array.isArray(this.config.clusters) || this.config.clusters.length === 0) {
        return; // Chống ghi đè dữ liệu rỗng
      }
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tempPath = `${CONFIG_PATH}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.config, null, 2), 'utf8');
      fs.renameSync(tempPath, CONFIG_PATH);
    } catch (e) {
      console.error('❌ Lỗi khi lưu file runtime/account_profiles.json:', e.message);
    }
  }

  /**
   * Tự động bổ sung Cụm mới (mỗi Cụm 2 acc, 1 active, 1 reserve) khi số nhóm thuê vượt quá 5 nhóm
   */
  ensureEnoughClusters(neededClustersCount) {
    this.loadConfig();
    if (!Array.isArray(this.config.clusters)) {
      this.config.clusters = [];
    }

    let currentCount = this.config.clusters.length;
    if (currentCount >= neededClustersCount) return this.config;

    for (let c = currentCount + 1; c <= neededClustersCount; c++) {
      const p1Index = (c - 1) * 2;
      const p2Index = (c - 1) * 2 + 1;
      const p1Name = p1Index === 0 ? "Default" : `Profile ${p1Index}`;
      const p2Name = `Profile ${p2Index}`;

      this.config.clusters.push({
        cluster_id: c,
        name: `Cụm ${c}`,
        active_profile: p1Name,
        profiles: [p1Name, p2Name]
      });
    }

    console.log(`[✨] Tự động bổ sung Cụm ${neededClustersCount} (mỗi cụm 2 acc, 1 chạy chính + 1 dự phòng nội bộ cụm).`);
    this.saveConfig();
    return this.config;
  }

  /**
   * Lấy danh sách duy nhất 1 Profile đang active chạy chính của mỗi Cụm
   * Ví dụ: Cụm 1 (Default), Cụm 2 (Profile 2) => ["Default", "Profile 2"]
   */
  getActiveProfilesToRun() {
    this.loadConfig();
    const activeProfiles = [];

    for (const cluster of this.config.clusters || []) {
      if (cluster.enabled === false || cluster.status === 'paused' || cluster.status === 'disabled') {
        continue;
      }
      const activeProf = cluster.active_profile || (cluster.profiles ? cluster.profiles[0] : null);
      if (activeProf && !activeProfiles.includes(activeProf)) {
        activeProfiles.push(activeProf);
      }
    }

    return activeProfiles;
  }

  /**
   * Kiểm tra xem Profile có đang bị giam do Block Spam hay không
   */
  isProfileBlocked(profileName) {
    try {
      const blockedPath = path.join(__dirname, '../../runtime/blocked_accounts.json');
      if (fs.existsSync(blockedPath)) {
        const data = JSON.parse(fs.readFileSync(blockedPath, 'utf8'));
        if (data && data[profileName] && data[profileName].unblockAt) {
          if (data[profileName].unblockAt > Date.now()) {
            return true;
          }
        }
      }
    } catch (e) {}
    return false;
  }

  /**
   * Kiểm tra xem Profile có đang bị dính Checkpoint/khóa nick hay không
   */
  isProfileCheckpointed(profileName) {
    try {
      const cpPath = path.join(__dirname, '../../runtime/checkpoint_accounts.json');
      if (fs.existsSync(cpPath)) {
        const data = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
        if (data && data[profileName]) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  markProfileCheckpoint(profileName, uid = null, accountName = null) {
    try {
      const cpPath = path.join(__dirname, '../../runtime/checkpoint_accounts.json');
      let data = {};
      if (fs.existsSync(cpPath)) {
        try { data = JSON.parse(fs.readFileSync(cpPath, 'utf8')); } catch (e) {}
      }
      data[profileName] = {
        checkpointAt: new Date().toISOString(),
        uid: uid || (data[profileName]?.uid) || null,
        accountName: accountName || (data[profileName]?.accountName) || null
      };
      const dir = path.dirname(cpPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cpPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
  }

  clearProfileCheckpoint(profileName) {
    try {
      const cpPath = path.join(__dirname, '../../runtime/checkpoint_accounts.json');
      if (fs.existsSync(cpPath)) {
        const data = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
        if (data && data[profileName]) {
          delete data[profileName];
          fs.writeFileSync(cpPath, JSON.stringify(data, null, 2), 'utf8');
        }
      }
    } catch (e) {}
  }

  /**
   * Xoay vòng (luân phiên) tài khoản đang chạy của một Cụm.
   * Tìm tài khoản tiếp theo chưa bị giam trong danh sách profiles và set làm active_profile.
   */
  rotateClusterProfile(clusterId) {
    this.loadConfig();
    const cluster = this.config.clusters?.find(c => c.cluster_id === clusterId);
    if (!cluster || !cluster.profiles || cluster.profiles.length <= 1) {
      console.warn(`[ℹ️ CỤM ${clusterId}] Cụm này chỉ đang cấu hình 1 profile (${cluster?.profiles?.join(', ') || 'trống'}) trong account_profiles.json nên giữ nguyên ca, không có nick thứ 2 để đổi.`);
      return null; // Không có gì để xoay
    }

    const currentIndex = cluster.profiles.indexOf(cluster.active_profile);
    let chosenProfile = null;

    for (let i = 1; i <= cluster.profiles.length; i++) {
      const candidateIndex = (currentIndex + i) % cluster.profiles.length;
      const candidate = cluster.profiles[candidateIndex];

      if (this.isProfileBlocked(candidate)) {
        console.warn(`[⚠️] Profile "${candidate}" của Cụm ${clusterId} đang bị giam Block Spam, bỏ qua...`);
        continue;
      }
      if (this.isProfileCheckpointed(candidate)) {
        console.warn(`[⚠️] Profile "${candidate}" của Cụm ${clusterId} đang dính Checkpoint, bỏ qua xoay ca...`);
        continue;
      }
      chosenProfile = candidate;
      break;
    }

    if (!chosenProfile || chosenProfile === cluster.active_profile) {
      if (this.isProfileBlocked(cluster.active_profile) || this.isProfileCheckpointed(cluster.active_profile)) {
        console.warn(`[⚠️] Cụm ${clusterId} tất cả profiles đều bị giam Block Spam hoặc dính Checkpoint!`);
      } else {
        console.log(`[ℹ️] Cụm ${clusterId} giữ nguyên profile active: ${cluster.active_profile} (các nick khác đang bị giam/checkpoint)`);
      }
      return null;
    }

    const oldProfile = cluster.active_profile;
    cluster.active_profile = chosenProfile;
    cluster.last_rotated_at = new Date().toISOString();
    console.log(`[🔄] Cụm ${clusterId} đã đổi ca làm việc: ${oldProfile || "None"} -> ${chosenProfile}`);
    
    this.saveConfig();
    return chosenProfile;
  }

  /**
   * Tạm ngưng 1 Cụm (có hoặc không có hẹn giờ tự động bật lại)
   */
  pauseCluster(clusterId, durationMs = null) {
    this.loadConfig();
    const cluster = this.config.clusters?.find(c => String(c.cluster_id) === String(clusterId));
    if (!cluster) return { success: false, message: `Không tìm thấy Cụm ${clusterId}` };

    cluster.enabled = false;
    cluster.status = 'paused';
    if (durationMs && durationMs > 0) {
      cluster.enable_at = new Date(Date.now() + durationMs).toISOString();
    } else {
      delete cluster.enable_at;
    }

    this.saveConfig();
    return { success: true, cluster, enable_at: cluster.enable_at };
  }

  /**
   * Bật lại 1 Cụm ngay lập tức
   */
  resumeCluster(clusterId) {
    this.loadConfig();
    const cluster = this.config.clusters?.find(c => String(c.cluster_id) === String(clusterId));
    if (!cluster) return { success: false, message: `Không tìm thấy Cụm ${clusterId}` };

    cluster.enabled = true;
    cluster.status = 'active';
    delete cluster.enable_at;

    this.saveConfig();
    return { success: true, cluster };
  }

  /**
   * Đọc thông tin Profile đang chạy từ runtime/active_profile.json
   */
  getActiveProfileName() {
    if (fs.existsSync(ACTIVE_PROFILE_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(ACTIVE_PROFILE_PATH, 'utf8'));
        if (data && data.profileDir) return data.profileDir;
      } catch (e) {}
    }
    return "Default";
  }

  /**
   * Lấy thông tin Profile và Cụm dựa theo UID của tài khoản Facebook
   */
  async getProfileInfoByUid(botUid) {
    if (!botUid) return null;
    await ensureAccountClusterSchema();
    const rows = await execute(
      `SELECT profile_name, cluster_id, status FROM profile_accounts WHERE uid = ?`,
      [String(botUid)]
    );
    if (rows && rows.length > 0) {
      return {
        profileName: rows[0].profile_name,
        clusterId: rows[0].cluster_id,
        status: rows[0].status
      };
    }
    return null;
  }

  /**
   * Ghi nhận UID & Facebook Name cho Profile đang chạy
   */
  async registerActiveAccount(profileName, botUid, accountName = "") {
    await ensureAccountClusterSchema();
    this.loadConfig();
    const activeProfile = profileName || this.getActiveProfileName();

    let clusterId = 1;
    for (const c of this.config.clusters || []) {
      if (c.profiles && c.profiles.includes(activeProfile)) {
        clusterId = c.cluster_id;
        break;
      }
    }

    await execute(
      `INSERT INTO profile_accounts (profile_name, uid, account_name, cluster_id, status)
       VALUES (?, ?, ?, ?, 'active')
       ON CONFLICT(profile_name) DO UPDATE SET 
         uid = EXCLUDED.uid, 
         account_name = CASE WHEN EXCLUDED.account_name IS NOT NULL AND EXCLUDED.account_name != '' THEN EXCLUDED.account_name ELSE profile_accounts.account_name END, 
         cluster_id = EXCLUDED.cluster_id, 
         status = 'active',
         updated_at = CURRENT_TIMESTAMP`,
      [activeProfile, String(botUid), accountName || "", clusterId]
    );

    console.log(`[👤] Đã liên kết Profile "${activeProfile}" với UID: ${botUid}${accountName ? ` (${accountName})` : ''} (Cụm ${clusterId}).`);
  }

  /**
   * Kiểm tra tính hợp lệ của tài khoản trước khi cho phép Worker chạy:
   * 1. Profile phải thuộc đúng ClusterId trong account_profiles.json.
   * 2. UID không được trùng với UID đang active của Cụm khác trong database.
   */
  async verifyAccountCluster(profileName, botUid, clusterId) {
    await ensureAccountClusterSchema();
    this.loadConfig();

    const cId = Number(clusterId);
    const uidStr = String(botUid);
    const activeProfile = profileName || this.getActiveProfileName();

    // 1. Kiểm tra profile có nằm trong Cụm chỉ định không
    let assignedCluster = null;
    for (const c of this.config.clusters || []) {
      if (c.profiles && c.profiles.includes(activeProfile)) {
        assignedCluster = c.cluster_id;
        break;
      }
    }

    if (assignedCluster && assignedCluster !== cId) {
      return {
        valid: false,
        reason: "profile_wrong_cluster",
        registeredCluster: assignedCluster,
        message: `Profile "${activeProfile}" thuộc về Cụm ${assignedCluster}, không được phép chạy ở Cụm ${cId}!`
      };
    }

    // 2. Kiểm tra xem UID này có đang được gán active cho một Profile của Cụm khác không
    const rows = await execute(
      `SELECT profile_name, cluster_id, status FROM profile_accounts WHERE uid = ? AND status = 'active'`,
      [uidStr]
    );

    if (rows && rows.length > 0) {
      for (const row of rows) {
        if (row.profile_name !== activeProfile && Number(row.cluster_id) !== cId) {
          return {
            valid: false,
            reason: "uid_duplicate_across_clusters",
            registeredCluster: row.cluster_id,
            registeredProfile: row.profile_name,
            message: `Tài khoản UID ${uidStr} đang được gán cho Profile "${row.profile_name}" (Cụm ${row.cluster_id}), không được phép chạy ở Cụm ${cId}!`
          };
        }
      }
    }

    return { valid: true };
  }

  async syncWithDatabase() {
    await ensureAccountClusterSchema();
    this.loadConfig();

    for (const cluster of this.config.clusters || []) {
      for (const profileName of cluster.profiles || []) {
        const isActive = profileName === cluster.active_profile ? 'active' : 'reserve';
        await execute(
          `INSERT INTO profile_accounts (profile_name, cluster_id, status)
           VALUES (?, ?, ?)
           ON CONFLICT(profile_name) DO UPDATE SET cluster_id = EXCLUDED.cluster_id, status = EXCLUDED.status`,
          [profileName, cluster.cluster_id, isActive]
        );
      }
    }
  }

  /**
   * Kích hoạt chuyển đổi sang acc dự phòng NỘI BỘ TRONG CỤM ĐÓ khi acc active bị checkpoint/logout
   */
  async switchProfileOnCheckpoint(failedProfileName, clusterId = 1) {
    await ensureAccountClusterSchema();
    this.loadConfig();

    console.warn(`[⚠️] Profile "${failedProfileName}" (Cụm ${clusterId}) bị dính checkpoint/logout.`);

    let failedUid = null;
    let failedAccName = null;
    try {
      const rows = await execute(
        `SELECT uid, account_name FROM profile_accounts WHERE profile_name = ?`,
        [failedProfileName]
      );
      if (rows && rows.length > 0) {
        failedUid = rows[0].uid;
        failedAccName = rows[0].account_name;
      }
    } catch (e) {}

    this.markProfileCheckpoint(failedProfileName, failedUid, failedAccName);

    // Đánh dấu profile lỗi thành checkpoint
    await execute(
      `UPDATE profile_accounts SET status = 'checkpoint', updated_at = CURRENT_TIMESTAMP WHERE profile_name = ?`,
      [failedProfileName]
    );

    let targetCluster = null;
    for (const c of this.config.clusters || []) {
      if (c.cluster_id === clusterId || (c.profiles && c.profiles.includes(failedProfileName))) {
        targetCluster = c;
        break;
      }
    }

    if (!targetCluster) {
      console.error(`❌ Không tìm thấy Cụm ${clusterId} để thay thế profile!`);
      return null;
    }

    // Lấy profile còn lại TRONG NỘI BỘ CỤM ĐÓ
    const remainingProfiles = (targetCluster.profiles || []).filter(p => p !== failedProfileName);
    if (remainingProfiles.length === 0) {
      console.error(`❌ Cụm ${clusterId} không còn profile dự phòng nội bộ nào!`);
      return null;
    }

    const newActiveProfile = remainingProfiles[0];
    targetCluster.active_profile = newActiveProfile;
    console.log(`[🔄] Chuyển đổi acc nội bộ Cụm ${clusterId}: Profile "${failedProfileName}" ➡️ "${newActiveProfile}"`);

    this.saveConfig();

    await execute(
      `UPDATE profile_accounts SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE profile_name = ?`,
      [newActiveProfile]
    );

    // 1. Kiểm tra nếu newActiveProfile đã có sẵn appstate hợp lệ trong runtime/appstates
    const appstatesDir = path.join(__dirname, '../../runtime/appstates');
    const newProfileAppstatePath = path.join(appstatesDir, `appstate_${newActiveProfile}.json`);
    if (fs.existsSync(newProfileAppstatePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(newProfileAppstatePath, 'utf8'));
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`[✅] Acc dự phòng "${newActiveProfile}" đã có sẵn appstate hợp lệ. Kích hoạt ngay cho Cụm ${clusterId}!`);
          return newActiveProfile;
        }
      } catch (e) {}
    }

    console.log(`[🔄] Đang trích xuất appstate mới từ Brave cho acc dự phòng nội bộ cụm: "${newActiveProfile}"...`);
    try {
      const res = spawnSync("node", [path.join(__dirname, "../../export-appstate.js"), newActiveProfile, "--no-restart"], { stdio: "inherit" });
      if (res.status === 0 && (fs.existsSync(newProfileAppstatePath) || fs.existsSync(APPSTATE_PATH))) {
        console.log(`[✅] Đã kích hoạt thành công acc dự phòng "${newActiveProfile}" cho Cụm ${clusterId}.`);
        return newActiveProfile;
      }
    } catch (err) {
      console.error(`❌ Lỗi khi lấy appstate cho acc dự phòng "${newActiveProfile}":`, err.message);
    }

    return newActiveProfile;
  }
}

module.exports = new AccountProfilesManager();
