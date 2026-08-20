const fs = require("fs");
const path = require("path");
const { checkCooldown } = require("../../utils/cooldown");
const { execute } = require("../../utils/database");
const { getThreadInfoCached } = require("../../utils/threadInfo");
// Load resolver at runtime inside execute to pick up hot-reloads

function normalizeMentionLabel(text) {
  const raw = String(text || "").replace(/^@+/, "").replace(/\u200b/g, "");
  try {
    const decomposed = raw.normalize("NFD").replace(/\p{M}/gu, "");
    const mapped = decomposed.replace(/\u0111/g, "d").replace(/\u0110/g, "D");
    return String(mapped).replace(/\s+/g, " ").trim().toLowerCase();
  } catch (e) {
    const fallback = raw.replace(/[\u0300-\u036f]/g, "").replace(/\u0111/g, "d").replace(/\u0110/g, "D");
    return String(fallback).replace(/\s+/g, " ").trim().toLowerCase();
  }
}

function splitMentionLabelQualifier(rawLabel) {
  const label = String(rawLabel || "").trim();
  const match = label.match(/^(.*?)(?:\s*\(([^()]+)\))\s*$/);
  if (!match) return { baseLabel: label, qualifier: "" };
  return {
    baseLabel: String(match[1] || "").trim(),
    qualifier: String(match[2] || "").trim().toLowerCase(),
  };
}

function findDuplicateCandidates(threadInfo, rawLabel) {
  const { baseLabel } = splitMentionLabelQualifier(rawLabel);
  const normalizedLabel = normalizeMentionLabel(baseLabel);
  if (!normalizedLabel) return [];

  const members = Array.isArray(threadInfo?.userInfo) ? threadInfo.userInfo : [];
  return members
    .filter((user) => normalizeMentionLabel(user?.name || "") === normalizedLabel)
    .map((user) => String(user?.id || "").trim())
    .filter(Boolean);
}

function buildDuplicatePrompt(rawLabel, candidateCount) {
  return [
    `⚠️ Tên "${rawLabel}" bị trùng ${candidateCount} người.`,
    `Bot sẽ chọn người khớp đầu tiên để lệnh chạy ngay.`,
  ].join("\n");
}

const KISS_MESSAGES = [
  "{actor} nhẹ nhàng hôn {target} một cái thật tình cảm 😘",
  "{actor} trao cho {target} một nụ hôn ngọt như kẹo 🍬",
  "{actor} kéo {target} lại gần rồi hôn cái chụt 💋",
  "{actor} gửi nụ hôn đầy yêu thương tới {target} 🌹",
  "{actor} hôn {target} làm cả nhóm đỏ mặt luôn 🫣",
  "{actor} đặt lên má {target} một nụ hôn dịu dàng 🌸",
  "{actor} hôn trộm {target} rồi cười tủm tỉm 😚",
  "{actor} thơm {target} cái chụt nghe rõ mồn một 💞",
  "{actor} ôm nhẹ rồi hôn {target} cực ngọt 💝",
  "{actor} hôn {target} khiến tim ai đó lỡ một nhịp 💓",
  "{actor} gửi tới {target} nụ hôn ấm áp giữa ngày dài ☀️",
  "{actor} ghé sát và hôn {target} làm không khí ngọt lịm 🍯",
  "{actor} tặng {target} một nụ hôn đầy cưng chiều 🥰",
  "{actor} hôn {target} nhẹ như gió thoảng 🍃",
  "{actor} thơm lên trán {target} thật dịu dàng 💫",
  "{actor} trao nụ hôn bất ngờ cho {target}, quá trời dễ thương 💗",
  "{actor} hôn {target} một cái rồi chạy mất tiêu 🏃",
  "{actor} nựng má rồi hôn {target} cái chụt 😳",
  "{actor} chạm môi thật nhanh với {target} rồi ngại ngùng 🙈",
  "{actor} thơm {target} làm ai nấy trong nhóm hú hét 📣",
  "{actor} hôn {target} với 100% chân thành ❤️",
  "{actor} gửi nụ hôn online siêu cấp đáng yêu tới {target} 📩",
  "{actor} hôn {target} xong đứng hình 5 giây luôn 🧊",
  "{actor} hôn má {target} một cái nghe " + 'rẹt' + " 😆",
  "{actor} tặng {target} nụ hôn ngọt hơn cả trà sữa 🧋",
  "{actor} hôn {target} và để lại đầy sự nhớ nhung 🌙",
  "{actor} thơm {target} khiến timeline ngập tim 💘",
  "{actor} khẽ hôn {target}, nhẹ mà rung động ✨",
  "{actor} trao nụ hôn cực phẩm cho {target} không trượt phát nào 🎯",
  "{actor} hôn {target} một cái rõ kêu, đáng yêu quá trời 😍",
];

