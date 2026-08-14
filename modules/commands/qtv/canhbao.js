const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { ensureMentionsFromHistory } = require("../../utils/mentionResolver");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const { addWarning, getWarnings, resetWarnings, resetAllWarnings, listWarnings, getUserName } = require("../../utils/warningStorage");

module.exports = {
  name: "canhbao",
  description: "Cảnh báo thành viên vi phạm, tích lũy 3 lần sẽ bị kick khỏi nhóm",
  usage: "[@tag / reply / list / reset @tag / reset all] [lý do]",
  hasPermssion: 1,
  credits: "Antigravity",
  
  execute: async ({ api, event, args }) => {
    try {
      await ensureMentionsFromHistory(api, event);
      const { threadID, messageID, senderID, mentions } = event;
      
      // 1. Lấy thông tin nhóm
      const threadInfo = await getThreadInfoCached(api, threadID);
      if (!threadInfo) {
        return api.sendMessage("❌ Không thể lấy thông tin nhóm.", threadID, messageID);
      }
      
      const adminIDs = toAdminIdList(threadInfo);
      const adminBotUIDs = getAdminBotUIDs();
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const isSenderBotAdmin = adminBotUIDs.includes(String(senderID));
      
      // Kiểm tra quyền người gửi
      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc Admin Bot mới được sử dụng lệnh này!", threadID, messageID);
      }
      
      // Kiểm tra quyền của Bot
      const botID = String(api.getCurrentUserID());
      const isBotAdmin = adminIDs.includes(botID);
      if (!isBotAdmin) {
        return api.sendMessage("❌ Bot cần có quyền Quản Trị Viên để thực hiện lệnh cảnh báo và kick người vi phạm!", threadID, messageID);
      }
      
      const subCommand = args[0] ? args[0].toLowerCase() : "";
      
      // --- XỬ LÝ CÁC PHÂN LỆNH ---
      
      // 1. Xem danh sách bị cảnh báo: canhbao list
      if (subCommand === "list" || subCommand === "view") {
        const list = await listWarnings(api, threadID);
        if (!list || list.length === 0) {
          return api.sendMessage("✅ Nhóm hiện tại không có thành viên nào bị cảnh báo.", threadID, messageID);
        }
        
        let msg = "🛡️ [ DANH SÁCH BỊ CẢNH BÁO ] 🛡️\n\n";
        list.forEach((user, idx) => {
          msg += `${idx + 1}. ${user.name} (${user.userID})\n` +
                 `• Số lần: ${user.count}/3\n` +
                 `• Lý do: ${user.reasons.join(", ")}\n\n`;
        });
        return api.sendMessage(msg.trim(), threadID, messageID);
      }
      
      // 2. Reset cảnh báo: canhbao reset @tag / canhbao reset all
      if (subCommand === "reset" || subCommand === "remove") {
        const targetSub = args[1] ? args[1].toLowerCase() : "";
        if (targetSub === "all") {
          await resetAllWarnings(threadID);
          return api.sendMessage("✅ Đã reset toàn bộ điểm cảnh báo của tất cả thành viên trong nhóm.", threadID, messageID);
        }
        
        let targetID = null;
        if (Object.keys(mentions || {}).length > 0) {
          targetID = Object.keys(mentions)[0];
        } else if (event.type === "message_reply") {
          targetID = event.messageReply.senderID;
        } else if (args[1] && !isNaN(args[1])) {
          targetID = args[1];
        }
        
        if (!targetID) {
          return api.sendMessage("❌ Vui lòng tag, reply tin nhắn hoặc nhập ID của người cần xóa cảnh báo.", threadID, messageID);
        }
        
        const success = await resetWarnings(threadID, targetID);
        if (success) {
          const name = await getUserName(api, threadID, targetID);
          return api.sendMessage(`✅ Đã xóa toàn bộ điểm cảnh báo của thành viên ${name} (${targetID}).`, threadID, messageID);
        } else {
          return api.sendMessage("❌ Đã xảy ra lỗi khi reset điểm cảnh báo.", threadID, messageID);
        }
      }
      
      // 3. Thực hiện cảnh báo người dùng: canhbao @tag [lý do] / reply canhbao [lý do]
      let targetID = null;
      let reason = "Nhắc nhở chú ý luật nhóm";
      
      if (Object.keys(mentions || {}).length > 0) {
        targetID = Object.keys(mentions)[0];
        // Trích xuất lý do bằng cách bỏ phần tag của người dùng khỏi văn bản lệnh
        const mentionNames = Object.values(mentions);
        let content = args.join(" ");
        for (const name of mentionNames) {
          content = content.replace(name, "");
        }
        // Loại bỏ ký tự tag @ thừa nếu có
        content = content.replace(/@/g, "").trim();
        if (content) {
          reason = content;
        }
      } else if (event.type === "message_reply") {
        targetID = event.messageReply.senderID;
        if (args.length > 0) {
          reason = args.join(" ");
        }
      } else if (args[0] && !isNaN(args[0])) {
        targetID = args[0];
        if (args.length > 1) {
          reason = args.slice(1).join(" ");
        }
      }
      
      if (!targetID) {
        return api.sendMessage(
          "❌ Hướng dẫn sử dụng:\n" +
          "• `canhbao @tag [lý do]` (hoặc reply tin nhắn)\n" +
          "• `canhbao list` để xem danh sách thành viên bị cảnh báo\n" +
          "• `canhbao reset @tag` để xóa điểm cảnh báo thành viên\n" +
          "• `canhbao reset all` để xóa toàn bộ cảnh báo cả nhóm",
          threadID,
          messageID
        );
      }
      
      // Kiểm tra tự cảnh báo chính mình
      if (String(targetID) === String(senderID)) {
        return api.sendMessage("⚠️ Bạn không thể tự cảnh báo chính mình!", threadID, messageID);
      }
      
      // Thực hiện cảnh báo qua warningStorage
      const result = await addWarning(api, threadID, targetID, reason);
      if (result.immune) {
        return api.sendMessage("🛡️ Đối tượng này được miễn trừ cảnh báo (QTV, Admin hoặc Bot).", threadID, messageID);
      }
    } catch (e) {
      console.error("Lỗi canhbao:", e);
      return api.sendMessage("❌ Có lỗi xảy ra khi thực hiện lệnh cảnh báo.", event.threadID, event.messageID);
    }
  }
};
