const fs = require("fs");
const path = require("path");
const { execute } = require("../../utils/database");
const accountProfilesManager = require("../../../src/managers/accountProfilesManager");
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { ensureAccountClusterSchema } = require("../../utils/accountSchema");

function parseDuration(str) {
  if (!str) return null;
  const raw = String(str).trim().toLowerCase();
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(s|giay|m|p|phut|h|g|tieng|d|ngay)$/);
  if (!match) return null;

  const val = parseFloat(match[1]);
  const unit = match[2];

  if (unit === 's' || unit === 'giay') return val * 1000;
  if (unit === 'm' || unit === 'p' || unit === 'phut') return val * 60 * 1000;
  if (unit === 'h' || unit === 'g' || unit === 'tieng') return val * 60 * 60 * 1000;
  if (unit === 'd' || unit === 'ngay') return val * 24 * 60 * 60 * 1000;
  return null;
}

function parseTargetTimestamp(rawText) {
  let text = String(rawText || "").trim().toLowerCase();
  text = text.replace(/^(?:on\s+at|at|vào\s+lúc|luc)\s+/, "");

  const timeMatch = text.match(/(\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?|h(?:(\d{1,2}))?)/);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  let minutes = parseInt(timeMatch[2] || timeMatch[4] || "0", 10);
  let seconds = parseInt(timeMatch[3] || "0", 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }

  const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);

  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);

  let targetYear = vnNow.getUTCFullYear();
  let targetMonth = vnNow.getUTCMonth();
  let targetDate = vnNow.getUTCDate();

  if (dateMatch) {
    targetDate = parseInt(dateMatch[1], 10);
    targetMonth = parseInt(dateMatch[2], 10) - 1;
    if (dateMatch[3]) targetYear = parseInt(dateMatch[3], 10);
  }

  let targetUtcMs = Date.UTC(targetYear, targetMonth, targetDate, hours - 7, minutes, seconds);

  if (!dateMatch && targetUtcMs <= now.getTime()) {
    targetUtcMs += 24 * 60 * 60 * 1000;
  }

  return targetUtcMs;
}

function formatRemainingTime(ms) {
  if (ms <= 0) return "0s";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 1000)) / (60 * 1000));
  const secs = Math.floor((ms % (60 * 1000)) / 1000);

  const parts = [];
  if (days > 0) parts.push(`${days} ngày`);
  if (hours > 0) parts.push(`${hours} giờ`);
  if (mins > 0) parts.push(`${mins} phút`);
  if (secs > 0 && days === 0 && hours === 0) parts.push(`${secs} giây`);
  return parts.join(' ') || "ít hơn 1 phút";
}

