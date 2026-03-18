const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '../../mode_settings.json');
const ADMIN_BOT_UIDS = ["100037351338722"]; // ID của chủ bot

/**
 * Đọc mode settings từ file
 */
function readSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        }
    } catch (e) {
        console.error("❌ Lỗi đọc mode_settings.json:", e);
    }
    return {};
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
    const settings = readSettings();
    const mode = settings[threadID] || "adminbot";
    
    // Chủ bot luôn được dùng
    if (ADMIN_BOT_UIDS.includes(String(senderID))) {
        return { allowed: true, reason: "Bot admin" };
    }

    // Mode USER: Ai cũng được
    if (mode === "user") {
        return { allowed: true, reason: "User mode" };
    }

    // Mode ADMINGR: Chủ bot + admin nhóm
    if (mode === "admingr") {
        try {
            const threadInfo = await api.getThreadInfo(threadID);
            const adminIDs = (threadInfo.adminIDs || []).map(a => String(a.id));
            
            if (adminIDs.includes(String(senderID))) {
                return { allowed: true, reason: "Group admin" };
            }
        } catch (e) {
            console.error("Lỗi lấy thông tin nhóm khi check permission:", e);
            return { allowed: false, reason: "Không thể xác minh quyền" };
        }
        
        return { allowed: false, reason: `Mode ${mode} - Bạn không phải admin nhóm` };
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
function getGroupMode(threadID) {
    threadID = String(threadID);
    const settings = readSettings();
    return settings[threadID] || "adminbot";
}

module.exports = {
    checkPermission,
    getGroupMode,
    ADMIN_BOT_UIDS
};
