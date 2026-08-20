const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { ensureMentionsFromHistory } = require("../../utils/mentionResolver");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const { addBlock, removeBlock, getBlockedList } = require("../../utils/cutvvStorage");
const { execute } = require("../../utils/database");
const prefix = process.env.BOT_PREFIX || "!";

async function resolveCutvvUserName(api, threadID, uid, threadInfo = null) {
  const id = String(uid || "").trim();
  if (!id) return "Người dùng Facebook";

  if (threadInfo && Array.isArray(threadInfo.userInfo)) {
    const found = threadInfo.userInfo.find(u => String(u.id) === id);
    if (found?.name) return found.name;
  }

  if (global.data?.userName?.has(id)) {
    return global.data.userName.get(id);
  }

  try {
    const rows = await execute("SELECT name FROM messenger_users WHERE psid = ? AND name != 'Người dùng' AND name != '' LIMIT 1", [id]);
    if (rows && rows[0] && rows[0].name) {
      if (global.data?.userName) global.data.userName.set(id, rows[0].name);
      return rows[0].name;
    }
  } catch (_) {}

  try {
    const uInfo = await api.getUserInfo(id);
    if (uInfo && uInfo[id]?.name) {
      if (global.data?.userName) global.data.userName.set(id, uInfo[id].name);
      return uInfo[id].name;
    }
  } catch (_) {}

  return "Người dùng Facebook";
}