async function executeCommand({ api, event, args, config }) {
  const { threadID, senderID, messageID } = event;
  const prefix = config?.prefix || process.env.BOT_PREFIX || "!";

  // 1. Kiểm tra quyền Admin Bot
  const adminIDs = getAdminBotUIDs();
  if (!adminIDs.includes(String(senderID))) {
    return api.sendMessage("⚠️ Chỉ Admin Bot mới có quyền dùng lệnh này.", threadID, messageID);
  }

  try {
    await ensureAccountClusterSchema();

    const rawArgs = args.join(" ").trim();
    const subCommand = String(args[0] || "list").toLowerCase();

    // 2. LỆNH ĐỐI SOÁT BOT HIỆN TẠI & NHÓM ĐƯỢC PHÂN CÔNG (CHECK)
    if (subCommand === "check") {
      const botUid = String(api.getCurrentUserID());
      const configProfiles = accountProfilesManager.loadConfig();

      let activeProfile = global.current_profile || null;
      let activeClusterId = null;

      // Tìm profile và cụm theo UID của chính bot này trong SQLite
      const profileInfo = await accountProfilesManager.getProfileInfoByUid(botUid);
      if (profileInfo) {
        activeProfile = profileInfo.profileName;
        activeClusterId = profileInfo.clusterId;
      }

      // Fallback nếu chưa có trong DB: dùng activeProfile mặc định
      if (!activeProfile) {
        activeProfile = accountProfilesManager.getActiveProfileName();
      }

      for (const c of configProfiles.clusters || []) {
        if (activeClusterId ? c.cluster_id === activeClusterId : (c.profiles && c.profiles.includes(activeProfile))) {
          activeClusterId = c.cluster_id;
          break;
        }
      }

      if (!activeClusterId) {
        activeClusterId = 1;
      }

      // 2.1. Lấy danh sách nhóm thuê được phân công cho Cụm này (loại trừ 2 box test và nhóm hết hạn)
      const assignedRows = await execute(
        `SELECT thread_id FROM group_profile_bindings 
         WHERE cluster_id = ? 
           AND thread_id NOT IN ('1523319575522034', '844251878447942')
           AND thread_id IN (SELECT thread_id FROM rented_groups WHERE is_stopped = 0 AND expire_date >= datetime('now', '-1 day', 'localtime'))`,
        [activeClusterId]
      );
      const allowedThreadIds = new Set((assignedRows || []).map(r => String(r.thread_id)));

      // 2.2. Lấy danh sách nhóm thực tế bot đang tham gia
      const threadList = await new Promise((resolve) => {
        api.getThreadList(100, null, ["INBOX"], (err, list) => {
          if (err || !list) return resolve([]);
          const groupThreads = list.filter(t => t.isGroup && t.threadID);
          resolve(groupThreads);
        });
      });

      // Lọc các nhóm KHÔNG thuộc phân công của Cụm này (ngoại trừ 2 box test)
      const actualThreadList = threadList.filter(t =>
        String(t.threadID) !== '1523319575522034' &&
        String(t.threadID) !== '844251878447942'
      );

      const invalidGroups = actualThreadList.filter(t => !allowedThreadIds.has(String(t.threadID)));

      let msg = `🤖 [ THÔNG TIN BOT HIỆN TẠI (UID: ${botUid}) ] 🤖\n━━━━━━━━━━━━━\n`;
      msg += `👤 Profile đang chạy: ${activeProfile} (Thuộc Cụm ${activeClusterId})\n`;
      msg += `✅ Số nhóm thuê phân công cho Cụm này: ${allowedThreadIds.size}\n`;
      msg += `🌐 Thực tế đang ở: ${actualThreadList.length} nhóm thuê (đã trừ 2 box test)\n`;
      msg += `⚠️ Số nhóm KHÔNG thuộc cụm này: ${invalidGroups.length}\n`;

      if (invalidGroups.length > 0) {
        msg += `\n📋 Danh sách TID cần rời đi:\n`;
        invalidGroups.forEach((g, idx) => {
          msg += `${idx + 1}. ${g.threadID} (${g.name || "Không tên"})\n`;
        });
        msg += `\n👉 Dùng lệnh "${prefix}cluster out" để bot tự động rời các nhóm này.`;
      } else {
        msg += `\n✨ Tuyệt vời! Bot đang ở đúng tất cả các nhóm được phân công.`;
      }

      return api.sendMessage(msg, threadID, messageID);
    }

    // 3. LỆNH TỰ ĐỘNG RỜI CÁC NHÓM SAI CỤM (OUT)
    if (subCommand === "out") {
      const botUid = String(api.getCurrentUserID());
      const configProfiles = accountProfilesManager.loadConfig();

      let activeProfile = global.current_profile || null;
      let activeClusterId = null;

      const profileInfo = await accountProfilesManager.getProfileInfoByUid(botUid);
      if (profileInfo) {
        activeProfile = profileInfo.profileName;
        activeClusterId = profileInfo.clusterId;
      }

      if (!activeProfile) {
        activeProfile = accountProfilesManager.getActiveProfileName();
      }

      for (const c of configProfiles.clusters || []) {
        if (activeClusterId ? c.cluster_id === activeClusterId : (c.profiles && c.profiles.includes(activeProfile))) {
          activeClusterId = c.cluster_id;
          break;
        }
      }

      if (!activeClusterId) activeClusterId = 1;

      const assignedRows = await execute(
        `SELECT thread_id FROM group_profile_bindings 
         WHERE cluster_id = ? 
           AND thread_id NOT IN ('1523319575522034', '844251878447942')
           AND thread_id IN (SELECT thread_id FROM rented_groups WHERE is_stopped = 0 AND expire_date >= datetime('now', '-1 day', 'localtime'))`,
        [activeClusterId]
      );
      const allowedThreadIds = new Set((assignedRows || []).map(r => String(r.thread_id)));

      const threadList = await new Promise((resolve) => {
        api.getThreadList(100, null, ["INBOX"], (err, list) => {
          if (err || !list) return resolve([]);
          const groupThreads = list.filter(t => t.isGroup && t.threadID);
          resolve(groupThreads);
        });
      });

      const actualThreadList = threadList.filter(t =>
        String(t.threadID) !== '1523319575522034' &&
        String(t.threadID) !== '844251878447942'
      );

      const invalidGroups = actualThreadList.filter(t => !allowedThreadIds.has(String(t.threadID)));

      if (invalidGroups.length === 0) {
        return api.sendMessage(`✅ Profile ${activeProfile} hiện không tham gia nhóm nào sai phân công của Cụm ${activeClusterId}.`, threadID, messageID);
      }

      api.sendMessage(`⏳ Đang tiến hành rời khỏi ${invalidGroups.length} nhóm không thuộc Cụm ${activeClusterId}...`, threadID, messageID);

      let successCount = 0;
      let failCount = 0;

      for (const group of invalidGroups) {
        try {
          await new Promise(resolve => {
            api.removeUserFromGroup(botUid, group.threadID, (err) => {
              if (err) failCount++;
              else successCount++;
              resolve();
            });
          });
          // Delay 1 giây giữa các lần gọi để tránh vi phạm giới hạn của Facebook
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {
          failCount++;
        }
      }

      let rsMsg = `✅ [ ĐÃ RỜI XONG CÁC NHÓM SAI CỤM ] ✅\n━━━━━━━━━━━━━\n`;
      rsMsg += `👤 Profile: ${activeProfile} (Cụm ${activeClusterId})\n`;
      rsMsg += `- Rời thành công: ${successCount} nhóm\n`;
      if (failCount > 0) rsMsg += `- Thất bại: ${failCount} nhóm\n`;

      return api.sendMessage(rsMsg, threadID, messageID);
    }

    // 4. LỆNH XEM DANH SÁCH ACC DÍNH CHECKPOINT (CP / CHECKPOINT)
    if (subCommand === "cp" || subCommand === "checkpoint") {
      const cpAccounts = await execute(
        `SELECT profile_name, uid, account_name, cluster_id, status, updated_at 
         FROM profile_accounts 
         WHERE status = 'checkpoint'`
      ).catch(() => []);

      const cpJsonPath = path.join(__dirname, "../../../runtime/checkpoint_accounts.json");
      let cpJson = {};
      if (fs.existsSync(cpJsonPath)) {
        try { cpJson = JSON.parse(fs.readFileSync(cpJsonPath, 'utf8')); } catch (e) {}
      }

      if ((!cpAccounts || cpAccounts.length === 0) && Object.keys(cpJson).length === 0) {
        return api.sendMessage("✨ Hiện tại toàn bộ tài khoản trong các Cụm đều hoạt động bình thường, không có nick nào dính checkpoint.", threadID, messageID);
      }

      let msg = `🚨 [ DANH SÁCH TÀI KHOẢN BỊ CHECKPOINT ] 🚨\n━━━━━━━━━━━━━\n\n`;
      const displayedProfiles = new Set();

      for (const acc of cpAccounts || []) {
        displayedProfiles.add(acc.profile_name);
        const name = acc.account_name && acc.account_name.trim() ? acc.account_name : "Chưa xác định tên";
        const uid = acc.uid || "Chưa có UID";
        const time = acc.updated_at ? new Date(acc.updated_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Không rõ";
        msg += `🔴 Tên tài khoản: ${name}\n`;
        msg += `   🆔 UID: ${uid}\n`;
        msg += `   📁 Profile: ${acc.profile_name} (Cụm ${acc.cluster_id || '?'})\n`;
        msg += `   ⏰ Thời điểm bị: ${time}\n\n`;
      }

      for (const [pName, data] of Object.entries(cpJson)) {
        if (!displayedProfiles.has(pName)) {
          msg += `🔴 Tên tài khoản: ${data.accountName || "Chưa xác định tên"}\n`;
          msg += `   🆔 UID: ${data.uid || "Chưa có UID"}\n`;
          msg += `   📁 Profile: ${pName}\n`;
          msg += `   ⏰ Thời điểm bị: ${data.checkpointAt ? new Date(data.checkpointAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Không rõ"}\n\n`;
        }
      }

      msg += `━━━━━━━━━━━━━\n`;
      msg += `👉 Sau khi gỡ checkpoint trên trình duyệt xong, gõ:\n   ${prefix}cluster uncp <Profile/UID> để phục hồi nick tham gia xoay ca.`;

      return api.sendMessage(msg.trim(), threadID, messageID);
    }

    // 5. LỆNH GỠ CỜ CHECKPOINT CHO ACC (UNCP / UNCHECKPOINT)
    if (subCommand === "uncp" || subCommand === "uncheckpoint") {
      const target = String(args[1] || "").trim();
      if (!target) {
        return api.sendMessage(`⚠️ Vui lòng nhập tên Profile hoặc UID cần gỡ cờ checkpoint!\nVí dụ: ${prefix}cluster uncp Profile 1 hoặc ${prefix}cluster uncp 100054150197536`, threadID, messageID);
      }

      await execute(
        `UPDATE profile_accounts SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE profile_name = ? OR uid = ?`,
        [target, target]
      );
      accountProfilesManager.clearProfileCheckpoint(target);

      return api.sendMessage(`✅ Đã gỡ cờ checkpoint cho tài khoản [${target}]. Nick này đã có thể tiếp tục tham gia xoay ca trong Cụm!`, threadID, messageID);
    }

    // 6. LỆNH XEM TỔNG QUAN TẤT CẢ CÁC CỤM (LIST / ALL HOẶC KHÔNG THAM SỐ)
    if (!args[0] || subCommand === "list" || subCommand === "all") {
      accountProfilesManager.loadConfig();
      const clusters = accountProfilesManager.config.clusters || [];

      if (clusters.length === 0) {
        return api.sendMessage("📭 Hiện tại chưa có Cụm nào được cấu hình trong hệ thống.", threadID, messageID);
      }

      let msg = "👑 [ QUẢN LÝ CÁC CỤM TÀI KHOẢN BOT ] 👑\n━━━━━━━━━━━━━\n\n";

      const profileAccounts = await execute("SELECT profile_name, uid, account_name, status FROM profile_accounts").catch(() => []);
      const uidOccurrences = {};
      const cpMap = new Map();
      (profileAccounts || []).forEach(acc => {
        if (acc.uid && acc.status === 'active') {
          uidOccurrences[acc.uid] = (uidOccurrences[acc.uid] || 0) + 1;
        }
        if (acc.status === 'checkpoint') {
          cpMap.set(acc.profile_name, acc);
        }
      });
      const accountMap = new Map((profileAccounts || []).map(a => [a.profile_name, a.uid]));
      const nameMap = new Map((profileAccounts || []).map(a => [a.profile_name, a.account_name]));

      // Sử dụng path.resolve(__dirname) tuyệt đối tuân thủ GLOBAL __dirname MANDATE
      const rootDbDir = path.resolve(__dirname, "../../../Horizon_Database");

      for (const c of clusters) {
        const isPaused = c.enabled === false || c.status === "paused" || c.status === "disabled";
        const statusIcon = isPaused ? "🔴 [TẠM NGƯNG]" : "🟢 [ĐANG CHẠY]";
        const activeProf = c.active_profile || "Chưa có";
        const allProfs = Array.isArray(c.profiles) ? c.profiles.join(", ") : "Trống";
        const uid = accountMap.get(activeProf) || "Chưa có UID";

        const isDuplicate = uid && uid !== "Chưa có UID" && uidOccurrences[uid] > 1;
        const dupWarning = isDuplicate ? " 🚨 [TRÙNG UID VỚI CỤM KHÁC]" : "";

        let e2eeStatus = "⚪ Chưa cấu hình";
        if (uid && uid !== "Chưa có UID") {
          const uidDeviceStore = path.join(rootDbDir, String(uid), "device-store.json");
          const legacyDeviceStore = path.join(rootDbDir, "device-store.json");
          if (fs.existsSync(uidDeviceStore) || fs.existsSync(legacyDeviceStore)) {
            e2eeStatus = "🟢 Hoạt động (Signal E2EE)";
          } else {
            e2eeStatus = "🔴 Chưa có keys";
          }
        }

        let groupCount = 0;
        try {
          const rows = await execute(
            `SELECT COUNT(*) as cnt FROM group_profile_bindings 
             WHERE cluster_id = ? 
               AND thread_id NOT IN ('1523319575522034', '844251878447942')
               AND thread_id IN (SELECT thread_id FROM rented_groups WHERE is_stopped = 0 AND expire_date >= datetime('now', '-1 day', 'localtime'))`,
            [c.cluster_id]
          );
          if (rows && rows[0]) groupCount = rows[0].cnt;
        } catch (e) { }

        msg += `${statusIcon} ${c.name || `Cụm ${c.cluster_id}`} (ID: ${c.cluster_id})\n`;
        const activeName = nameMap.get(activeProf) ? `${nameMap.get(activeProf)} ` : "";
        msg += `👤 Nick trực ca: ${activeName}[${activeProf}] (UID: ${uid})${dupWarning}\n`;
        msg += `🔒 Mã hóa E2EE: ${e2eeStatus}\n`;
        msg += `🔄 Danh sách xoay: [ ${allProfs} ]\n`;

        // Hiển thị nick bị dính checkpoint trong Cụm (nếu có)
        const cpInCluster = (c.profiles || []).filter(p => cpMap.has(p) || accountProfilesManager.isProfileCheckpointed(p)).map(p => {
          const cp = cpMap.get(p);
          const nameStr = cp && cp.account_name ? `${cp.account_name} (${cp.uid || 'Chưa có UID'})` : (cp?.uid || p);
          return `${p}: ${nameStr}`;
        });
        if (cpInCluster.length > 0) {
          msg += `🚨 Nick dính checkpoint: ${cpInCluster.join("; ")}\n`;
        }

        msg += `📊 Nhóm phụ trách: ${groupCount} nhóm thuê còn hạn\n`;

        if (isPaused) {
          if (c.enable_at) {
            const enableTime = new Date(c.enable_at).getTime();
            const remainMs = enableTime - Date.now();
            if (remainMs > 0) {
              msg += `⏳ Hẹn giờ tự bật lại: sau ${formatRemainingTime(remainMs)}\n`;
              msg += `⏰ Thời điểm bật: ${new Date(c.enable_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}\n`;
            } else {
              msg += `⏳ Hẹn giờ tự bật lại: Sắp bật trong vòng 1 phút tới...\n`;
            }
          } else {
            msg += `⏸️ Tạm ngưng vô thời hạn (Gõ ${prefix}cluster on ${c.cluster_id} để bật lại)\n`;
          }
        } else {
          if (c.last_rotated_at) {
            const elapsedMs = Date.now() - new Date(c.last_rotated_at).getTime();
            const remainRotate = Math.max(0, 2 * 60 * 60 * 1000 - elapsedMs);
            if (c.profiles && c.profiles.length > 1) {
              msg += `🔄 Lần đổi ca tiếp theo: sau ${formatRemainingTime(remainRotate)}\n`;
            }
          }
        }

        msg += "────────────────────\n";
      }

      msg += `\n📌 CÁC LỆNH ĐIỀU KHIỂN CỤM:\n`;
      msg += `👉 ${prefix}cluster check (Đối soát bot hiện tại & nhóm được gán)\n`;
      msg += `👉 ${prefix}cluster out (Tự động rời nhóm sai phân công)\n`;
      msg += `👉 ${prefix}cluster cp (Xem danh sách tài khoản dính checkpoint)\n`;
      msg += `👉 ${prefix}cluster uncp <Profile/UID> (Gỡ cờ checkpoint sau khi mở khóa)\n`;
      msg += `👉 ${prefix}cluster on <id> (Bật lại Cụm ngay)\n`;
      msg += `👉 ${prefix}cluster off <id> (Tắt Cụm vô thời hạn)\n`;
      msg += `👉 ${prefix}cluster pause <id> <thời gian> (VD: ${prefix}cluster pause 3 2h)\n`;
      msg += `👉 ${prefix}cluster <id> on at <giờ> (VD: ${prefix}cluster 1 on at 06:00)\n`;
      msg += `👉 ${prefix}cluster rotate <id> (Đổi ca nick ngay)`;

      return api.sendMessage(msg, threadID, messageID);
    }

    // 5. PHÂN TÍCH THAM SỐ CÁC LỆNH ĐIỀU KHIỂN (ON / OFF / PAUSE / ROTATE / AT)
    let clusterId = null;
    let action = null;
    let timeParam = null;

    if (/^\d+$/.test(args[0])) {
      clusterId = parseInt(args[0], 10);
      action = String(args[1] || "").toLowerCase();
      timeParam = args.slice(2).join(" ").trim();
    } else {
      action = String(args[0] || "").toLowerCase();
      clusterId = parseInt(args[1], 10);
      timeParam = args.slice(2).join(" ").trim();
    }

    // 5.1. HẸN GIỜ BẬT THEO THỜI GIAN CỤ THỂ ("on at", "at", "vào lúc", "luc")
    if (rawArgs.includes(" at ") || rawArgs.includes(" vào lúc ") || rawArgs.includes(" luc ") || action === "at") {
      if (!clusterId || isNaN(clusterId)) {
        return api.sendMessage(`⚠️ Vui lòng nhập đúng ID Cụm!\nVí dụ: ${prefix}cluster 1 on at 06:00`, threadID, messageID);
      }

      const targetTimestamp = parseTargetTimestamp(rawArgs);
      if (!targetTimestamp) {
        return api.sendMessage(`❌ Định dạng thời gian không hợp lệ!\nVí dụ đúng:\n- ${prefix}cluster 1 on at 06:00 (6h sáng)\n- ${prefix}cluster 1 on at 18:30 (6h30 tối)\n- ${prefix}cluster 1 on at 06:00 25/08 (6h sáng ngày 25/08)`, threadID, messageID);
      }

      const durationMs = targetTimestamp - Date.now();
      if (durationMs <= 0) {
        return api.sendMessage(`❌ Thời gian hẹn phải ở trong tương lai!`, threadID, messageID);
      }

      const res = accountProfilesManager.pauseCluster(clusterId, durationMs);
      if (!res.success) {
        return api.sendMessage(`❌ ${res.message}`, threadID, messageID);
      }

      const exactTime = new Date(targetTimestamp).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
      const remainStr = formatRemainingTime(durationMs);

      let reply = `⏰ [ ĐÃ HẸN GIỜ BẬT CỤM ${clusterId} ] ⏰\n━━━━━━━━━━━━━\n`;
      reply += `🏷️ Tên: ${res.cluster.name || `Cụm ${clusterId}`}\n`;
      reply += `👤 Nick trực ca: ${res.cluster.active_profile}\n`;
      reply += `⏳ Tự động bật lại sau: ${remainStr}\n`;
      reply += `🎯 Thời điểm bật chính xác: ${exactTime}\n\n`;
      reply += `💡 Cụm ${clusterId} sẽ tạm ngưng từ bây giờ và tự động kích hoạt luồng con chạy lại lúc ${exactTime}!`;

      return api.sendMessage(reply, threadID, messageID);
    }

    // 5.2. TẠM NGƯNG CỤM (PAUSE / OFF / TẠM DỪNG)
    if (action === "pause" || action === "tamdung" || action === "off") {
      if (!clusterId || isNaN(clusterId)) {
        return api.sendMessage(`⚠️ Vui lòng nhập ID Cụm cần tạm ngưng!\nVí dụ:\n- ${prefix}cluster pause 3 2h (Tạm ngưng 2 tiếng)\n- ${prefix}cluster pause 3 30m (Tạm ngưng 30 phút)\n- ${prefix}cluster 3 off (Tắt vô thời hạn)`, threadID, messageID);
      }

      let durationMs = null;
      if (timeParam && action !== "off") {
        durationMs = parseDuration(timeParam);
        if (!durationMs || durationMs <= 0) {
          return api.sendMessage(`❌ Định dạng thời gian không hợp lệ!\nHỗ trợ các đuôi: s (giây), m/p (phút), h/g (giờ), d (ngày).\nVí dụ: 30m, 2h, 1.5h, 1d`, threadID, messageID);
        }
      }

      const res = accountProfilesManager.pauseCluster(clusterId, durationMs);
      if (!res.success) {
        return api.sendMessage(`❌ ${res.message}`, threadID, messageID);
      }

      let reply = `🔴 [ ĐÃ TẠM NGƯNG CỤM ${clusterId} ] 🔴\n━━━━━━━━━━━━━\n`;
      reply += `🏷️ Tên: ${res.cluster.name || `Cụm ${clusterId}`}\n`;
      reply += `👤 Nick hiện tại: ${res.cluster.active_profile}\n`;

      if (durationMs) {
        const timeStr = formatRemainingTime(durationMs);
        const exactTime = new Date(res.enable_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
        reply += `⏳ Hẹn giờ tự động bật lại: sau ${timeStr}\n`;
        reply += `⏰ Thời điểm bật: ${exactTime}\n\n`;
        reply += `💡 Đúng ${exactTime}, hệ thống sẽ tự động bật luồng con cho Cụm ${clusterId} chạy lại!`;
      } else {
        reply += `⏸️ Trạng thái: Tạm ngưng vô thời hạn.\n\n`;
        reply += `💡 Để bật lại Cụm này, gõ: ${prefix}cluster on ${clusterId}`;
      }

      return api.sendMessage(reply, threadID, messageID);
    }

    // 5.3. BẬT LẠI CỤM NGAY LẬP TỨC (ON / RESUME / BAT)
    if (action === "on" || action === "resume" || action === "bat") {
      if (!clusterId || isNaN(clusterId)) {
        return api.sendMessage(`⚠️ Vui lòng nhập ID Cụm cần bật lại!\nVí dụ: ${prefix}cluster on 3 hoặc ${prefix}cluster 3 on`, threadID, messageID);
      }

      const res = accountProfilesManager.resumeCluster(clusterId);
      if (!res.success) {
        return api.sendMessage(`❌ ${res.message}`, threadID, messageID);
      }

      let reply = `🟢 [ ĐÃ BẬT LẠI CỤM ${clusterId} ] 🟢\n━━━━━━━━━━━━━\n`;
      reply += `🏷️ Tên: ${res.cluster.name || `Cụm ${clusterId}`}\n`;
      reply += `👤 Nick trực ca: ${res.cluster.active_profile}\n`;
      reply += `⚡ Trạng thái: Đang kích hoạt (Master sẽ tự động bật luồng con chạy trong vài giây!).`;

      return api.sendMessage(reply, threadID, messageID);
    }

    // 5.4. ĐỔI CA NICK LÀM VIỆC (ROTATE / DOICA / SWAP)
    if (action === "rotate" || action === "doica" || action === "swap") {
      if (!clusterId || isNaN(clusterId)) {
        return api.sendMessage(`⚠️ Vui lòng nhập ID Cụm cần đổi ca!\nVí dụ: ${prefix}cluster rotate 2 hoặc ${prefix}cluster 2 rotate`, threadID, messageID);
      }

      accountProfilesManager.loadConfig();
      const cluster = accountProfilesManager.config.clusters?.find(c => String(c.cluster_id) === String(clusterId));
      if (!cluster) {
        return api.sendMessage(`❌ Không tìm thấy Cụm ${clusterId}!`, threadID, messageID);
      }

      if (!cluster.profiles || cluster.profiles.length <= 1) {
        return api.sendMessage(`⚠️ Cụm ${clusterId} hiện chỉ có 1 profile (${cluster.profiles?.join(', ') || 'trống'}) nên không có nick thứ 2 để đổi ca!`, threadID, messageID);
      }

      const oldProf = cluster.active_profile;
      const newProf = accountProfilesManager.rotateClusterProfile(clusterId);

      if (!newProf) {
        return api.sendMessage(`⚠️ Không thể đổi ca cho Cụm ${clusterId} (Có thể các nick khác đang bị giam hoặc chưa sẵn sàng).`, threadID, messageID);
      }

      let reply = `🔄 [ ĐÃ ĐỔI CA LÀM VIỆC CỤM ${clusterId} ] 🔄\n━━━━━━━━━━━━━\n`;
      reply += `👤 Nick cũ: ${oldProf}\n`;
      reply += `✨ Nick mới nhận ca: ${newProf}\n`;
      reply += `⚡ Master đang chuyển giao phiên và khởi động lại luồng con cho Cụm ${clusterId}...`;

      return api.sendMessage(reply, threadID, messageID);
    }

    return api.sendMessage(`⚠️ Cú pháp không hợp lệ. Gõ ${prefix}cluster để xem danh sách và hướng dẫn chi tiết.`, threadID, messageID);

  } catch (error) {
    console.error("Lỗi lệnh cluster:", error);
    return api.sendMessage(`❌ Có lỗi xảy ra trong quá trình thực thi: ${error.message}`, threadID, messageID);
  }
}

module.exports = {
  name: "cluster",
  aliases: ["cum"],
  description: "Quản lý, hẹn giờ bật/tạm ngưng, đổi ca và kiểm tra cụm tài khoản bot",
  usage: "\n- cluster (hoặc cluster list): Xem tổng quan các cụm\n- cluster check: Đối soát bot hiện tại & nhóm được gán\n- cluster out: Tự động rời nhóm sai phân công\n- cluster cp: Xem danh sách tài khoản dính checkpoint\n- cluster uncp <Profile/UID>: Gỡ cờ checkpoint sau khi mở khóa nick\n- cluster on <id>: Bật lại cụm ngay\n- cluster off <id>: Tắt cụm vô thời hạn\n- cluster pause <id> <thời gian>: Tạm ngưng cụm (VD: 2h, 30m)\n- cluster <id> on at <giờ>: Hẹn giờ bật cụm (VD: 06:00)\n- cluster rotate <id>: Đổi ca nick bot ngay",
  hasPermssion: 2,

  execute: executeCommand,
  run: executeCommand
};
