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
        this.config = JSON.parse(raw);
        return this.config;
      } catch (e) {
        console.error('❌ Lỗi khi đọc file runtime/account_profiles.json:', e.message);
      }
    }

    // Default configuration: Cụm 1 (Default + Profile 1)
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
    return this.config;
  }

  saveConfig() {
    try {
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
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
   * Xoay vòng (luân phiên) tài khoản đang chạy của một Cụm.
   * Tìm tài khoản tiếp theo chưa bị giam trong danh sách profiles và set làm active_profile.
   */
  rotateClusterProfile(clusterId) {
    this.loadConfig();
    const cluster = this.config.clusters?.find(c => c.cluster_id === clusterId);
    if (!cluster || !cluster.profiles || cluster.profiles.length <= 1) {
      return null; // Không có gì để xoay
    }

    const currentIndex = cluster.profiles.indexOf(cluster.active_profile);
    let chosenProfile = null;

    for (let i = 1; i <= cluster.profiles.length; i++) {
      const candidateIndex = (currentIndex + i) % cluster.profiles.length;
      const candidate = cluster.profiles[candidateIndex];

      if (!this.isProfileBlocked(candidate)) {
        chosenProfile = candidate;
        break;
      } else {
        console.warn(`[⚠️] Profile "${candidate}" của Cụm ${clusterId} đang bị giam Block Spam, bỏ qua...`);
      }
    }

    if (!chosenProfile || chosenProfile === cluster.active_profile) {
      if (this.isProfileBlocked(cluster.active_profile)) {
        console.warn(`[⚠️] Cụm ${clusterId} tất cả profiles đều bị giam Block Spam!`);
      } else {
        console.log(`[ℹ️] Cụm ${clusterId} giữ nguyên profile active: ${cluster.active_profile}`);
      }
      return null;
    }

    const oldProfile = cluster.active_profile;
    cluster.active_profile = chosenProfile;
    console.log(`[🔄] Cụm ${clusterId} đã đổi ca làm việc: ${oldProfile || "None"} -> ${chosenProfile}`);
    
    this.saveConfig();
    return chosenProfile;
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
         account_name = EXCLUDED.account_name, 
         cluster_id = EXCLUDED.cluster_id, 
         status = 'active',
         updated_at = CURRENT_TIMESTAMP`,
      [activeProfile, String(botUid), accountName, clusterId]
    );

    console.log(`[👤] Đã liên kết Profile "${activeProfile}" với UID: ${botUid} (Cụm ${clusterId}).`);
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

    console.log(`[🔄] Đang trích xuất appstate mới từ Brave cho acc dự phòng nội bộ cụm: "${newActiveProfile}"...`);
    try {
      const res = spawnSync("node", [path.join(__dirname, "../../export-appstate.js"), "--no-restart"], { stdio: "inherit" });
      if (res.status === 0 && fs.existsSync(APPSTATE_PATH)) {
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
