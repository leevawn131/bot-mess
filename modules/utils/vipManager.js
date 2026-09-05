const path = require('path');
const fs = require('fs');
const { readJsonFile, writeJsonFile } = require('./secureFileOps');
const { info, warn } = require('./logger');

const SETTINGS_PATH = path.join(__dirname, '../../runtime/vip_users.json');

/**
 * Đọc dữ liệu VIP từ file JSON và chuẩn hóa về dạng Object { [uid]: { ... } }
 */
async function getVipData() {
    try {
        const raw = await readJsonFile(SETTINGS_PATH, {});
        if (!raw) return {};

        // Nếu file được chỉnh tay dạng mảng: ["1000123", "1000456"]
        if (Array.isArray(raw)) {
            const normalized = {};
            for (const item of raw) {
                if (typeof item === 'string' || typeof item === 'number') {
                    const uid = String(item).trim();
                    if (uid) {
                        normalized[uid] = {
                            name: "Người dùng",
                            note: "Thêm thủ công",
                            addedBy: "Admin Bot",
                            addedAt: ""
                        };
                    }
                } else if (item && typeof item === 'object' && (item.id || item.uid || item.userID)) {
                    const uid = String(item.id || item.uid || item.userID).trim();
                    if (uid) {
                        normalized[uid] = {
                            name: String(item.name || "Người dùng").trim(),
                            note: String(item.note || "").trim(),
                            addedBy: String(item.addedBy || "Admin Bot").trim(),
                            addedAt: String(item.addedAt || "").trim()
                        };
                    }
                }
            }
            return normalized;
        }

        // Nếu file dạng Object: { "1000123": { ... } } hoặc { "1000123": true }
        if (typeof raw === 'object') {
            const normalized = {};
            for (const [key, value] of Object.entries(raw)) {
                const uid = String(key).trim();
                if (!uid) continue;

                if (typeof value === 'object' && value !== null) {
                    normalized[uid] = {
                        name: String(value.name || "Người dùng").trim(),
                        note: String(value.note || "").trim(),
                        addedBy: String(value.addedBy || "Admin Bot").trim(),
                        addedAt: String(value.addedAt || "").trim()
                    };
                } else {
                    normalized[uid] = {
                        name: "Người dùng",
                        note: String(value || "Thêm thủ công").trim(),
                        addedBy: "Admin Bot",
                        addedAt: ""
                    };
                }
            }
            return normalized;
        }

        return {};
    } catch (e) {
        warn("Lỗi đọc file vip_users.json", { error: e.message });
        return {};
    }
}

/**
 * Kiểm tra xem một UID có thuộc danh sách VIP hay không
 * @param {string|number} userID 
 * @returns {Promise<boolean>}
 */
async function isVipUser(userID) {
    if (!userID) return false;
    const uid = String(userID).trim();
    if (!uid) return false;

    const vipMap = await getVipData();
    return Object.prototype.hasOwnProperty.call(vipMap, uid);
}

/**
 * Lấy thông tin chi tiết của thành viên VIP
 * @param {string|number} userID 
 * @returns {Promise<object|null>}
 */
async function getVipInfo(userID) {
    if (!userID) return null;
    const uid = String(userID).trim();
    if (!uid) return null;

    const vipMap = await getVipData();
    if (Object.prototype.hasOwnProperty.call(vipMap, uid)) {
        return { id: uid, ...vipMap[uid] };
    }
    return null;
}

/**
 * Thêm hoặc cập nhật thành viên VIP
 * @param {string|number} userID 
 * @param {object} options 
 * @returns {Promise<boolean>}
 */
async function addVipUser(userID, { name = "Người dùng", note = "", addedBy = "Admin Bot" } = {}) {
    if (!userID) return false;
    const uid = String(userID).trim();
    if (!uid) return false;

    try {
        const vipMap = await getVipData();
        const now = new Date();
        const timeStr = now.toLocaleDateString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });

        vipMap[uid] = {
            name: String(name || "Người dùng").trim(),
            note: String(note || "").trim(),
            addedBy: String(addedBy || "Admin Bot").trim(),
            addedAt: timeStr
        };

        await writeJsonFile(SETTINGS_PATH, vipMap);
        info("Đã thêm thành viên VIP", { uid, name, note, addedBy });
        return true;
    } catch (e) {
        warn("Lỗi ghi dữ liệu VIP vào vip_users.json", { error: e.message });
        return false;
    }
}

/**
 * Xóa thành viên khỏi danh sách VIP
 * @param {string|number} userID 
 * @returns {Promise<boolean>}
 */
async function removeVipUser(userID) {
    if (!userID) return false;
    const uid = String(userID).trim();
    if (!uid) return false;

    try {
        const vipMap = await getVipData();
        if (!Object.prototype.hasOwnProperty.call(vipMap, uid)) {
            return false;
        }

        delete vipMap[uid];
        await writeJsonFile(SETTINGS_PATH, vipMap);
        info("Đã xóa thành viên VIP", { uid });
        return true;
    } catch (e) {
        warn("Lỗi xóa VIP trong vip_users.json", { error: e.message });
        return false;
    }
}

/**
 * Lấy danh sách toàn bộ thành viên VIP
 * @returns {Promise<Array<{id: string, name: string, note: string, addedBy: string, addedAt: string}>>}
 */
async function getAllVipUsers() {
    const vipMap = await getVipData();
    return Object.entries(vipMap).map(([id, info]) => ({
        id,
        name: info.name || "Người dùng",
        note: info.note || "",
        addedBy: info.addedBy || "Admin Bot",
        addedAt: info.addedAt || ""
    }));
}

module.exports = {
    SETTINGS_PATH,
    getVipData,
    isVipUser,
    getVipInfo,
    addVipUser,
    removeVipUser,
    getAllVipUsers
};
