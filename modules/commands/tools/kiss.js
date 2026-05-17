const fs = require("fs");
const path = require("path");
const { checkCooldown } = require("../../utils/cooldown");
const { ensureMentionsFromHistory } = require("../../utils/mentionResolver");

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

async function getUserName(api, userID, fallback = "Người ấy") {
  try {
    const info = await api.getUserInfo(userID);
    const user = info?.[userID];
    return user?.name || fallback;
  } catch {
    return fallback;
  }
}

module.exports = {
  name: "kiss",
  description: "Hôn người được tag hoặc reply bằng GIF",
  usage: "\n!kiss @tag → Hôn người được tag\n!kiss (reply) → Hôn người được reply\n━━━━━━━━━━━━━━━━━━\n💋 Gửi kèm GIF hôn và tin nhắn ngọt ngào\n😘 Không thể hôn chính mình",
  execute: async ({ api, event }) => {
    await ensureMentionsFromHistory(api, event);
    const { threadID, messageID, senderID, mentions, messageReply } = event;

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
        (await getUserName(api, targetID, "Người ấy"));
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

    const actorName = await getUserName(api, senderID, "Bạn");
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
