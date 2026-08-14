const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const prefix = process.env.BOT_PREFIX;

function chunkLines(lines, maxChars = 3500) {
  const chunks = [];
  let current = "";

  for (const line of lines) {
    if ((current + line + "\n").length > maxChars) {
      chunks.push(current.trimEnd());
      current = "";
    }
    current += `${line}\n`;
  }

  if (current.trim()) chunks.push(current.trimEnd());
  return chunks;
}

function chunkRichLines(lines, maxChars = 3500) {
  const chunks = [];
  let currentBody = "";
  let currentMentions = [];

  const flush = () => {
    if (!currentBody.trim()) {
      currentBody = "";
      currentMentions = [];
      return;
    }

    chunks.push({
      body: currentBody.trimEnd(),
      mentions: currentMentions,
    });

    currentBody = "";
    currentMentions = [];
  };

  for (const line of lines) {
    const text = String(line?.text || "");
    const nextBody = currentBody ? `${currentBody}\n${text}` : text;

    if (nextBody.length > maxChars && currentBody) {
      flush();
    }

    const lineStart = currentBody.length;
    if (currentBody) {
      currentBody += "\n";
    }
    currentBody += text;

    if (Array.isArray(line?.mentions)) {
      for (const mention of line.mentions) {
        currentMentions.push({
          ...mention,
          fromIndex: lineStart + Number(mention?.fromIndex || 0),
        });
      }
    }
  }

  flush();
  return chunks;
}

async function sendMessageSafe(api, body, threadID, replyToMessageID) {
  try {
    const result = await api.sendMessage(body, threadID, replyToMessageID);
    if (result && typeof result === "object") return { ok: true, info: result };
    return { ok: true, info: null };
  } catch {
    try {
      await new Promise((r) => setTimeout(r, 700));
      const resultRetry = await api.sendMessage(
        body,
        threadID,
        replyToMessageID,
      );
      if (resultRetry && typeof resultRetry === "object")
        return { ok: true, info: resultRetry };
      return { ok: true, info: null };
    } catch (e2) {
      return { ok: false, error: e2 };
    }
  }
}

function suppressLeaveEvents(threadID, durationMs = 15000) {
  global.leaveEventSuppressByThread = global.leaveEventSuppressByThread || {};
  global.leaveEventSuppressByThread[String(threadID)] = Date.now() + durationMs;
}

