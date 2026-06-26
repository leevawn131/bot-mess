const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { ensureMentionsFromHistory } = require("../../utils/mentionResolver");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const prefix = process.env.BOT_PREFIX;

module.exports = {
  name: "kick",
  description: "Kick thành viên (Có check quyền QTV)",
  usage:
    `\n${prefix}kick @tag → Kick người được tag\n${prefix}kick (reply) → Kick người được reply\n${prefix}kick [uid] → Kick bằng User ID\n━━━━━━━━━━━━━\n🛡️ Tự động bỏ qua QTV và Bot\n⚠️ Bot cần quyền QTV để kick\n🔒 Chỉ QTV nhóm/chủ bot mới dùng được`,
  execute: async ({ api, event, args }) => {
    await ensureMentionsFromHistory(api, event);
    const { threadID, messageID, senderID, mentions } = event;

    // Cooldown 5s
    const cooldown = checkCooldown({
      command: "kick",
      key: senderID,
      durationMs: 10000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    try {
      // 2. Lấy thông tin nhóm và danh sách Admin
      const threadInfo = await getThreadInfoCached(api, threadID);
      
      if (!threadInfo || typeof threadInfo !== 'object') {
        return api.sendMessage("❌ Không thể lấy thông tin nhóm.", threadID, messageID);
      }

      // 1. Xác định danh sách ID cần kick
      let targetIDs = [];
      
      if (Object.keys(mentions || {}).length > 0) {
        targetIDs = Object.keys(mentions);
      } else if (event.type === "message_reply") {
        targetIDs = [event.messageReply.senderID];
      } else if (args[0] && !isNaN(args[0])) {
        targetIDs = [args[0]];
      } else if (args.length > 0) {
        // Fallback: Tìm chính xác tên (Exact match) khi tag bị lỗi metadata
        const searchStr = args.join(" ").replace(/@/g, "").trim().toLowerCase();
        const matchedUsers = (threadInfo.userInfo || []).filter(
          (u) => u.name && u.name.toLowerCase() === searchStr
        );
        
        if (matchedUsers.length === 1) {
          // Chỉ kick ngay lập tức nếu tìm thấy CHÍNH XÁC 1 người (Đảm bảo an toàn 100%)
          targetIDs = [String(matchedUsers[0].id)];
        } else if (matchedUsers.length > 1) {
          // Trùng tên -> Từ chối kick để tránh nhầm người vô tội
          return api.sendMessage(
            `❌ Có ${matchedUsers.length} thành viên trùng tên "${searchStr}". Bot từ chối kick để tránh nhầm lẫn.\n📌 Vui lòng Reply tin nhắn hoặc nhập ID của người cần kick.`,
            threadID,
            messageID
          );
        }
      }

      if (targetIDs.length === 0)
        return api.sendMessage(
          "❌ Vui lòng Tag, Reply hoặc nhập đúng tên/ID người cần kick.",
          threadID,
          messageID,
        );
      
      const adminIDs = toAdminIdList(threadInfo);
      const botID = String(api.getCurrentUserID());
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const adminBotUIDs = getAdminBotUIDs();
      const isSenderBotAdmin = Array.isArray(adminBotUIDs)
        ? adminBotUIDs.includes(String(senderID))
        : false;

      // --- KIỂM TRA QUYỀN HẠN ---
      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage(
          "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được dùng lệnh kick!",
          threadID,
          messageID,
        );
      }

      if (!adminIDs.includes(botID)) {
        return api.sendMessage(
          "❌ Bot cần quyền Quản Trị Viên để thực hiện lệnh này!",
          threadID,
          messageID,
        );
      }

      const hasRemoveSupport = Boolean(
        api.removeUserFromGroup ||
        api.removeParticipant ||
        api.removeUser ||
        api.removeUserFromThread ||
        api.removeParticipantFromThread ||
        api.gcmember,
      );

      if (!hasRemoveSupport) {
        return api.sendMessage(
          "❌ Bot hiện tại không hỗ trợ chức năng kick do thư viện thiếu API xóa participant. Vui lòng cập nhật thư viện/phiên bản.",
          threadID,
          messageID,
        );
      }

      // 4. Hàm Kick
      const kickUser = async (uid, tid) => {
        if (api.removeUserFromGroup) return api.removeUserFromGroup(uid, tid);
        if (api.removeParticipant) return api.removeParticipant(uid, tid);
        if (api.gcmember) return api.gcmember("remove", uid, tid);
        if (api.removeUser) return api.removeUser(uid, tid);
        if (api.removeUserFromThread) return api.removeUserFromThread(uid, tid);
        if (api.removeParticipantFromThread)
          return api.removeParticipantFromThread(uid, tid);
        throw new Error("Library missing remove function");
      };

      let successCount = 0;
      let skipCount = 0;

      for (const targetID of targetIDs) {
        if (adminIDs.includes(String(targetID))) {
          skipCount++;
          continue;
        }

        if (String(targetID) === botID) {
          skipCount++;
          continue;
        }

        if (Array.isArray(adminBotUIDs) && adminBotUIDs.includes(String(targetID))) {
          skipCount++;
          continue;
        }

        try {
          await kickUser(targetID, threadID);
          successCount++;
          await new Promise((r) => setTimeout(r, 300));
        } catch (e) {
          console.error(`Failed to kick ${targetID}:`, e);
        }
      }

      if (successCount > 0) {
        let msg = `✅ Đã kick ${successCount} thành viên.`;
        if (skipCount > 0) msg += `\n(⏭️ Bỏ qua ${skipCount} Admin/Bot)`;
        api.sendMessage(msg, threadID, messageID);
      } else if (skipCount > 0) {
        api.sendMessage(
          `🛡️ Không thể kick vì tất cả đều là Admin hoặc Bot.`,
          threadID,
          messageID,
        );
      }
    } catch (e) {
      console.error(e);
      api.sendMessage(
        "❌ Lỗi: Không thể xử lý yêu cầu. (Có thể do lỗi thư viện hoặc Bot bị chặn)",
        event.threadID,
        event.messageID,
      );
    }
  },
};
