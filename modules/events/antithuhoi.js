const fs = require("fs");
const path = require("path");

const ANTITHUHOI_DIR = path.join(__dirname, "../../cache/antithuhoi");
const SETTINGS_PATH = path.join(ANTITHUHOI_DIR, "settings.json");

// Đọc cài đặt
function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    }
  } catch {}
  return {};
}

// Lấy file lưu tin nhắn
function getThreadMessageFile(threadID) {
  return path.join(ANTITHUHOI_DIR, `messages_${threadID}.json`);
}

// Đọc danh sách tin nhắn
function getSavedMessages(threadID) {
  const file = getThreadMessageFile(threadID);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch {}
  return [];
}

// Tìm tin nhắn bị gỡ
function findDeletedMessage(threadID, messageID) {
  const messages = getSavedMessages(threadID);
  return messages.find((m) => m.messageID === messageID);
}

// Format thời gian
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString("vi-VN");
}

function normalizeTimestamp(rawTs) {
  const n = Number(rawTs);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  // Một số event trả giây thay vì mili-giây
  if (n < 1e12) return n * 1000;
  return n;
}

async function resolveSenderName(
  api,
  threadID,
  senderID,
  fallbackName = "Unknown",
) {
  if (!senderID) return fallbackName;

  try {
    if (typeof api.getThreadInfo === "function") {
      const threadInfo = await api.getThreadInfo(String(threadID || ""));
      const memberInfo = Array.isArray(threadInfo?.userInfo)
        ? threadInfo.userInfo
        : [];
      const found = memberInfo.find((u) => String(u.id) === String(senderID));
      if (found?.name) return found.name;
    }
  } catch {}

  try {
    const userInfo = await api.getUserInfo(String(senderID));
    const info = userInfo && userInfo[String(senderID)];
    if (info && info.name) return info.name;
  } catch {}

  return fallbackName;
}

module.exports = {
  name: "messageDeleted",
  eventType: ["message_unsend"],

  execute: async ({ api, event }) => {
    if (!event.threadID) return;

    const settings = getSettings();
    if (!settings[event.threadID]) {
      // ANTITHUHOI chưa được bật cho nhóm này
      return;
    }

    try {
      // Xác định messageID từ event
      let messageID = null;

      // Cách 1: event.messageID (thông thường)
      if (event.messageID) {
        messageID = event.messageID;
      }
      // Cách 2: event.message (một số event)
      else if (event.message) {
        messageID = event.message;
      }
      // Cách 3: event.args[0] (nếu có)
      else if (event.args && event.args[0]) {
        messageID = event.args[0];
      }

      if (!messageID) {
        console.log("⚠️ Không thể xác định messageID từ event unsend");
        return;
      }

      console.log(`🔍 [ANTITHUHOI] Phát hiện gỡ tin nhắn: ${messageID}`);

      // Tìm tin nhắn trong danh sách đã lưu
      const deletedMsg = findDeletedMessage(event.threadID, messageID);

      if (deletedMsg) {
        const unsendTimestamp = normalizeTimestamp(event.timestamp);
        const timeDelete = formatTime(unsendTimestamp);
        const senderID = String(event.senderID || deletedMsg.senderID || "");
        const botID = String(api.getCurrentUserID());
        if (senderID && senderID === botID) {
          return;
        }
        const fallbackName =
          deletedMsg.senderName || (senderID ? `UID: ${senderID}` : "Unknown");
        const senderName = await resolveSenderName(
          api,
          event.threadID,
          senderID,
          fallbackName,
        );
        const attachmentText =
          deletedMsg.attachments > 0
            ? `\n📎 Kèm ${deletedMsg.attachments} tệp đính kèm`
            : "";

        const noticeMsg =
          `🚨 TIN NHẮN BỊ GỠ!\n\n` +
          `👤 Người gửi: ${senderName}\n` +
          `🕒 Thời gian gỡ: ${timeDelete}\n` +
          `📝 Nội dung: "${deletedMsg.body}"${attachmentText}`;

        api.sendMessage(noticeMsg, event.threadID);
        console.log(`✅ [ANTITHUHOI] Đã nhắc lại tin nhắn bị gỡ`);
      } else {
        console.log(`ℹ️ [ANTITHUHOI] Tin nhắn không có trong danh sách lưu`);
      }
    } catch (err) {
      console.error("❌ Lỗi antithuhoi event:", err);
    }
  },
};
