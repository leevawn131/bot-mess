const path = require("path");
const fs = require("fs");
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
      if (!item) return "";
      if (typeof item === "object") {
        return String(item.id || item.userID || item.adminID || "").trim();
      }
      return String(item).trim();
    })
    .filter(Boolean);
}

/**
 * Get admin bot UIDs from config
 */
function getAdminBotUIDs() {
  try {
    let adminIDs = [];
    // Prefer reading adminIDs from config.json (persisted file) so runtime updates
    // written by the webhook (granting admin) are respected immediately.
    try {
      const cfgPath = path.join(__dirname, '../../config.json');
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf8');
        const cfg = JSON.parse(raw || '{}');
        if (Array.isArray(cfg.adminIDs)) {
          adminIDs = cfg.adminIDs.map(String);
        }
      }
    } catch (e) {
      // fallback to env-based bot config
      const config = getBotConfig();
      adminIDs = (config?.adminIDs || []).map(String);
    }

    // Always include the currently logged-in bot UID
    if (global.botID && !adminIDs.includes(String(global.botID))) {
      adminIDs.push(String(global.botID));
    } else if (global.api_instance && typeof global.api_instance.getCurrentUserID === 'function') {
      const botID = String(global.api_instance.getCurrentUserID());
      if (botID && !adminIDs.includes(botID)) {
        adminIDs.push(botID);
      }
    }

    return adminIDs;
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
 * @param {string} [commandName] - Tên lệnh đang thực thi
 * @returns {Promise<{allowed: boolean, reason: string}>}
 */
async function checkPermission(threadID, senderID, api, commandName = "") {
  threadID = String(threadID); // Convert sang string để match settings
  const settings = await readSettings();
  const mode = normalizeMode(settings[threadID] || "qtv");

  // Chủ bot luôn được dùng
  const adminBotUIDs = getAdminBotUIDs();
  if (adminBotUIDs.includes(String(senderID))) {
    return { allowed: true, reason: "Bot admin" };
  }

  // 1. Kiểm tra nếu người dùng bị cấm riêng trong nhóm này (Group Ban)
  try {
    const { isGroupBanned } = require("./groupBannedUsers");
    if (isGroupBanned(threadID, senderID)) {
      return { allowed: false, reason: "Bạn đã bị Người thuê bot / QTV cấm sử dụng bot trong nhóm này!" };
    }
  } catch (e) {}

  // 2. Người thuê bot (Renter) có quyền ưu tiên như QTV trong nhóm của họ
  try {
    const { getRenterID } = require("./rental");
    const renterID = await getRenterID(threadID);
    if (renterID && String(senderID) === String(renterID)) {
      return { allowed: true, reason: "Bot Renter (Người thuê bot)" };
    }
  } catch (e) {}

  // Bot tự dùng lệnh ngang hàng với admin
  const botUID = String(api.getCurrentUserID());
  if (String(senderID) === botUID) {
    return { allowed: true, reason: "Bot self-command" };
  }

  // Lệnh mode: Nếu nhóm thuê gói admin và người gửi là QTV nhóm hoặc người thuê bot -> Cho phép
  if (commandName === "mode") {
    try {
      const { checkIsAdminRental, getRenterID } = require("./rental");
      const isAdminRental = await checkIsAdminRental(threadID);
      if (isAdminRental) {
        const renterID = await getRenterID(threadID);
        const threadInfo = await getThreadInfoSafe(api, threadID);
        const adminIDs = threadInfo ? toAdminIdList(threadInfo) : [];
        if (adminIDs.includes(String(senderID)) || (renterID && String(senderID) === String(renterID))) {
          return { allowed: true, reason: "Group admin/renter in Admin-rented group (mode command unlocked)" };
        }
      }
    } catch (e) {
      console.error("[checkPermission] Error checking admin rental mode command:", e);
    }
  }

  // 3. Kiểm tra phân quyền bắt buộc của riêng lệnh đó (hasPermssion)
  let commandPermission = 0;
  if (commandName) {
    if (global.commands && typeof global.commands.get === "function") {
      const command = global.commands.get(commandName.toLowerCase());
      if (command) {
        commandPermission = command.hasPermssion ?? command.hasPermission ?? command.config?.hasPermssion ?? command.config?.hasPermission ?? 0;
      }
    }
  }

  if (commandPermission >= 2) {
    return { allowed: false, reason: "Lệnh này chỉ dành cho Admin Bot!" };
  } else if (commandPermission === 1) {
    let isQtv = false;
    try {
      const threadInfo = await getThreadInfoSafe(api, threadID);
      if (threadInfo) {
        const adminIDs = toAdminIdList(threadInfo);
        if (adminIDs.includes(String(senderID))) {
          isQtv = true;
        }
      }
    } catch (e) {}

    if (!isQtv) {
      return { allowed: false, reason: "Lệnh này chỉ dành cho Quản trị viên nhóm!" };
    }
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

  // Mode ADMINBOT: Chỉ chủ bot (nếu nhóm thuê gói admin thì QTV nhóm / người thuê bot cũng được)
  if (mode === "adminbot") {
    try {
      const { checkIsAdminRental, getRenterID } = require("./rental");
      const isAdminRental = await checkIsAdminRental(threadID);
      if (isAdminRental) {
        const renterID = await getRenterID(threadID);
        const threadInfo = await getThreadInfoSafe(api, threadID);
        const adminIDs = threadInfo ? toAdminIdList(threadInfo) : [];
        if (adminIDs.includes(String(senderID)) || (renterID && String(senderID) === String(renterID))) {
          return { allowed: true, reason: "Group admin/renter in Admin-rented group (adminbot mode)" };
        }
      }
    } catch (e) {
      console.error("[checkPermission] Error checking adminbot mode permission:", e);
    }

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
  readSettings,
  toAdminIdList
};