function buildMissingNicknameList(threadInfo, botID) {
  const memberInfo = threadInfo.userInfo || [];
  const memberMap = new Map(memberInfo.map((u) => [String(u.id), u]));
  const participantIDs = (threadInfo.participantIDs || []).map((id) =>
    String(id),
  );
  const nicknames = threadInfo.nicknames || {};

  const list = participantIDs
    .filter((uid) => {
      if (String(uid) === String(botID)) return false;
      const nickname = String(nicknames[uid] || "").trim();
      return !nickname;
    })
    .map((uid) => {
      const user = memberMap.get(uid);
      return {
        uid,
        name: user?.name || `User ${uid.slice(-6)}`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));

  return list;
}

module.exports = {
  name: "checkbd",
  description: "Liệt kê thành viên chưa set biệt danh và hỗ trợ kick theo STT",
  usage:
    `\n${prefix}checkbd → Liệt kê thành viên chưa set biệt danh\n${prefix}checkbd canhbao → Tag toàn bộ chưa setbd (trừ QTV)\n${prefix}checkbd kickall → Kick toàn bộ chưa setbd (trừ QTV)\n━━━━━━━━━━━━━\n↩️ Reply STT (vd: 1 2 3) để kick từng người (tối đa 5)\n⚠️ Bot cần quyền QTV để kick\n🔒 Chỉ QTV nhóm/chủ bot mới dùng được`,

  execute: async ({ api, event, args }) => {
    const { threadID, messageID, senderID } = event;

    const cooldown = checkCooldown({
      command: "checkbd",
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
      const threadInfo = await getThreadInfoCached(api, threadID);
      if (!threadInfo.isGroup) {
        return api.sendMessage(
          "⚠️ Lệnh này chỉ dùng trong nhóm.",
          threadID,
          messageID,
        );
      }

      const adminIDs = toAdminIdList(threadInfo);
      const botID = String(api.getCurrentUserID());
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const adminBotUIDs = getAdminBotUIDs();
      const isSenderBotAdmin = Array.isArray(adminBotUIDs)
        ? adminBotUIDs.includes(String(senderID))
        : false;
      const isBotAdmin = adminIDs.includes(botID);

      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage(
          "⚠️ Lệnh checkbd chỉ dành cho QTV nhóm hoặc chủ bot.",
          threadID,
          messageID,
        );
      }

      const missingList = buildMissingNicknameList(threadInfo, botID);

      if (missingList.length === 0) {
        return api.sendMessage(
          "✅ Tất cả thành viên hiện tại đã set biệt danh.",
          threadID,
          messageID,
        );
      }

      const sub = String(args[0] || "").toLowerCase();
      const nonAdminMissingList = missingList.filter(
        (item) => !adminIDs.includes(String(item.uid)),
      );

      if (sub === "canhbao") {
        if (nonAdminMissingList.length === 0) {
          return api.sendMessage(
            "🛡️ Không có thành viên thường nào chưa set biệt danh để cảnh báo.",
            threadID,
            messageID,
          );
        }

        let body = `📣 CẢNH BÁO CHƯA SET BIỆT DANH\n━━━━━━━━━━━━━\nCó ${nonAdminMissingList.length} thành viên chưa set biệt danh:\n`;
        const mentions = [];

        nonAdminMissingList.forEach((item, index) => {
          const globalIdx = index + 1;
          const cleanName = String(item.name || "").replace(/[\r\n]+/g, " ").trim() || `User ${String(item.uid).slice(-6)}`;
          const mentionText = `@${cleanName}`;
          const prefixOfLine = `${globalIdx}. `;
          const fromIndex = body.length + prefixOfLine.length;

          body += `${prefixOfLine}${mentionText}\n`;

          mentions.push({
            id: String(item.uid),
            tag: mentionText,
            fromIndex: fromIndex,
          });
        });

        body += `\n📌 Vui lòng setbd sớm để dễ gọi tên và tránh bị nhắc lại.`;

        await sendMessageSafe(
          api,
          { body, mentions },
          threadID,
          messageID,
        );

        return;
      }

      if (sub === "kickall") {
        if (!isBotAdmin) {
          return api.sendMessage(
            "❌ Bot cần quyền QTV để kick thành viên.",
            threadID,
            messageID,
          );
        }

        const candidates = nonAdminMissingList;

        if (candidates.length === 0) {
          return api.sendMessage(
            "🛡️ Tất cả người chưa set biệt danh đều là QTV, không thể kick.",
            threadID,
            messageID,
          );
        }

        if (
          !(
            api.removeUserFromGroup ||
            api.removeParticipant ||
            api.removeUser ||
            api.removeUserFromThread ||
            api.removeParticipantFromThread ||
            api.gcmember
          )
        ) {
          return api.sendMessage(
            "❌ Bot hiện tại không hỗ trợ chức năng kick do thư viện thiếu API xóa participant. Vui lòng cập nhật thư viện/phiên bản.",
            threadID,
            messageID,
          );
        }

        suppressLeaveEvents(
          threadID,
          Math.max(15000, candidates.length * 1200),
        );

        const removeUser = async (uid, tid) => {
          if (api.removeUserFromGroup) return api.removeUserFromGroup(uid, tid);
          if (api.removeParticipant) return api.removeParticipant(uid, tid);
          if (api.gcmember) return api.gcmember("remove", uid, tid);
          if (api.removeUser) return api.removeUser(uid, tid);
          if (api.removeUserFromThread)
            return api.removeUserFromThread(uid, tid);
          if (api.removeParticipantFromThread)
            return api.removeParticipantFromThread(uid, tid);
          throw new Error("Library missing remove function");
        };

        let success = 0;
        let failed = 0;
        const failedDetails = [];

        for (const user of candidates) {
          const uid = String(user.uid);
          try {
            await removeUser(uid, threadID);
            success++;
            await new Promise((r) => setTimeout(r, 300));
          } catch (e) {
            failed++;
            failedDetails.push(
              `- ${user.name || uid}: ${e?.message || "kick lỗi"}`,
            );
          }
        }

        let msg = `✅ kickall checkbd xong.`;
        msg += `\n• Tìm thấy: ${candidates.length}`;
        msg += `\n• Thành công: ${success}`;
        msg += `\n• Thất bại: ${failed}`;
        if (failedDetails.length > 0) {
          msg += `\n\n📌 Chi tiết lỗi:\n${failedDetails.slice(0, 10).join("\n")}`;
        }

        return api.sendMessage(msg, threadID, messageID);
      }

      const lines = [
        "🪪 CHECKBD - CHƯA SET BIỆT DANH",
        "━━━━━━━━━━━━━",
        ...missingList.map((item, idx) => {
          const adminTag = adminIDs.includes(String(item.uid)) ? " [QTV]" : "";
          return `${idx + 1}. ${item.name}${adminTag}`;
        }),
        "",
        "↩️ Reply nhiều STT (vd: 1 2 3 hoặc 1,2,3; tối đa 5) để kick thành viên chưa setbd",
        "",
        "📌 Lệnh nhanh:",
        `• ${prefix}checkbd kickall → kick toàn bộ thành viên chưa setbd (trừ QTV)`,
        `• ${prefix}checkbd canhbao → cảnh báo toàn bộ thành viên chưa setbd (trừ QTV)`,
      ];

      const chunks = chunkLines(lines);
      global.checkbdReplyContexts = global.checkbdReplyContexts || {};

      const sentMessageIDs = [];
      for (let i = 0; i < chunks.length; i++) {
        const sent = await sendMessageSafe(
          api,
          chunks[i],
          threadID,
          i === chunks.length - 1 ? messageID : undefined,
        );

        if (!sent.ok) {
          return api.sendMessage(
            "❌ Facebook đang lỗi tạm thời, thử lại sau vài giây.",
            threadID,
            messageID,
          );
        }

        if (sent.info?.messageID) {
          sentMessageIDs.push(sent.info.messageID);
        }
      }

      if (sentMessageIDs.length > 0) {
        const replyContext = {
          author: String(senderID),
          threadID: String(threadID),
          missingList,
          createdAt: Date.now(),
        };

        for (const mid of sentMessageIDs) {
          global.checkbdReplyContexts[mid] = replyContext;
        }
      }
    } catch (e) {
      console.error("Lỗi checkbd:", e);
      return api.sendMessage("❌ Lỗi khi xử lý checkbd.", threadID, messageID);
    }
  },

  handleReply: async ({ api, event }) => {
    try {
      if (event.type !== "message_reply") return;

      const { threadID, senderID, messageID, messageReply, body } = event;
      const replyContexts = global.checkbdReplyContexts || {};
      const context = replyContexts[messageReply?.messageID];
      if (!context) return;

      if (String(context.threadID) !== String(threadID)) return;
      if (String(context.author) !== String(senderID)) {
        return api.sendMessage(
          "⚠️ Chỉ người gọi checkbd mới được reply STT.",
          threadID,
          messageID,
        );
      }

      const input = String(body || "").trim();
      if (!/^[0-9\s,.-]+$/.test(input)) {
        return;
      }
      const sttMatches = input.match(/\d+/g) || [];
      const sttList = [
        ...new Set(sttMatches.map((n) => Number(n)).filter(Number.isInteger)),
      ];

      if (sttList.length === 0) {
        return api.sendMessage(
          "⚠️ STT không hợp lệ. Ví dụ: 1 2 3 hoặc 1,2,3",
          threadID,
          messageID,
        );
      }

      if (sttList.length > 5) {
        return api.sendMessage(
          "⚠️ Mỗi lần chỉ xử lý tối đa 5 STT.",
          threadID,
          messageID,
        );
      }

      if (sttList.some((stt) => stt < 1 || stt > context.missingList.length)) {
        return api.sendMessage(
          "⚠️ Có STT vượt ngoài danh sách.",
          threadID,
          messageID,
        );
      }

      const threadInfo = await getThreadInfoCached(api, threadID);
      const adminIDs = toAdminIdList(threadInfo);
      const participantSet = new Set(
        (threadInfo.participantIDs || []).map((id) => String(id)),
      );
      const botID = String(api.getCurrentUserID());
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const adminBotUIDs = getAdminBotUIDs();
      const isSenderBotAdmin = Array.isArray(adminBotUIDs)
        ? adminBotUIDs.includes(String(senderID))
        : false;

      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage(
          "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được xử lý kick bằng STT.",
          threadID,
          messageID,
        );
      }

      const selectedTargets = sttList
        .map((stt) => context.missingList[stt - 1])
        .filter(Boolean);

      const hasKickCandidate = selectedTargets.some((target) => {
        const uid = String(target.uid);
        return (
          participantSet.has(uid) && uid !== botID && !adminIDs.includes(uid)
        );
      });

      if (hasKickCandidate && !adminIDs.includes(botID)) {
        return api.sendMessage(
          "❌ Bot cần quyền QTV để kick thành viên.",
          threadID,
          messageID,
        );
      }

      if (selectedTargets.length > 1) {
        suppressLeaveEvents(threadID, 15000);
      }

      let kicked = 0;
      let skipped = 0;
      let failed = 0;
      const failedDetails = [];

      if (
        !(
          api.removeUserFromGroup ||
          api.removeParticipant ||
          api.removeUser ||
          api.removeUserFromThread ||
          api.removeParticipantFromThread ||
          api.gcmember
        )
      ) {
        return api.sendMessage(
          "❌ Bot hiện tại không hỗ trợ chức năng kick do thư viện thiếu API xóa participant. Vui lòng cập nhật thư viện/phiên bản.",
          threadID,
          messageID,
        );
      }

      const removeUser = async (uid, tid) => {
        if (api.removeUserFromGroup) return api.removeUserFromGroup(uid, tid);
        if (api.removeParticipant) return api.removeParticipant(uid, tid);
        if (api.gcmember) return api.gcmember("remove", uid, tid);
        if (api.removeUser) return api.removeUser(uid, tid);
        if (api.removeUserFromThread) return api.removeUserFromThread(uid, tid);
        if (api.removeParticipantFromThread)
          return api.removeParticipantFromThread(uid, tid);
        throw new Error("Library missing remove function");
      };

      for (const target of selectedTargets) {
        const uid = String(target.uid);

        if (!participantSet.has(uid)) {
          skipped++;
          continue;
        }

        if (uid === botID || adminIDs.includes(uid)) {
          skipped++;
          continue;
        }

        try {
          await removeUser(uid, threadID);
          kicked++;
          await new Promise((r) => setTimeout(r, 300));
        } catch (e) {
          failed++;
          failedDetails.push(
            `- ${target.name || uid}: ${e?.message || "kick lỗi"}`,
          );
        }
      }

      let msg = `✅ Xử lý xong ${selectedTargets.length} mục checkbd.`;
      msg += `\n• Kick thành công: ${kicked}`;
      msg += `\n• Bỏ qua: ${skipped}`;
      msg += `\n• Thất bại: ${failed}`;

      if (failedDetails.length > 0) {
        msg += `\n\n📌 Chi tiết lỗi:\n${failedDetails.slice(0, 10).join("\n")}`;
      }

      return api.sendMessage(msg, threadID, messageID);
    } catch (e) {
      console.error("Lỗi checkbd handleReply:", e);
    }
  },
};