module.exports = {
  name: "cutvv",
  description: "Trục xuất thành viên và cấm quay lại nhóm vĩnh viễn (Chỉ QTV)",
  usage:
    `\n${prefix}cutvv @tag → Cấm người được tag\n${prefix}cutvv (reply) → Cấm người được reply\n${prefix}cutvv [uid] → Cấm bằng User ID\n${prefix}cutvv list [trang] → Xem danh sách bị chặn (10 người/trang)\n${prefix}cutvv unban [uid|@tag|reply] → Gỡ cấm\n━━━━━━━━━━━━━\n🛡️ Tự động bỏ qua QTV và Bot\n⚠️ Bot cần quyền QTV để thực hiện\n🔒 Chỉ QTV nhóm/chủ bot mới dùng được`,
  execute: async ({ api, event, args }) => {
    await ensureMentionsFromHistory(api, event);
    const { threadID, messageID, senderID, mentions } = event;

    // Cooldown 5s
    const cooldown = checkCooldown({
      command: "cutvv",
      key: senderID,
      durationMs: 5000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    try {
      // Lấy thông tin nhóm và danh sách Admin
      const threadInfo = await getThreadInfoCached(api, threadID);
      if (!threadInfo || typeof threadInfo !== 'object') {
        return api.sendMessage("❌ Không thể lấy thông tin nhóm.", threadID, messageID);
      }

      const adminIDs = toAdminIdList(threadInfo);
      const botID = String(api.getCurrentUserID());
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const adminBotUIDs = getAdminBotUIDs();
      const isSenderBotAdmin = Array.isArray(adminBotUIDs)
        ? adminBotUIDs.includes(String(senderID))
        : false;

      // --- KIỂM TRA QUYỀN HẠN CỦA NGƯỜI DÙNG ---
      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage(
          "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được dùng lệnh này!",
          threadID,
          messageID,
        );
      }

      // --- KIỂM TRA QUYỀN HẠN CỦA BOT ---
      if (!adminIDs.includes(botID)) {
        return api.sendMessage(
          "❌ Bot cần quyền Quản Trị Viên nhóm để thực hiện chặn thành viên!",
          threadID,
          messageID,
        );
      }

      const subcommand = args[0] ? args[0].toLowerCase() : "";

      // 1. SUBCOMMAND: LIST (Xem danh sách bị cấm)
      if (subcommand === "list" || subcommand === "view") {
        const blockedUsers = await getBlockedList(threadID);
        if (blockedUsers.length === 0) {
          return api.sendMessage("📝 Nhóm này chưa cấm vĩnh viễn thành viên nào.", threadID, messageID);
        }

        const itemsPerPage = 10;
        const totalItems = blockedUsers.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage);

        let pageInput = parseInt(args[1]) || 1;
        if (pageInput < 1 || pageInput > totalPages) {
          return api.sendMessage(
            `⚠️ Trang không hợp lệ! Danh sách bị cấm hiện tại có từ trang 1 đến trang ${totalPages}.`,
            threadID,
            messageID
          );
        }

        const page = pageInput;
        const startIndex = (page - 1) * itemsPerPage;
        const pageUsers = blockedUsers.slice(startIndex, startIndex + itemsPerPage);

        // Lọc các UID chưa có tên (hoặc là Người dùng Facebook) trong trang này để fetch và update vào database
        const uidsToFetch = pageUsers
          .filter(u => !u.name || u.name === "Người dùng Facebook")
          .map(u => u.user_id);

        if (uidsToFetch.length > 0) {
          try {
            const missingFromCache = [];
            for (const uid of uidsToFetch) {
              const uIdStr = String(uid);
              let foundName = null;
              if (global.data?.userName?.has(uIdStr)) {
                foundName = global.data.userName.get(uIdStr);
              } else {
                const rows = await execute("SELECT name FROM messenger_users WHERE psid = ? AND name != 'Người dùng' AND name != '' LIMIT 1", [uIdStr]);
                if (rows && rows[0] && rows[0].name) {
                  foundName = rows[0].name;
                  if (global.data?.userName) global.data.userName.set(uIdStr, foundName);
                }
              }
              if (foundName && foundName !== "Người dùng Facebook") {
                await execute(
                  "UPDATE thread_blocked_members SET name = ? WHERE thread_id = ? AND user_id = ?",
                  [foundName, String(threadID), uIdStr]
                );
                const userObj = pageUsers.find(u => String(u.user_id) === uIdStr);
                if (userObj) userObj.name = foundName;
              } else {
                missingFromCache.push(uIdStr);
              }
            }

            if (missingFromCache.length > 0) {
              const rawUserInfo = await api.getUserInfo(missingFromCache) || {};
              const mergedInfo = {};
              if (Array.isArray(rawUserInfo)) {
                rawUserInfo.forEach(item => {
                  if (item && typeof item === "object") Object.assign(mergedInfo, item);
                });
              } else if (rawUserInfo && typeof rawUserInfo === "object") {
                Object.assign(mergedInfo, rawUserInfo);
              }
              for (const uid of missingFromCache) {
                const name = mergedInfo[uid]?.name;
                if (name && name !== "Người dùng Facebook") {
                  if (global.data?.userName) global.data.userName.set(uid, name);
                  await execute(
                    "UPDATE thread_blocked_members SET name = ? WHERE thread_id = ? AND user_id = ?",
                    [name, String(threadID), String(uid)]
                  );
                  const userObj = pageUsers.find(u => String(u.user_id) === uid);
                  if (userObj) userObj.name = name;
                }
              }
            }
          } catch (e) {
            console.error("Lỗi lấy thông tin và cập nhật database blocked users:", e);
          }
        }

        let msg = `🛡️ [ DANH SÁCH BỊ CẤM VĨNH VIỄN ] 🛡️\n📖 Trang ${page}/${totalPages} (Tổng: ${totalItems} thành viên)\n━━━━━━━━━━━━━━━━━━\n`;

        pageUsers.forEach((user, index) => {
          const name = user.name || "Người dùng Facebook";
          const date = new Date(user.blocked_at).toLocaleString("vi-VN");
          msg += `${index + 1}. 👤 ${name}\n   🆔 UID: ${user.user_id}\n   ⏰ Ngày cấm: ${date}\n━━━━━━━━━━━━━━━━━━\n`;
        });

        msg += "\n💬 Reply tin nhắn này kèm số thứ tự (ví dụ: 1 2) để gỡ cấm vĩnh viễn.";
        if (totalPages > 1) {
          const botPrefix = process.env.BOT_PREFIX || "!";
          msg += `\n📄 Dùng \`${botPrefix}cutvv list [trang]\` để xem các trang khác.`;
        }

        return api.sendMessage(
          msg,
          threadID,
          (err, info) => {
            if (err) return;
            if (!global.client) global.client = {};
            if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
            global.client.handleReply.push({
              name: "cutvv",
              messageID: info.messageID,
              author: senderID,
              threadID: threadID,
              pageUsers: pageUsers,
              page: page
            });
          },
          messageID
        );
      }

      // 2. SUBCOMMAND: UNBAN (Gỡ cấm)
      if (args[0] && (args[0].toLowerCase() === "unban" || args[0].toLowerCase() === "remove" || args[0].toLowerCase() === "del")) {
        let targetID = null;

        if (Object.keys(mentions || {}).length > 0) {
          targetID = Object.keys(mentions)[0];
        } else if (event.type === "message_reply") {
          targetID = event.messageReply.senderID;
        } else if (args[1] && !isNaN(args[1])) {
          targetID = args[1];
        } else if (args[1]) {
          // Khớp tên khi unban
          const searchStr = args.slice(1).join(" ").replace(/@/g, "").trim().toLowerCase();
          const blockedUsers = await getBlockedList(threadID);
          const uids = blockedUsers.map(u => u.user_id);
          let userInfo = {};
          try {
            userInfo = await api.getUserInfo(uids) || {};
          } catch (e) {}

          const matchedUIDs = uids.filter(uid => {
            const name = (userInfo[uid]?.name || "").toLowerCase();
            return name === searchStr;
          });

          if (matchedUIDs.length === 1) {
            targetID = matchedUIDs[0];
          } else if (matchedUIDs.length > 1) {
            return api.sendMessage(
              `❌ Có ${matchedUIDs.length} người trùng tên "${searchStr}" trong danh sách chặn. Vui lòng unban bằng UID.`,
              threadID,
              messageID
            );
          }
        }

        if (!targetID) {
          return api.sendMessage(
            "❌ Vui lòng Tag, Reply hoặc nhập đúng UID/Tên người cần gỡ cấm.\nVD: !cutvv unban [UID]",
            threadID,
            messageID
          );
        }

        const removed = await removeBlock(threadID, targetID);
        if (removed) {
          const userName = await resolveCutvvUserName(api, threadID, targetID, threadInfo);

          return api.sendMessage(
            `✅ Đã gỡ cấm vĩnh viễn cho thành viên: ${userName} (${targetID}).\nBây giờ người này có thể tham gia lại nhóm.`,
            threadID,
            messageID
          );
        } else {
          return api.sendMessage("❌ Lỗi: Không thể thực hiện gỡ cấm.", threadID, messageID);
        }
      }

      // 3. DEFAULT COMMAND: BLOCK & KICK (Thực hiện chặn và đuổi)
      let targetIDs = [];

      if (Object.keys(mentions || {}).length > 0) {
        targetIDs = Object.keys(mentions);
      } else if (event.type === "message_reply") {
        targetIDs = [event.messageReply.senderID];
      } else if (args[0] && !isNaN(args[0])) {
        targetIDs = [args[0]];
      } else if (args.length > 0) {
        // Fallback: Tìm chính xác tên trong danh sách thành viên hiện tại
        const searchStr = args.join(" ").replace(/@/g, "").trim().toLowerCase();
        const matchedUsers = (threadInfo.userInfo || []).filter(
          (u) => u.name && u.name.toLowerCase() === searchStr
        );

        if (matchedUsers.length === 1) {
          targetIDs = [String(matchedUsers[0].id)];
        } else if (matchedUsers.length > 1) {
          return api.sendMessage(
            `❌ Có ${matchedUsers.length} thành viên trùng tên "${searchStr}". Bot từ chối cấm để tránh nhầm lẫn.\n📌 Vui lòng Reply tin nhắn hoặc nhập UID của người cần cấm.`,
            threadID,
            messageID
          );
        }
      }

      if (targetIDs.length === 0) {
        return api.sendMessage(
          "❌ Vui lòng Tag, Reply hoặc nhập đúng tên/UID người cần cấm vĩnh viễn.",
          threadID,
          messageID
        );
      }

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
        const targetStr = String(targetID);

        // Không cấm Admin nhóm, Bot chính hoặc Admin bot
        if (
          adminIDs.includes(targetStr) ||
          targetStr === botID ||
          (Array.isArray(adminBotUIDs) && adminBotUIDs.includes(targetStr))
        ) {
          skipCount++;
          continue;
        }

        const targetName = await resolveCutvvUserName(api, threadID, targetStr, threadInfo);

        const added = await addBlock(threadID, targetStr, targetName, senderID);
        if (added) {
          try {
            await kickUser(targetStr, threadID);
          } catch (e) {
            console.error(`Failed to kick ${targetStr} during cutvv:`, e);
          }
          successCount++;
        }
      }

      if (successCount > 0) {
        let msg = `✅ Đã cấm vĩnh viễn và trục xuất ${successCount} thành viên khỏi nhóm thành công.`;
        if (skipCount > 0) msg += `\n(⏭️ Bỏ qua ${skipCount} Admin/Bot)`;
        api.sendMessage(msg, threadID, messageID);
      } else if (skipCount > 0) {
        api.sendMessage(
          `🛡️ Không thể thực thi lệnh vì tất cả đối tượng đều là Admin hoặc Bot.`,
          threadID,
          messageID,
        );
      }
    } catch (e) {
      console.error(e);
      api.sendMessage(
        "❌ Lỗi: Không thể xử lý yêu cầu cấm vĩnh viễn.",
        event.threadID,
        event.messageID,
      );
    }
  },
  handleReply: async ({ api, event }) => {
    try {
      const { messageReply, senderID, threadID, body } = event;
      if (!messageReply || !messageReply.messageID) return;

      const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
      const hr = list.find(h => String(h.messageID) === String(messageReply.messageID) && h.name === "cutvv");
      if (!hr) return;

      // Lấy thông tin nhóm và kiểm tra quyền admin của người reply
      const threadInfo = await getThreadInfoCached(api, threadID);
      if (!threadInfo) return;
      const adminIDs = toAdminIdList(threadInfo);
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const adminBotUIDs = getAdminBotUIDs();
      const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage("⚠️ Chỉ QTV nhóm hoặc chủ bot mới có thể gỡ cấm!", threadID, event.messageID);
      }

      const input = body ? body.trim() : "";

      // 1. Kiểm tra nếu người dùng muốn chuyển trang (VD: page 2, trang 2, p 2)
      const pageMatch = input.match(/^(?:page|trang|p)\s*(\d+)$/i);
      if (pageMatch) {
        const targetPage = parseInt(pageMatch[1]);
        if (!hr.totalPages || targetPage < 1 || targetPage > hr.totalPages) {
          return api.sendMessage(`⚠️ Trang không hợp lệ! Vui lòng chọn từ trang 1 đến ${hr.totalPages || 1}.`, threadID, event.messageID);
        }

        // Unsend tin nhắn cũ
        try { await api.unsendMessage(messageReply.messageID); } catch (e) {}
        const index = list.indexOf(hr);
        if (index > -1) list.splice(index, 1);

        // Chạy lại lệnh list ở trang mới
        const cutvvModule = module.exports;
        return cutvvModule.execute({
          api,
          event: { ...event, messageID: event.messageID },
          args: ["list", String(targetPage)]
        });
      }

      // 2. Phân tích các số thứ tự do người dùng reply để gỡ cấm
      const choices = input.split(/[\s,]+/).map(s => parseInt(s)).filter(n => !isNaN(n));
      if (choices.length === 0) {
        return api.sendMessage("❌ Lựa chọn không hợp lệ. Vui lòng nhập số thứ tự tương ứng hoặc 'page <số trang>'.", threadID, event.messageID);
      }

      const pageUIDs = hr.pageUIDs || hr.blockedUIDs || [];
      const allUIDs = hr.allUIDs || hr.blockedUIDs || [];
      const startIndex = hr.startIndex || 0;

      const targetsToUnban = [];

      for (const choice of choices) {
        // Ưu tiên 1: STT trên trang hiện tại (1..pageUIDs.length)
        if (choice >= 1 && choice <= pageUIDs.length) {
          targetsToUnban.push(pageUIDs[choice - 1]);
        }
        // Ưu tiên 2: STT toàn cục của trang hiện tại (startIndex + 1 .. startIndex + pageUIDs.length)
        else if (choice >= startIndex + 1 && choice <= startIndex + pageUIDs.length) {
          targetsToUnban.push(pageUIDs[choice - startIndex - 1]);
        }
        // Ưu tiên 3: STT toàn cục của tất cả thành viên bị cấm (1 .. allUIDs.length)
        else if (choice >= 1 && choice <= allUIDs.length) {
          targetsToUnban.push(allUIDs[choice - 1]);
        }
      }

      if (targetsToUnban.length === 0) {
        return api.sendMessage("❌ Không tìm thấy số thứ tự tương ứng trong danh sách cấm.", threadID, event.messageID);
      }

      // Tiến hành unban các user đã chọn
      let successCount = 0;
      const unbannedNames = [];

      for (const targetID of targetsToUnban) {
        const removed = await removeBlock(threadID, targetID);
        if (removed) {
          successCount++;
          let name = targetID;
          try {
            const uInfo = await api.getUserInfo(String(targetID));
            if (uInfo && uInfo[String(targetID)]) {
              name = uInfo[String(targetID)].name;
            }
          } catch (e) {}
          unbannedNames.push(`${name} (${targetID})`);
        }
      }

      // Xoá tin nhắn menu list cũ
      try {
        await api.unsendMessage(messageReply.messageID);
      } catch (e) {}

      // Xoá handleReply cũ khỏi danh sách
      const index = list.indexOf(hr);
      if (index > -1) {
        list.splice(index, 1);
      }

      return api.sendMessage(
        `✅ Đã gỡ cấm vĩnh viễn thành công cho ${successCount} thành viên:\n${unbannedNames.map(n => `• ${n}`).join("\n")}`,
        threadID
      );
    } catch (e) {
      console.error("Lỗi trong handleReply cutvv:", e);
    }
  }
};

