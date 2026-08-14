const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const { getRenterID } = require("../../utils/rental");
const {
  isGroupBanned,
  banUserInGroup,
  unbanUserInGroup,
  getGroupBannedUsers,
} = require("../../utils/groupBannedUsers");
const { ensureMentionsFromHistory } = require("../../utils/mentionResolver");

module.exports = {
  name: "cambot",
  aliases: ["blockbot", "banuser", "cammode", "uncambot"],
  description: "Cấm hoặc bỏ cấm người dùng/QTV sử dụng bot trong nhóm",
  usage:
    "\n!cambot @tag / reply / [UID] → Cấm thành viên/QTV dùng bot\n!cambot unban @tag / reply / [UID] → Bỏ cấm\n!cambot list → Xem danh sách đang bị cấm",
  execute: async ({ api, event, args, config }) => {
    try {
      await ensureMentionsFromHistory(api, event);
      const { threadID, messageID, senderID, mentions, type, messageReply } = event;

      const botID = String(api.getCurrentUserID());
      const adminBotUIDs = getAdminBotUIDs();
      const isBotAdmin = Array.isArray(adminBotUIDs) && adminBotUIDs.includes(String(senderID));

      // Lấy thông tin Renter & ThreadInfo
      const renterID = await getRenterID(threadID);
      const isRenter = renterID && String(senderID) === String(renterID);

      const threadInfo = await getThreadInfoCached(api, threadID);
      const adminIDs = threadInfo ? toAdminIdList(threadInfo) : [];
      const isGroupAdmin = adminIDs.includes(String(senderID));

      // 1. Kiểm tra quyền dùng lệnh !cambot
      if (!isBotAdmin && !isRenter && !isGroupAdmin) {
        return api.sendMessage(
          "⚠️ Chỉ Người thuê bot, QTV nhóm hoặc Chủ bot mới được sử dụng lệnh này!",
          threadID,
          messageID
        );
      }

      const subCommand = (args[0] || "").toLowerCase();

      // 2. Lệnh `!cambot list` -> Xem danh sách bị cấm
      if (subCommand === "list") {
        const list = getGroupBannedUsers(threadID);
        if (!list || list.length === 0) {
          return api.sendMessage(
            "✅ Nhóm này hiện không có ai bị cấm sử dụng bot.",
            threadID,
            messageID
          );
        }

        let msg = "🚫 [ DANH SÁCH BỊ CẤM DÙNG BOT TRONG NHÓM ] 🚫\n\n";
        const userMap = new Map((threadInfo?.userInfo || []).map((u) => [String(u.id), u.name]));

        list.forEach((item, index) => {
          const name = userMap.get(String(item.userID)) || `User ${item.userID}`;
          msg += `${index + 1}. ${name} (${item.userID})\n`;
        });
        msg += "\n💡 Dùng '!cambot unban @tag' hoặc UID để bỏ cấm.";
        return api.sendMessage(msg, threadID, messageID);
      }

      // 3. Xác định hành động (ban hay unban) và danh sách mục tiêu
      let isUnbanAction = false;
      let targetArgs = [...args];

      if (subCommand === "unban" || subCommand === "gocambot" || subCommand === "remove") {
        isUnbanAction = true;
        targetArgs.shift();
      }

      let targetIDs = [];
      if (Object.keys(mentions || {}).length > 0) {
        targetIDs = Object.keys(mentions);
      } else if (type === "message_reply" && messageReply?.senderID) {
        targetIDs = [String(messageReply.senderID)];
      } else if (targetArgs[0] && !isNaN(targetArgs[0])) {
        targetIDs = [String(targetArgs[0])];
      }

      if (targetIDs.length === 0) {
        return api.sendMessage(
          "❌ Vui lòng Tag, Reply hoặc nhập UID người cần cấm/bỏ cấm dùng bot.\n📌 Ví dụ: !cambot @nguoidung hoặc !cambot list",
          threadID,
          messageID
        );
      }

      let successList = [];
      let failList = [];

      for (const targetID of targetIDs) {
        const uid = String(targetID);

        // Bảo vệ: Không ai cấm được Chủ Bot hoặc chính mình
        if (adminBotUIDs.includes(uid) || uid === botID) {
          failList.push(`❌ Không thể cấm Chủ bot / Bot (${uid})`);
          continue;
        }

        if (uid === String(senderID)) {
          failList.push("❌ Bạn không thể tự cấm chính mình");
          continue;
        }

        // Bảo vệ: Không ai cấm được Người Thuê Bot ngoại trừ Chủ Bot
        if (renterID && uid === String(renterID) && !isBotAdmin) {
          failList.push(`❌ Không thể cấm Người thuê bot (${uid})`);
          continue;
        }

        if (isUnbanAction) {
          const removed = unbanUserInGroup(threadID, uid);
          if (removed) {
            successList.push(`✅ Đã mở cấm dùng bot cho UID ${uid}`);
          } else {
            failList.push(`⚠️ UID ${uid} hiện không bị cấm`);
          }
        } else {
          banUserInGroup(threadID, uid, senderID);
          successList.push(`🚫 Đã cấm UID ${uid} sử dụng bot trong nhóm này`);
        }
      }

      let responseMsg = "";
      if (successList.length > 0) responseMsg += successList.join("\n") + "\n";
      if (failList.length > 0) responseMsg += failList.join("\n");

      return api.sendMessage(responseMsg.trim(), threadID, messageID);
    } catch (e) {
      console.error("Lỗi cambot:", e);
      return api.sendMessage("❌ Có lỗi xảy ra khi thực hiện lệnh cấm bot.", event.threadID, event.messageID);
    }
  },
};
