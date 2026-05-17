const path = require("path");
const { getBotConfig } = require('./envConfig');
const { readJsonFile } = require('./secureFileOps');
const { debug } = require('./logger');

const SETTINGS_PATH = path.join(__dirname, "../../mode_settings.json");

const { getThreadInfoCached } = require('./threadInfo');

async function getThreadInfoSafe(api, threadID) {
  return getThreadInfoCached(api, threadID);
}

function normalizeMode(rawMode) {
  const mode = String(rawMode || "").toLowerCase();
  if (mode === "admingr") return "qtv"; // Tương thích dữ liệu cũ
  return mode;
}

function toAdminIdList(threadInfo) {
  const list = Array.isArray(threadInfo?.adminIDs) ? threadInfo.adminIDs : [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      return String(item.id || item.userID || item.adminID || "").trim();
    })
    .filter(Boolean);
}

/**
 * Get admin bot UIDs from config
 */
function getAdminBotUIDs() {
  try {
    const config = getBotConfig();
    return config?.adminIDs || [];
  } catch (error) {
    console.error('Error getting admin bot UIDs:', error);
    return [];
  }
}

/**
 * Read mode settings from file
 */
async function readSettings() {
  try {
    return await readJsonFile(SETTINGS_PATH, {});
  } catch (e) {
    debug('Error reading mode settings', { error: e.message });
    return {};
  }
}

/**
 * Kiểm tra quyền dùng lệnh theo mode của nhóm
 * @param {string} threadID - ID của nhóm
 * @param {string} senderID - ID của người gửi tin
 * @param {object} api - API object để lấy thông tin nhóm
 * @returns {Promise<{allowed: boolean, reason: string}>}
 */
async function checkPermission(threadID, senderID, api) {
  threadID = String(threadID); // Convert sang string để match settings
  const settings = await readSettings();
  const mode = normalizeMode(settings[threadID] || "qtv");

  // Chủ bot luôn được dùng
  const adminBotUIDs = getAdminBotUIDs();
  if (adminBotUIDs.includes(String(senderID))) {
    return { allowed: true, reason: "Bot admin" };
  }

  // Bot tự dùng lệnh ngang hàng với admin
  const botUID = String(api.getCurrentUserID());
  if (String(senderID) === botUID) {
    return { allowed: true, reason: "Bot self-command" };
  }

  // Mode USER: Ai cũng được
  if (mode === "user") {
    return { allowed: true, reason: "User mode" };
  }

  // Mode QTV: Chủ bot + quản trị viên nhóm
  if (mode === "qtv") {
    try {
      const threadInfo = await getThreadInfoSafe(api, threadID);
      if (!threadInfo) {
        // API lỗi, không block user
        return { allowed: true, reason: "Cannot verify (API error), allowing" };
      }
      const adminIDs = toAdminIdList(threadInfo);

      if (adminIDs.includes(String(senderID))) {
        return { allowed: true, reason: "Group admin" };
      }
    } catch (e) {
      // Không spam log
      return { allowed: true, reason: "Cannot verify (exception), allowing" };
    }

    return {
      allowed: false,
      reason: `Mode ${mode} - Bạn không phải quản trị viên nhóm`,
    };
  }

  // Mode ADMINBOT: Chỉ chủ bot
  if (mode === "adminbot") {
    return { allowed: false, reason: `Mode ${mode} - Chỉ chủ bot mở được` };
  }

  return { allowed: false, reason: "Chế độ không hợp lệ" };
}

/**
 * Lấy mode hiện tại của nhóm
 */
async function getGroupMode(threadID) {
  threadID = String(threadID);
  const settings = await readSettings();
  return settings[threadID] || "qtv";
}

module.exports = {
  checkPermission,
  getGroupMode,
  getAdminBotUIDs,
  readSettings
};
