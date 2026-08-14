const { getThreadInfoCached } = require("../../utils/threadInfo");
require("dotenv").config();
const PREFIX = process.env.BOT_PREFIX;

const config = {
  name: "thongbao",
  version: "1.1.0",
  hasPermission: 1,
  hasPermssion: 1,
  credits: "Mirai Team & Antigravity",
  usePrefix: true,
  description: "Tag toàn bộ thành viên trong nhóm để gửi thông báo (hỗ trợ ghim tin nhắn)",
  commandCategory: "Quản trị viên",
  usage: `${PREFIX}thongbao <nội dung> để thông báo cho tất cả thành viên\n${PREFIX}thongbao pin | <nội dung> để thông báo và ghim tin nhắn ngay sau đó`,
  cooldowns: 10
};

async function runCommand({ api, event, args, Threads }) {
  const { threadID, messageID, senderID } = event;
  try {
    let threadInfo;
    if (Threads && typeof Threads.getInfo === "function") {
      try {
        threadInfo = await Threads.getInfo(threadID);
      } catch (e) { }
    }
    if (!threadInfo) {
      threadInfo = await getThreadInfoCached(api, threadID);
    }

    if (!threadInfo || !Array.isArray(threadInfo.participantIDs)) {
      return api.sendMessage("❌ Không thể lấy danh sách thành viên nhóm.", threadID, messageID);
    }

    const botID = String(api.getCurrentUserID ? api.getCurrentUserID() : global.botID || "");
    const senderIDStr = String(senderID);

    let all = threadInfo.participantIDs
      .map(id => String(id))
      .filter(id => id !== botID && id !== senderIDStr);

    if (all.length === 0) {
      return api.sendMessage("⚠️ Không có thành viên nào khác trong nhóm để thông báo.", threadID, messageID);
    }

    const rawInput = args.join(" ");
    let shouldPin = false;
    let content = "";

    if (/^pin\b\s*(\|\s*)?/i.test(rawInput)) {
      shouldPin = true;
      content = rawInput.replace(/^pin\b\s*(\|\s*)?/i, "").trim();
    } else {
      content = rawInput.trim();
    }

    if (!content) {
      content = "Đâu Rồi Dmm";
    }

    const body = `🎉== 𝐓𝐇𝐎̂𝐍𝐆 𝐁𝐀́𝐎 ==🎉\n________________________\n💬 ${content}\n`;
    const textIndex = body.indexOf(content);
    const fromIndex = textIndex >= 0 ? textIndex : 0;

    const mentions = all.map(id => ({
      tag: content,
      id: id,
      fromIndex: fromIndex
    }));

    return api.sendMessage({ body, mentions }, threadID, async (err, info) => {
      if (err) return;
      if (shouldPin) {
        const targetMessageID = info?.messageID || info?.message_id;
        if (targetMessageID && typeof api.pinMessage === "function") {
          try {
            await api.pinMessage(targetMessageID, threadID);
          } catch (pinErr) {
            console.error("Lỗi ghim tin nhắn lệnh thongbao:", pinErr);
          }
        }
      }
    }, messageID);
  } catch (e) {
    console.error("Lỗi lệnh thongbao:", e);
    return api.sendMessage("❌ Đã xảy ra lỗi khi gửi thông báo.", threadID, messageID);
  }
}

module.exports = {
  ...config,
  config,
  execute: runCommand,
  run: runCommand
};