const KISS_GIF_DIR = path.resolve(__dirname, "../cache/kiss");

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickRandomGif() {
  if (!fs.existsSync(KISS_GIF_DIR)) return null;

  const files = fs.readdirSync(KISS_GIF_DIR).filter((file) => /\.gif$/i.test(file));
  if (files.length === 0) return null;

  return path.join(KISS_GIF_DIR, pickRandom(files));
}

async function getUserName(api, userID, fallback = "Người ấy", threadID = null) {
  const id = String(userID || "").trim();
  if (!id) return fallback;

  if (threadID) {
    try {
      const threadInfo = await getThreadInfoCached(api, threadID);
      const members = Array.isArray(threadInfo?.userInfo) ? threadInfo.userInfo : [];
      const found = members.find((user) => String(user.id) === id);
      if (found?.name) return found.name;
    } catch (_) {}
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
    const info = await api.getUserInfo(id);
    const user = info?.[id];
    if (user?.name) {
      if (global.data?.userName) global.data.userName.set(id, user.name);
      return user.name;
    }
  } catch (_) {}

  return fallback;
}

module.exports = {
  name: "kiss",
  description: "Hôn người được tag hoặc reply bằng GIF",
  usage: "\n!kiss @tag → Hôn người được tag\n!kiss (reply) → Hôn người được reply\n━━━━━━━━━━━━━━━━━━\n💋 Gửi kèm GIF hôn và tin nhắn ngọt ngào\n😘 Không thể hôn chính mình",
  execute: async ({ api, event }) => {
    const { ensureMentionsFromHistory } = require("../../utils/mentionResolver");
    try {
      console.log("[kiss ENTRY]", JSON.stringify({ messageID: event?.messageID, threadID: event?.threadID, body: String(event?.body || "").slice(0,200) }));
    } catch (e) {}
    await ensureMentionsFromHistory(api, event);
    try {
      console.log("[kiss AFTER_RESOLVE] mentions:", JSON.stringify(event.mentions || {}));
    } catch (e) {}
    const { threadID, messageID, senderID, mentions, messageReply } = event;

    // Fallback: if resolver didn't find mentions but body contains @labels,
    // try to infer targets from thread member names (conservative: only when unique).
    if ((Object.keys(event.mentions || {}).length === 0) && String(event.body || "").includes("@")) {
      const { inferMentionEntriesFromBody } = require("../../utils/mentionResolver");
      try {
        const threadInfo = await getThreadInfoCached(api, threadID);
        try {
          console.log("[kiss DEBUG] attempting inference", JSON.stringify({ threadID, body: event.body, threadMembers: (threadInfo?.userInfo || []).length || 0 }));
        } catch (e) {}
        const inferred = inferMentionEntriesFromBody(threadInfo, event.body);
        try {
          console.log("[kiss DEBUG] inferred:", JSON.stringify(inferred || []));
        } catch (e) {}
        if (Array.isArray(inferred) && inferred.length > 0) {
          const map = {};
          for (const it of inferred) map[String(it.id)] = it.tag;
          event.mentions = map;
          try {
            console.log("[kiss DEBUG] applied inferred mentions:", JSON.stringify(event.mentions));
          } catch (e) {}
        }
      } catch (e) {
        console.log("[kiss DEBUG] inference error", e);
      }
    }

    const cooldown = checkCooldown({
      command: "kiss",
      key: senderID,
      durationMs: 15000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    let targetID = null;
    let targetName = "Người ấy";

    const mentionIDs = Object.keys(mentions || {});
    if (mentionIDs.length > 0) {
      targetID = mentionIDs[0];
      targetName = (mentions[targetID] || "").replace("@", "").trim() || "Người ấy";
    } else if (messageReply?.senderID) {
      targetID = String(messageReply.senderID);
      targetName =
        (typeof messageReply.senderName === "string" && messageReply.senderName.trim()) ||
        (typeof messageReply.name === "string" && messageReply.name.trim()) ||
        (await getUserName(api, targetID, "Người ấy", threadID));
    }

    if (!targetID) {
      return api.sendMessage(
        "⚠️ Hãy reply hoặc tag người bạn muốn hôn.",
        threadID,
        messageID,
      );
    }

    if (String(targetID) === String(senderID)) {
      return api.sendMessage("😳 Tự hôn bản thân hả? Tag người khác đi nè.", threadID, messageID);
    }

    const actorName = await getUserName(api, senderID, "Bạn", threadID);
    const targetTag = `@${targetName}`;
    const message = pickRandom(KISS_MESSAGES)
      .replace("{actor}", actorName)
      .replace("{target}", targetTag);

    const gifPath = pickRandomGif();
    if (!gifPath) {
      return api.sendMessage(
        "❌ Không tìm thấy GIF kiss trong thư mục cache/kiss.",
        threadID,
        messageID,
      );
    }

    return api.sendMessage(
      {
        body: message,
        mentions: [{ tag: targetTag, id: String(targetID) }],
        attachment: fs.createReadStream(gifPath),
      },
      threadID,
      messageID,
    );
  },
};
