const { execute } = require("./database");

// In-memory cache cho truy vấn nhanh
// Cache structure: threadID -> { enabled: boolean, notiEnabled: boolean, updatedAt: number, updatedBy: string }
const levelSettingsCache = new Map();
let isInitialized = false;
let initPromise = null;

/**
 * Khởi tạo bảng thread_level_settings trong SQLite
 */
async function initTable() {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            await execute(`
                CREATE TABLE IF NOT EXISTS thread_level_settings (
                    thread_id TEXT PRIMARY KEY,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    noti_enabled INTEGER NOT NULL DEFAULT 1,
                    updated_at INTEGER NOT NULL,
                    updated_by TEXT
                )
            `);

            try {
                await execute("ALTER TABLE thread_level_settings ADD COLUMN noti_enabled INTEGER NOT NULL DEFAULT 1");
            } catch (e) {
                // Cột đã tồn tại, bỏ qua lỗi
            }

            const rows = await execute("SELECT thread_id, enabled, noti_enabled, updated_at, updated_by FROM thread_level_settings");
            if (Array.isArray(rows)) {
                for (const row of rows) {
                    const tid = String(row.thread_id);
                    levelSettingsCache.set(tid, {
                        enabled: Number(row.enabled) !== 0,
                        notiEnabled: Number(row.noti_enabled ?? 1) !== 0,
                        updatedAt: Number(row.updated_at || 0),
                        updatedBy: String(row.updated_by || "")
                    });
                }
            }
            isInitialized = true;
        } catch (err) {
            console.error("❌ Lỗi khởi tạo bảng thread_level_settings:", err);
        } finally {
            initPromise = null;
        }
    })();

    return initPromise;
}

// Khởi tạo bảng ngay khi import
initTable().catch(() => {});

/**
 * Lấy cấu hình đầy đủ của nhóm chat
 * @param {string|number} threadID 
 * @returns {Promise<{enabled: boolean, notiEnabled: boolean, updatedAt: number, updatedBy: string}>}
 */
async function getLevelSetting(threadID) {
    const threadKey = String(threadID);
    if (levelSettingsCache.has(threadKey)) {
        return levelSettingsCache.get(threadKey);
    }

    await initTable();
    try {
        const rows = await execute(
            "SELECT enabled, noti_enabled, updated_at, updated_by FROM thread_level_settings WHERE thread_id = ?",
            [threadKey]
        );
        if (Array.isArray(rows) && rows.length > 0) {
            const setting = {
                enabled: Number(rows[0].enabled) !== 0,
                notiEnabled: Number(rows[0].noti_enabled ?? 1) !== 0,
                updatedAt: Number(rows[0].updated_at || 0),
                updatedBy: String(rows[0].updated_by || "")
            };
            levelSettingsCache.set(threadKey, setting);
            return setting;
        }
    } catch (err) {
        console.error(`❌ Lỗi lấy cấu hình level cho thread ${threadID}:`, err);
    }

    // Mặc định là ON cho cả tích EXP và Thông báo
    const defaultSetting = {
        enabled: true,
        notiEnabled: true,
        updatedAt: 0,
        updatedBy: ""
    };
    levelSettingsCache.set(threadKey, defaultSetting);
    return defaultSetting;
}

/**
 * Kiểm tra xem hệ thống level có được bật ở nhóm chat hay không (tích EXP)
 * @param {string|number} threadID 
 * @returns {Promise<boolean>}
 */
async function isLevelEnabled(threadID) {
    const setting = await getLevelSetting(threadID);
    return setting.enabled;
}

/**
 * Kiểm tra xem thông báo thăng cấp có được bật ở nhóm chat hay không
 * @param {string|number} threadID 
 * @returns {Promise<boolean>}
 */
async function isLevelNotiEnabled(threadID) {
    const setting = await getLevelSetting(threadID);
    return setting.enabled && setting.notiEnabled;
}

/**
 * Bật hoặc tắt hệ thống level cho nhóm chat
 * @param {string|number} threadID 
 * @param {boolean} enabled 
 * @param {string|number} updatedBy 
 * @returns {Promise<{enabled: boolean, notiEnabled: boolean, updatedAt: number, updatedBy: string}>}
 */
async function setLevelEnabled(threadID, enabled, updatedBy = "") {
    const threadKey = String(threadID);
    const current = await getLevelSetting(threadID);
    const isEnabled = Boolean(enabled);
    const now = Date.now();
    const updatedByStr = String(updatedBy || "");

    const newSetting = {
        ...current,
        enabled: isEnabled,
        updatedAt: now,
        updatedBy: updatedByStr
    };

    levelSettingsCache.set(threadKey, newSetting);

    await initTable();
    try {
        await execute(
            `INSERT OR REPLACE INTO thread_level_settings (thread_id, enabled, noti_enabled, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?)`,
            [threadKey, isEnabled ? 1 : 0, newSetting.notiEnabled ? 1 : 0, now, updatedByStr]
        );
    } catch (err) {
        console.error(`❌ Lỗi lưu cấu hình level cho thread ${threadID}:`, err);
    }

    return newSetting;
}

/**
 * Bật hoặc tắt thông báo thăng cấp cho nhóm chat
 * @param {string|number} threadID 
 * @param {boolean} notiEnabled 
 * @param {string|number} updatedBy 
 * @returns {Promise<{enabled: boolean, notiEnabled: boolean, updatedAt: number, updatedBy: string}>}
 */
async function setLevelNotiEnabled(threadID, notiEnabled, updatedBy = "") {
    const threadKey = String(threadID);
    const current = await getLevelSetting(threadID);
    const isNotiEnabled = Boolean(notiEnabled);
    const now = Date.now();
    const updatedByStr = String(updatedBy || "");

    const newSetting = {
        ...current,
        notiEnabled: isNotiEnabled,
        updatedAt: now,
        updatedBy: updatedByStr
    };

    levelSettingsCache.set(threadKey, newSetting);

    await initTable();
    try {
        await execute(
            `INSERT OR REPLACE INTO thread_level_settings (thread_id, enabled, noti_enabled, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?)`,
            [threadKey, newSetting.enabled ? 1 : 0, isNotiEnabled ? 1 : 0, now, updatedByStr]
        );
    } catch (err) {
        console.error(`❌ Lỗi lưu cấu hình noti level cho thread ${threadID}:`, err);
    }

    return newSetting;
}

module.exports = {
    getLevelSetting,
    isLevelEnabled,
    isLevelNotiEnabled,
    setLevelEnabled,
    setLevelNotiEnabled
};
