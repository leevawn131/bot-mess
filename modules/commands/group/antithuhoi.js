const fs = require("fs");
const path = require("path");
const { checkCooldown } = require("../../utils/cooldown");
const { ADMIN_BOT_UIDS } = require("../../utils/checkPermission");

const ANTITHUHOI_DIR = path.join(__dirname, "../../../cache/antithuhoi");
const SETTINGS_PATH = path.join(ANTITHUHOI_DIR, "settings.json");

// Đảm bảo thư mục tồn tại
function ensureDir() {
  if (!fs.existsSync(ANTITHUHOI_DIR)) {
    fs.mkdirSync(ANTITHUHOI_DIR, { recursive: true });
  }
}

// Đọc cài đặt cho nhóm
function getSettings() {
  ensureDir();
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    }
  } catch {}
  return {};
}

// Lưu cài đặt
function saveSettings(settings) {
  ensureDir();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// Lấy file lưu tin nhắn cho nhóm
function getThreadMessageFile(threadID) {
  ensureDir();
  return path.join(ANTITHUHOI_DIR, `messages_${threadID}.json`);
}

// Đọc danh sách tin nhắn đã lưu
function getSavedMessages(threadID) {
  const file = getThreadMessageFile(threadID);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch {}
  return [];
}

// Lưu danh sách tin nhắn
function saveMessages(threadID, messages) {
  const file = getThreadMessageFile(threadID);
  fs.writeFileSync(file, JSON.stringify(messages, null, 2));
}

// Lưu 15 tin nhắn gần nhất
async function saveLatestMessages(api, threadID) {
  try {
    const botID = String(api.getCurrentUserID());
    const threadInfo = await api.getThreadInfo(threadID);
    const memberInfo = Array.isArray(threadInfo?.userInfo)
      ? threadInfo.userInfo
      : [];
    const nameById = new Map(
      memberInfo.map((u) => [String(u.id), u.name || ""]),
    );

    const history = await api.getThreadHistory(threadID, 15);

    const messages = history
      .filter((msg) => msg.body && String(msg.senderID) !== botID)
      .map((msg) => ({
        messageID: msg.messageID,
        senderID: msg.senderID,
        senderName:
          nameById.get(String(msg.senderID)) || msg.senderName || "Unknown",
        body: msg.body,
        timestamp: msg.timestamp,
        attachments: msg.attachments ? msg.attachments.length : 0,
      }))
      .reverse(); // Từ cũ nhất đến mới nhất

    saveMessages(threadID, messages);
    return messages.length;
  } catch (e) {
    console.error("Lỗi lưu tin nhắn:", e);
    return 0;
  }
}

module.exports = {
  name: "antithuhoi",
  description: "Lưu 15 tin nhắn cuối và nhắc lại khi bị gỡ",
  usage: "[on | off | status]",

  execute: async ({ api, event, args }) => {
    const { threadID, messageID, senderID } = event;

    const cooldown = checkCooldown({
      command: "antithuhoi",
      key: senderID,
      durationMs: 5000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s`,
        threadID,
        messageID,
      );
    }

    try {
      const threadInfo = await api.getThreadInfo(threadID);
      if (!threadInfo.isGroup) {
        return api.sendMessage(
          "⚠️ Lệnh này chỉ dùng trong nhóm.",
          threadID,
          messageID,
        );
      }

      // Kiểm tra quyền
      const adminIDs = (threadInfo.adminIDs || []).map((item) =>
        String(item.id),
      );
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const isSenderBotAdmin = ADMIN_BOT_UIDS.includes(String(senderID));

      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage(
          "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được dùng lệnh này.",
          threadID,
          messageID,
        );
      }

      const action = String(args[0] || "status")
        .trim()
        .toLowerCase();
      const settings = getSettings();
      const currentState = settings[threadID] || false;

      // Status
      if (["status", "st", "s"].includes(action)) {
        const stateText = currentState ? "BẬT ✅" : "TẮT ❌";
        const savedMsgs = getSavedMessages(threadID);
        return api.sendMessage(
          `🔍 ANTITHUHOI: ${stateText}\n📨 Tin nhắn đã lưu: ${savedMsgs.length}/15\n⚡ Cập nhật tức thời\n💡 Dùng: !antithuhoi on hoặc !antithuhoi off`,
          threadID,
          messageID,
        );
      }

      if (!["on", "off"].includes(action)) {
        return api.sendMessage(
          "⚠️ Cách dùng: !antithuhoi [on | off | status]",
          threadID,
          messageID,
        );
      }

      // Bật/tắt
      const newState = action === "on";
      settings[threadID] = newState;
      saveSettings(settings);

      if (newState) {
        // Bật: lưu 15 tin nhắn gần nhất và bắt đầu auto-update
        const count = await saveLatestMessages(api, threadID);

        if (count > 0) {
          return api.sendMessage(
            `✅ Đã bật ANTITHUHOI!\n📨 Lưu ${count} tin nhắn gần nhất.\n⚡ Cập nhật tức thời khi có tin nhắn mới.\n🔔 Khi có tin nhắn bị gỡ, bot sẽ nhắc lại ngay!`,
            threadID,
            messageID,
          );
        } else {
          return api.sendMessage(
            "⚠️ Không tìm thấy tin nhắn để lưu. Thử lại sau.",
            threadID,
            messageID,
          );
        }
      } else {
        // Tắt
        return api.sendMessage(
          "❌ Đã tắt ANTITHUHOI. Bot không còn nhắc lại tin nhắn bị gỡ.",
          threadID,
          messageID,
        );
      }
    } catch (err) {
      console.error("Lỗi antithuhoi:", err);
      api.sendMessage("❌ Lỗi thực thi lệnh.", threadID, messageID);
    }
  },
};
