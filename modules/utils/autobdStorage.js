const { execute } = require("./database");

// In-memory cache for ultra-fast lookups on hot paths
const autobdCache = new Map();
let isInitialized = false;
let initPromise = null;

/**
 * Initialize table for autobd thread settings in SQLite
 */
async function initTable() {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            await execute(`
                CREATE TABLE IF NOT EXISTS thread_autobd_settings (
                    thread_id TEXT PRIMARY KEY,
                    enabled INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER,
                    updated_by TEXT
                )
            `);
            const rows = await execute("SELECT thread_id, enabled FROM thread_autobd_settings");
            if (Array.isArray(rows)) {
                for (const row of rows) {
                    autobdCache.set(String(row.thread_id), Number(row.enabled) === 1);
                }
            }
            isInitialized = true;
        } catch (err) {
            console.error("❌ Lỗi khởi tạo bảng thread_autobd_settings:", err);
        } finally {
            initPromise = null;
        }
    })();

    return initPromise;
}

// Trigger initial setup
initTable().catch(() => {});

/**
 * Check if autobd is enabled for a given thread
 * @param {string|number} threadID
 * @returns {Promise<boolean>}
 */
async function isAutoBdEnabled(threadID) {
    const threadKey = String(threadID);
    if (autobdCache.has(threadKey)) {
        return autobdCache.get(threadKey);
    }
    await initTable();
    try {
        const rows = await execute("SELECT enabled FROM thread_autobd_settings WHERE thread_id = ?", [threadKey]);
        if (Array.isArray(rows) && rows.length > 0) {
            const enabled = Number(rows[0].enabled) === 1;
            autobdCache.set(threadKey, enabled);
            return enabled;
        }
    } catch (err) {
        console.error(`❌ Lỗi kiểm tra autobd cho thread ${threadID}:`, err);
    }
    autobdCache.set(threadKey, false);
    return false;
}

/**
 * Set autobd enabled or disabled for a given thread
 * @param {string|number} threadID
 * @param {boolean} enabled
 * @param {string|number} updatedBy
 * @returns {Promise<boolean>}
 */
async function setAutoBd(threadID, enabled, updatedBy = "") {
    const threadKey = String(threadID);
    const isEnabled = enabled ? 1 : 0;
    autobdCache.set(threadKey, Boolean(enabled));
    await initTable();
    try {
        await execute(
            `INSERT OR REPLACE INTO thread_autobd_settings (thread_id, enabled, updated_at, updated_by)
             VALUES (?, ?, ?, ?)`,
            [threadKey, isEnabled, Date.now(), String(updatedBy)]
        );
    } catch (err) {
        console.error(`❌ Lỗi cập nhật cấu hình autobd cho thread ${threadID}:`, err);
    }
    return Boolean(enabled);
}

module.exports = {
    isAutoBdEnabled,
    setAutoBd
};
