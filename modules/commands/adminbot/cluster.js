const { execute } = require("../../utils/database");
const accountProfilesManager = require("../../../src/managers/accountProfilesManager");
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { ensureAccountClusterSchema } = require("../../utils/accountSchema");

module.exports = {
  name: "cluster",
  description: "Quản lý và kiểm tra cụm acc",
  usage: "[check|out]",
  hasPermssion: 2, // Admin only based on our common standard, though we manually check anyway

  async execute({ api, event, args }) {
    const { threadID, senderID, messageID } = event;

    // Check permission
    const adminIDs = getAdminBotUIDs();
    if (!adminIDs.includes(String(senderID))) {
      return api.sendMessage("⚠️ Chỉ Admin Bot mới có quyền dùng lệnh này.", threadID, messageID);
    }

    const command = args[0] ? args[0].toLowerCase() : "";

    if (command !== "check" && command !== "out") {
      return api.sendMessage(
        "📝 Hướng dẫn sử dụng:\n" +
        "- cluster check: Kiểm tra Cụm đang gánh mấy nhóm, thực tế đang ở mấy nhóm.\n" +
        "- cluster out: Tự động rời khỏi các nhóm KHÔNG thuộc phân công của Cụm này.",
        threadID,
        messageID
      );
    }

    try {
      await ensureAccountClusterSchema();
      const botUid = String(api.getCurrentUserID());

      const activeProfile = accountProfilesManager.getActiveProfileName();
      const config = accountProfilesManager.loadConfig();

      let activeClusterId = 1;
      let activeClusterProfiles = ["Default", "Profile 1"];

      for (const c of config.clusters || []) {
        if (c.profiles && c.profiles.includes(activeProfile)) {
          activeClusterId = c.cluster_id;
          activeClusterProfiles = c.profiles;
          break;
        }
      }

      let allClustersInfo = `📊 TÌNH TRẠNG TẤT CẢ CÁC CỤM\n━━━━━━━━━━━━━━━\n`;
      for (const c of config.clusters || []) {
        const rows = await execute(
          `SELECT COUNT(*) as cnt FROM group_profile_bindings 
           WHERE cluster_id = ? 
             AND thread_id NOT IN ('1523319575522034', '844251878447942')
             AND thread_id IN (SELECT thread_id FROM rented_groups WHERE is_stopped = 0 AND expire_date >= datetime('now', '-1 day', 'localtime'))`,
          [c.cluster_id]
        );
        const count = rows && rows.length > 0 ? rows[0].cnt : 0;
        allClustersInfo += `Cụm ${c.cluster_id}: ${count} nhóm thuê (Active Profile: ${c.active_profile || "Không rõ"})\n`;
      }
      allClustersInfo += `━━━━━━━━━━━━━━━\n`;

      // 1. Get assigned groups (lọc bỏ box test và nhóm tạm ngưng)
      const assignedRows = await execute(
        `SELECT thread_id FROM group_profile_bindings 
         WHERE cluster_id = ? 
           AND thread_id NOT IN ('1523319575522034', '844251878447942')
           AND thread_id IN (SELECT thread_id FROM rented_groups WHERE is_stopped = 0 AND expire_date >= datetime('now', '-1 day', 'localtime'))`,
        [activeClusterId]
      );
      const allowedThreadIds = new Set((assignedRows || []).map(r => String(r.thread_id)));

      // 2. Get actual joined groups
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

      if (command === "check") {
        let msg = allClustersInfo;
        msg += `🤖 THÔNG TIN BOT HIỆN TẠI (UID: ${botUid})\n`;
        msg += `👤 Profile đang chạy: ${activeProfile} (Thuộc Cụm ${activeClusterId})\n`;
        msg += `✅ Số nhóm thuê phân công cho Cụm này: ${allowedThreadIds.size}\n`;
        msg += `🌐 Thực tế đang ở: ${actualThreadList.length} nhóm thuê (đã trừ 2 box test)\n`;
        msg += `⚠️ Số nhóm KHÔNG thuộc cụm này: ${invalidGroups.length}\n`;

        if (invalidGroups.length > 0) {
          msg += `\nDanh sách TID cần rời đi:\n`;
          invalidGroups.forEach((g, idx) => {
            msg += `${idx + 1}. ${g.threadID} (${g.name || "Không tên"})\n`;
          });
          msg += `\n👉 Dùng lệnh "cluster out" để rời các nhóm này.`;
        }

        return api.sendMessage(msg, threadID, messageID);
      }

      if (command === "out") {
        if (invalidGroups.length === 0) {
          return api.sendMessage(`✅ Profile ${activeProfile} hiện không tham gia nhóm nào sai phân công.`, threadID, messageID);
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
            // Delay a bit to avoid spamming Facebook API
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (e) {
            failCount++;
          }
        }

        let rsMsg = `✅ Đã hoàn tất việc rời nhóm!\n━━━━━━━━━━━━━━━\n`;
        rsMsg += `- Thành công: ${successCount}\n`;
        if (failCount > 0) rsMsg += `- Thất bại: ${failCount}\n`;

        return api.sendMessage(rsMsg, threadID, messageID);
      }

    } catch (error) {
      console.error("Lỗi lệnh cluster:", error);
      return api.sendMessage(`❌ Có lỗi xảy ra: ${error.message}`, threadID, messageID);
    }
  }
};
