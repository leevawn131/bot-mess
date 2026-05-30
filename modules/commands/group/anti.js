const fs = require("fs");
const path = require("path");
const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { getAntioutSetting, setAntioutEnabled } = require("../../utils/antioutSettings");
const { getAntitagallSetting, setAntitagallEnabled } = require("../../utils/antitagallSettings");

const AUTO_UNSEND_MS = 60000;
const ANTI_MENU_MARKER = "ANTI_CONTROL_MENU_V1";
const ANTITHUHOI_DIR = path.join(__dirname, "../../../cache/antithuhoi");
const ANTITHUHOI_SETTINGS_PATH = path.join(ANTITHUHOI_DIR, "settings.json");

function scheduleAutoUnsend(api, messageResult) {
  const messageID = messageResult?.messageID;
  if (!messageID) return;

  setTimeout(() => {
    try {
      api.unsendMessage(messageID);
    } catch (error) {
      console.error("Lỗi tự gỡ menu anti:", error);
    }
  }, AUTO_UNSEND_MS);
}

function ensureAntiThuHoiDir() {
  if (!fs.existsSync(ANTITHUHOI_DIR)) {
    fs.mkdirSync(ANTITHUHOI_DIR, { recursive: true });
  }
}

function readAntiThuHoiSettings() {
  ensureAntiThuHoiDir();
  try {
    if (!fs.existsSync(ANTITHUHOI_SETTINGS_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(ANTITHUHOI_SETTINGS_PATH, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeAntiThuHoiSettings(settings) {
  ensureAntiThuHoiDir();
  fs.writeFileSync(ANTITHUHOI_SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function getAntiThuHoiThreadMessageFile(threadID) {
  ensureAntiThuHoiDir();
  return path.join(ANTITHUHOI_DIR, `messages_${threadID}.json`);
}

function getAntiThuHoiSavedMessages(threadID) {
  const file = getAntiThuHoiThreadMessageFile(threadID);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch {}
  return [];
}

function saveAntiThuHoiMessages(threadID, messages) {
  const file = getAntiThuHoiThreadMessageFile(threadID);
  fs.writeFileSync(file, JSON.stringify(messages, null, 2));
}

function getAntiThuHoiState(threadID) {
  const settings = readAntiThuHoiSettings();
  return Boolean(settings[String(threadID)]);
}

function setAntiThuHoiState(threadID, enabled) {
  const settings = readAntiThuHoiSettings();
  settings[String(threadID)] = Boolean(enabled);
  writeAntiThuHoiSettings(settings);
}

async function saveLatestAntiThuHoiMessages(api, threadID) {
  try {
    const botID = String(api.getCurrentUserID());
    const threadInfo = await api.getThreadInfo(threadID);
    const memberInfo = Array.isArray(threadInfo?.userInfo) ? threadInfo.userInfo : [];
    const nameById = new Map(memberInfo.map((user) => [String(user.id), user.name || ""]));

    const history = await api.getThreadHistory(threadID, 15);

    const messages = history
      .filter((msg) => msg.body && String(msg.senderID) !== botID)
      .map((msg) => ({
        messageID: msg.messageID,
        senderID: msg.senderID,
        senderName: nameById.get(String(msg.senderID)) || msg.senderName || "Unknown",
        body: msg.body,
        timestamp: msg.timestamp,
        attachments: msg.attachments ? msg.attachments.length : 0,
      }))
      .reverse();

    saveAntiThuHoiMessages(threadID, messages);
    return messages.length;
  } catch (error) {
    console.error("Lỗi lưu tin nhắn anti-thu-hoi:", error);
    return 0;
  }
}

function toAdminIdList(threadInfo) {
  const list = Array.isArray(threadInfo?.adminIDs) ? threadInfo.adminIDs : [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return String(item || "").trim();
      return String(item.id || item.userID || item.adminID || "").trim();
    })
    .filter(Boolean);
}

function getBotAdminState(threadInfo, botID) {
  const adminIDs = toAdminIdList(threadInfo);
  return {
    adminIDs,
    isBotAdmin: adminIDs.includes(String(botID)),
  };
}

function getSenderPermission(threadInfo, senderID) {
  const adminIDs = toAdminIdList(threadInfo);
  const adminBotUIDs = getAdminBotUIDs();
  const isSenderAdmin = adminIDs.includes(String(senderID));
  const isSenderBotAdmin = Array.isArray(adminBotUIDs)
    ? adminBotUIDs.includes(String(senderID))
    : false;

  return { isSenderAdmin, isSenderBotAdmin };
}

function resolveTargetKey(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return null;

  const map = {
    "1": "antiout",
    antiout: "antiout",
    out: "antiout",
    "2": "antitagall",
    antitagall: "antitagall",
    tagall: "antitagall",
    "3": "antithuhoi",
    antithuhoi: "antithuhoi",
    thuhoi: "antithuhoi",
  };

  return map[value] || null;
}

function normalizeAction(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (["on", "off", "status", "st", "s", "toggle"].includes(value)) {
    return value;
  }
  return "toggle";
}

function parseReplySelection(replyText) {
  const tokens = String(replyText || "")
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);

  const targets = [];
  let action = "toggle";

  for (const token of tokens) {
    const targetKey = resolveTargetKey(token);
    if (targetKey) {
      targets.push(targetKey);
      continue;
    }

    const normalizedAction = normalizeAction(token);
    if (normalizedAction !== "toggle") {
      action = normalizedAction;
    }
  }

  return {
    targets: Array.from(new Set(targets)),
    action,
  };
}

function isGroupThread(threadInfo) {
  return Boolean(threadInfo && typeof threadInfo === "object" && threadInfo.isGroup);
}

function formatState(enabled) {
  return enabled ? "BẬT ✅" : "TẮT ❌";
}

function formatYesNo(value) {
  return value ? "✅ Có" : "❌ Không";
}

function buildMenuMessage({ threadID, antioutState, antitagallState, antithuhoiState, botAdminState }) {
  const savedMessages = getAntiThuHoiSavedMessages(threadID);

  return [
    `${ANTI_MENU_MARKER}`,
    "🛡️ BẢNG ĐIỀU KHIỂN ANTI",
    "━━━━━━━━━━━━━",
    `1️⃣ Antiout: ${formatState(antioutState.enabled)} | Bot QTV: ${formatYesNo(botAdminState.isBotAdmin)}`,
    "   ↳ Tự kéo lại người tự rời nhóm",
    `2️⃣ Antitagall: ${formatState(antitagallState.enabled)} | Bot QTV: ${formatYesNo(botAdminState.isBotAdmin)}`,
    "   ↳ Chống tag @everyone/@mọi người",
    `3️⃣ Antithuhoi: ${formatState(antithuhoiState.enabled)} | Đã lưu: ${savedMessages.length}/15`,
    "   ↳ Nhắc lại tin nhắn bị gỡ",
    "━━━━━━━━━━━━━",
    "Reply 1 / 2 / 3 hoặc 1 2 3 để bật/tắt nhiều mục cùng lúc.",
    "⏳ Menu sẽ tự thu hồi sau 60 giây.",
  ].join("\n");
}

async function sendMenu(api, threadID, payload) {
  const message = buildMenuMessage(payload);
  const sentMessage = await api.sendMessage(message, threadID);
  scheduleAutoUnsend(api, sentMessage);
  return sentMessage;
}

async function handleAntiout({ api, threadID, messageID, senderID, action, threadInfo }) {
  const botID = String(api.getCurrentUserID());
  const { isBotAdmin } = getBotAdminState(threadInfo, botID);
  const current = getAntioutSetting(threadID);

  if (action === "status") {
    return api.sendMessage(
      `🛡️ ANTIOUT: ${formatState(current.enabled)}\n👮 Bot có quyền QTV: ${formatYesNo(isBotAdmin)}\n💡 Reply 1 để bật/tắt antiout`,
      threadID,
      messageID,
    );
  }

  const desiredState = action === "off" ? false : action === "on" ? true : !current.enabled;
  if (current.enabled === desiredState) {
    return api.sendMessage(
      `ℹ️ Antiout ${desiredState ? "đã bật" : "đã tắt"} rồi.`,
      threadID,
      messageID,
    );
  }

  setAntioutEnabled(threadID, desiredState, String(senderID));

  if (desiredState && !isBotAdmin) {
    return api.sendMessage(
      "✅ Đã bật antiout, nhưng bot chưa có quyền QTV nên chưa thể kéo lại thành viên.\n💡 Hãy cấp quyền QTV cho bot để antiout hoạt động.",
      threadID,
      messageID,
    );
  }

  return api.sendMessage(
    desiredState ? "✅ Đã bật antiout." : "✅ Đã tắt antiout.",
    threadID,
    messageID,
  );
}

async function handleAntitagall({ api, threadID, messageID, senderID, action, threadInfo }) {
  const botID = String(api.getCurrentUserID());
  const { isBotAdmin } = getBotAdminState(threadInfo, botID);
  const current = getAntitagallSetting(threadID);

  if (action === "status") {
    return api.sendMessage(
      `🛡️ ANTITAGALL: ${formatState(current.enabled)}\n👮 Bot có quyền QTV: ${formatYesNo(isBotAdmin)}\n💡 Reply 2 để bật/tắt antitagall`,
      threadID,
      messageID,
    );
  }

  if (!isBotAdmin) {
    return api.sendMessage(
      "❌ Bot cần quyền Quản Trị Viên để bật/tắt antitagall!",
      threadID,
      messageID,
    );
  }

  const desiredState = action === "off" ? false : action === "on" ? true : !current.enabled;
  if (current.enabled === desiredState) {
    return api.sendMessage(
      `ℹ️ Antitagall ${desiredState ? "đã bật" : "đã tắt"} rồi.`,
      threadID,
      messageID,
    );
  }

  setAntitagallEnabled(threadID, desiredState, String(senderID));

  return api.sendMessage(
    desiredState
      ? "✅ Bật antitagall thành công!\n🛡️ Bot sẽ tự động kick người tag spam @everyone/@mọi người."
      : "❌ Tắt antitagall thành công.",
    threadID,
    messageID,
  );
}

async function handleAntiThuHoi({ api, threadID, messageID, senderID, action, threadInfo }) {
  const currentEnabled = getAntiThuHoiState(threadID);
  const savedMsgs = getAntiThuHoiSavedMessages(threadID);
  const botID = String(api.getCurrentUserID());
  const botAdminState = getBotAdminState(threadInfo, botID);

  if (action === "status") {
    return api.sendMessage(
      `🔍 ANTITHUHOI: ${formatState(currentEnabled)}\n📨 Tin nhắn đã lưu: ${savedMsgs.length}/15\n⚡ Cập nhật tức thời\n💡 Reply 3 để bật/tắt antithuhoi`,
      threadID,
      messageID,
    );
  }

  const desiredState = action === "off" ? false : action === "on" ? true : !currentEnabled;
  if (currentEnabled === desiredState) {
    return api.sendMessage(
      `ℹ️ Antithuhoi ${desiredState ? "đã bật" : "đã tắt"} rồi.`,
      threadID,
      messageID,
    );
  }

  setAntiThuHoiState(threadID, desiredState);

  if (!desiredState) {
    return api.sendMessage(
      "❌ Đã tắt ANTITHUHOI. Bot không còn nhắc lại tin nhắn bị gỡ.",
      threadID,
      messageID,
    );
  }

  const count = await saveLatestAntiThuHoiMessages(api, threadID);
  if (count > 0) {
    return api.sendMessage(
      `✅ Đã bật ANTITHUHOI!\n📨 Lưu ${count} tin nhắn gần nhất.\n⚡ Cập nhật tức thời khi có tin nhắn mới.\n🔔 Khi có tin nhắn bị gỡ, bot sẽ nhắc lại ngay!`,
      threadID,
      messageID,
    );
  }

  return api.sendMessage(
    "✅ Đã bật ANTITHUHOI!\nℹ️ Không nạp được lịch sử gần nhất, nhưng bot vẫn sẽ lưu tin nhắn mới để nhắc lại khi bị gỡ.",
    threadID,
    messageID,
  );
}

async function handleTargetAction({ api, threadID, messageID, senderID, targetKey, action, threadInfo }) {
  if (targetKey === "antiout") {
    return handleAntiout({ api, threadID, messageID, senderID, action, threadInfo });
  }

  if (targetKey === "antitagall") {
    return handleAntitagall({ api, threadID, messageID, senderID, action, threadInfo });
  }

  if (targetKey === "antithuhoi") {
    return handleAntiThuHoi({ api, threadID, messageID, senderID, action, threadInfo });
  }

  return null;
}

function isAntiMenuReply(event) {
  const repliedBody = String(event?.messageReply?.body || "");
  return repliedBody.includes(ANTI_MENU_MARKER);
}

module.exports = {
  name: "anti",
  aliases: ["antiout", "antitagall", "antithuhoi"],
  description: "Quản lý antiout, antitagall và antithuhoi trong một lệnh",
  usage:
    "\n!anti → Hiện menu anti\n!anti 1|2|3 → Bật/tắt mục tương ứng\n!anti antiout on|off|status → Điều khiển riêng từng mục\n━{13}\n🛡️ Gộp 3 cơ chế anti vào một menu duy nhất\n⏳ Menu tự thu hồi sau 60 giây\n💬 Reply 1/2/3 để bật/tắt cấu hình",

  execute: async ({ api, event, args }) => {
    const { threadID, messageID, senderID } = event;

    const cooldown = checkCooldown({ command: "anti", key: senderID, durationMs: 10000 });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    try {
      const threadInfo = await api.getThreadInfo(threadID);
      if (!isGroupThread(threadInfo)) {
        return api.sendMessage(
          "⚠️ Lệnh này chỉ dùng trong nhóm chat.",
          threadID,
          messageID,
        );
      }

      const { isSenderAdmin, isSenderBotAdmin } = getSenderPermission(threadInfo, senderID);
      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage(
          "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được dùng lệnh anti.",
          threadID,
          messageID,
        );
      }

      const botID = String(api.getCurrentUserID());
      const botAdminState = getBotAdminState(threadInfo, botID);
      const antioutState = getAntioutSetting(threadID);
      const antitagallState = getAntitagallSetting(threadID);
      const antithuhoiState = { enabled: getAntiThuHoiState(threadID) };

      const primaryToken = String(args[0] || "").trim().toLowerCase();
      const targetKey = resolveTargetKey(primaryToken);
      const action = normalizeAction(args[1]);

      if (!primaryToken || ["menu", "list", "help", "status"].includes(primaryToken)) {
        return sendMenu(api, threadID, {
          threadID,
          antioutState,
          antitagallState,
          antithuhoiState,
          botAdminState,
        });
      }

      if (!targetKey) {
        return api.sendMessage(
          "⚠️ Cách dùng: !anti [1|2|3|antiout|antitagall|antithuhoi] [on|off|status]",
          threadID,
          messageID,
        );
      }

      return handleTargetAction({
        api,
        threadID,
        messageID,
        senderID,
        targetKey,
        action,
        threadInfo,
      });
    } catch (error) {
      console.error("❌ Lỗi anti:", error);
      return api.sendMessage(
        `❌ Không thể cập nhật anti lúc này.\n⚠️ ${error.message || "Xem logs server để biết chi tiết"}`,
        threadID,
        messageID,
      );
    }
  },

  handleReply: async ({ api, event }) => {
    if (!isAntiMenuReply(event)) return;

    const { threadID, messageID, senderID } = event;
    const repliedBody = String(event.messageReply?.body || "");
    if (!repliedBody.includes(ANTI_MENU_MARKER)) return;

    try {
      const threadInfo = await api.getThreadInfo(threadID);
      if (!isGroupThread(threadInfo)) return;

      const { isSenderAdmin, isSenderBotAdmin } = getSenderPermission(threadInfo, senderID);
      if (!isSenderAdmin && !isSenderBotAdmin) return;

      const replyText = String(event.body || "").trim();
      if (!replyText) return;

      const { targets, action } = parseReplySelection(replyText);
      if (targets.length === 0) return;

      for (const targetKey of targets) {
        await handleTargetAction({
          api,
          threadID,
          messageID,
          senderID,
          targetKey,
          action,
          threadInfo,
        });
      }
    } catch (error) {
      console.error("❌ Lỗi anti handleReply:", error);
    }
  },
};