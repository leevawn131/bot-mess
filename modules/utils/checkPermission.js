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

  // Chủ bot luôn được dùng tất cả các lệnh
  const adminBotUIDs = getAdminBotUIDs();
  if (adminBotUIDs.includes(String(senderID))) {
    return { allowed: true, reason: "Bot admin" };
  }

  // Bot tự dùng lệnh ngang hàng với admin
  const botUID = String(api.getCurrentUserID());
  if (String(senderID) === botUID) {
    return { allowed: true, reason: "Bot self-command" };
  }

  // 1. Kiểm tra nếu người dùng bị cấm riêng trong nhóm này (Group Ban)
  try {
    const { isGroupBanned } = require("./groupBannedUsers");
    if (isGroupBanned(threadID, senderID)) {
      return { allowed: false, reason: "Bạn đã bị Người thuê bot / QTV cấm sử dụng bot trong nhóm này!" };
    }
  } catch (e) {}

  // 2. Xác định vai trò của người gửi: QTV nhóm, Người thuê bot (Renter), và gói thuê Admin
  let isQtv = false;
  let isRenter = false;
  let isAdminRental = false;

  try {
    const threadInfo = await getThreadInfoSafe(api, threadID);
    if (threadInfo) {
      const adminIDs = toAdminIdList(threadInfo);
      if (adminIDs.includes(String(senderID))) {
        isQtv = true;
      }
    }
  } catch (e) {}

  try {
    const { getRenterID, checkIsAdminRental } = require("./rental");
    const renterID = await getRenterID(threadID);
    if (renterID && String(senderID) === String(renterID)) {
      isRenter = true;
    }
    isAdminRental = await checkIsAdminRental(threadID);
  } catch (e) {}

  // 3. XỬ LÝ RIÊNG CHO LỆNH 'mode':
  // - Admin Bot luôn luôn được dùng (đã pass ở đầu hàm).
  // - Quản trị viên / Người thuê bot của nhóm thuê gói Admin (isAdminRental) được dùng lệnh mode.
  // - Quản trị viên nhóm thuê gói Thường (kể cả người thuê gói thường) TUYỆT ĐỐI KHÔNG ĐƯỢC DÙNG lệnh mode.
  if (commandName === "mode") {
    if (isAdminRental && (isQtv || isRenter)) {
      return { allowed: true, reason: "Group admin/renter in Admin-rented group (mode command allowed)" };
    }
    return { allowed: false, reason: "Lệnh mode chỉ dành cho Admin Bot hoặc Quản trị viên của nhóm thuê gói Admin!" };
  }

  // 4. XỬ LÝ KHI NHÓM Ở MODE ADMINBOT:
  // Khi ở mode adminbot: KHÔNG CÓ AI ĐƯỢC DÙNG BOT NGOÀI ADMIN BOT (kể cả QTV nhóm, người thuê bot).
  if (mode === "adminbot") {
    return { allowed: false, reason: "Mode adminbot - Chỉ Admin Bot mới được sử dụng bot!" };
  }

  // 5. Kiểm tra phân quyền bắt buộc của riêng lệnh đó (hasPermission / hasPermssion)
  let commandPermission = 0;
  if (commandName) {
    if (global.commands && typeof global.commands.get === "function") {
      const command = global.commands.get(commandName.toLowerCase());
      if (command) {
        commandPermission = command.hasPermssion ?? command.hasPermission ?? command.config?.hasPermssion ?? command.config?.hasPermission ?? 0;
      }
    }
  }

  // Lệnh Admin Bot (hasPermission >= 2): Chỉ Admin Bot (đã pass ở đầu hàm) mới được dùng
  if (commandPermission >= 2) {
    return { allowed: false, reason: "Lệnh này chỉ dành cho Admin Bot!" };
  }

  // Lệnh QTV (hasPermission === 1): Chỉ QTV nhóm hoặc Người thuê bot mới được dùng
  if (commandPermission === 1) {
    if (!isQtv && !isRenter) {
      return { allowed: false, reason: "Lệnh này chỉ dành cho Quản trị viên nhóm!" };
    }
  }

  // 6. Mode QTV: Chỉ QTV nhóm hoặc Người thuê bot mới được dùng bot
  if (mode === "qtv") {
    if (isQtv || isRenter) {
      return { allowed: true, reason: "Group admin / Renter in QTV mode" };
    }
    return { allowed: false, reason: "Mode qtv - Chỉ Quản trị viên nhóm mới được dùng bot!" };
  }

  // 7. Mode USER: Mọi thành viên trong nhóm đều được dùng
  if (mode === "user") {
    return { allowed: true, reason: "User mode" };
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
