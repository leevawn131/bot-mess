const fs = require("fs");
const path = require("path");

const BOT_INFO_PATH = path.join(__dirname, "../../runtime/bot_info.json");

/**
 * Đọc thông tin bot được lưu trong file runtime/bot_info.json
 * @returns {{ currentBotUID: string, botUIDs: string[], clusterBots: Record<string, string>, lastUpdated: string }}
 */
function getStoredBotInfo() {
  try {
    if (fs.existsSync(BOT_INFO_PATH)) {
      const raw = fs.readFileSync(BOT_INFO_PATH, "utf8");
      const data = JSON.parse(raw || "{}");
      return {
        currentBotUID: String(data.currentBotUID || "").trim(),
        botUIDs: Array.isArray(data.botUIDs)
          ? data.botUIDs.map((id) => String(id).trim()).filter(Boolean)
          : [],
        clusterBots:
          typeof data.clusterBots === "object" && data.clusterBots !== null
            ? data.clusterBots
            : {},
        lastUpdated: data.lastUpdated || "",
      };
    }
  } catch (error) {
    console.error("Lỗi đọc bot_info.json:", error.message);
  }

  return {
    currentBotUID: "",
    botUIDs: [],
    clusterBots: {},
    lastUpdated: "",
  };
}

/**
 * Lưu UID bot hiện tại vào file runtime/bot_info.json
 * @param {object} params
 * @param {string|number} params.botID - UID của bot vừa đăng nhập
 * @param {string|number} [params.clusterId=1] - ID cụm (nếu chạy multi-cluster)
 * @param {string} [params.profileName] - Tên profile appstate nếu có
 * @returns {object} Thông tin bot sau khi cập nhật
 */
function saveBotIdentity({ botID, clusterId = 1, profileName = "" } = {}) {
  const idStr = String(botID || "").trim();
  if (!idStr) return getStoredBotInfo();

  try {
    const runtimeDir = path.dirname(BOT_INFO_PATH);
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true });
    }

    const currentInfo = getStoredBotInfo();
    const botUIDsSet = new Set(currentInfo.botUIDs);
    botUIDsSet.add(idStr);

    const clusterKey = String(clusterId || 1);
    const updatedClusterBots = {
      ...currentInfo.clusterBots,
      [clusterKey]: {
        uid: idStr,
        profileName: profileName || undefined,
        updatedAt: new Date().toISOString(),
      },
    };

    const newData = {
      currentBotUID: idStr,
      botUIDs: Array.from(botUIDsSet),
      clusterBots: updatedClusterBots,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(BOT_INFO_PATH, JSON.stringify(newData, null, 2), "utf8");
    return newData;
  } catch (error) {
    console.error("❌ Lỗi lưu bot_info.json:", error.message);
    return getStoredBotInfo();
  }
}

/**
 * Lấy danh sách tất cả các UID bot đã từng ghi nhận từ trước tới nay
 * @returns {string[]}
 */
function getAllBotUIDs() {
  const stored = getStoredBotInfo();
  const set = new Set(stored.botUIDs);

  if (global.botID) {
    set.add(String(global.botID).trim());
  }

  if (
    global.api_instance &&
    typeof global.api_instance.getCurrentUserID === "function"
  ) {
    try {
      const uid = global.api_instance.getCurrentUserID();
      if (uid) set.add(String(uid).trim());
    } catch {}
  }

  return Array.from(set).filter(Boolean);
}

/**
 * Lấy UID của bot hiện tại đang chạy
 * @param {object} [api] - Optional API instance
 * @returns {string}
 */
function getBotUID(api) {
  if (api && typeof api.getCurrentUserID === "function") {
    try {
      const uid = api.getCurrentUserID();
      if (uid) return String(uid).trim();
    } catch {}
  }
  if (global.botID) return String(global.botID).trim();
  if (
    global.api_instance &&
    typeof global.api_instance.getCurrentUserID === "function"
  ) {
    try {
      const uid = global.api_instance.getCurrentUserID();
      if (uid) return String(uid).trim();
    } catch {}
  }
  const stored = getStoredBotInfo();
  return stored.currentBotUID || "";
}

/**
 * Kiểm tra xem 1 UID có phải là UID của bot hay không
 * @param {string|number} uid
 * @param {object} [api]
 * @returns {boolean}
 */
function isBotUID(uid, api) {
  const target = String(uid || "").trim();
  if (!target) return false;

  const currentBotUID = getBotUID(api);
  if (currentBotUID && target === currentBotUID) return true;

  const allBots = getAllBotUIDs();
  return allBots.includes(target);
}

module.exports = {
  BOT_INFO_PATH,
  getStoredBotInfo,
  saveBotIdentity,
  getAllBotUIDs,
  getBotUID,
  isBotUID,
};
