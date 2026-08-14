const { execute } = require("./database");

// In-memory cache for fast lookups
const prefixCache = new Map();
let isInitialized = false;
let initPromise = null;

async function initTable() {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            await execute(`
                CREATE TABLE IF NOT EXISTS thread_nickname_prefix (
                    thread_id TEXT PRIMARY KEY,
                    prefix_symbol TEXT NOT NULL,
                    updated_at INTEGER,
                    updated_by TEXT
                )
            `);
            const rows = await execute("SELECT thread_id, prefix_symbol FROM thread_nickname_prefix");
            if (Array.isArray(rows)) {
                for (const row of rows) {
                    prefixCache.set(String(row.thread_id), row.prefix_symbol);
                }
            }
            isInitialized = true;
        } catch (err) {
            console.error("❌ Lỗi khởi tạo bảng thread_nickname_prefix:", err);
        } finally {
            initPromise = null;
        }
    })();

    return initPromise;
}

// Trigger table initialization
initTable().catch(() => {});

/**
 * Lấy ký tự biệt danh riêng của nhóm.
 * @param {string|number} threadID 
 * @returns {Promise<string|null>} Ký tự prefix hoặc null nếu không có
 */
async function getThreadPrefix(threadID) {
    const threadKey = String(threadID);
    if (prefixCache.has(threadKey)) {
        return prefixCache.get(threadKey);
    }
    await initTable();
    try {
        const rows = await execute("SELECT prefix_symbol FROM thread_nickname_prefix WHERE thread_id = ?", [threadKey]);
        if (Array.isArray(rows) && rows.length > 0) {
            const sym = rows[0].prefix_symbol;
            prefixCache.set(threadKey, sym);
            return sym;
        }
    } catch (err) {
        console.error(`❌ Lỗi lấy ký tự biệt danh cho thread ${threadID}:`, err);
    }
    return null;
}

/**
 * Lưu ký tự biệt danh riêng của nhóm.
 * @param {string|number} threadID 
 * @param {string} symbol 
 * @param {string|number} updatedBy 
 * @returns {Promise<string>}
 */
async function setThreadPrefix(threadID, symbol, updatedBy = "") {
    const threadKey = String(threadID);
    const cleanSymbol = String(symbol);
    prefixCache.set(threadKey, cleanSymbol);
    await initTable();
    try {
        await execute(
            `INSERT OR REPLACE INTO thread_nickname_prefix (thread_id, prefix_symbol, updated_at, updated_by)
             VALUES (?, ?, ?, ?)`,
            [threadKey, cleanSymbol, Date.now(), String(updatedBy)]
        );
    } catch (err) {
        console.error(`❌ Lỗi lưu ký tự biệt danh cho thread ${threadID}:`, err);
    }
    return cleanSymbol;
}

/**
 * Xóa ký tự biệt danh riêng của nhóm.
 * @param {string|number} threadID 
 * @returns {Promise<void>}
 */
async function removeThreadPrefix(threadID) {
    const threadKey = String(threadID);
    prefixCache.delete(threadKey);
    await initTable();
    try {
        await execute("DELETE FROM thread_nickname_prefix WHERE thread_id = ?", [threadKey]);
    } catch (err) {
        console.error(`❌ Lỗi xóa ký tự biệt danh cho thread ${threadID}:`, err);
    }
}

module.exports = {
    getThreadPrefix,
    setThreadPrefix,
    removeThreadPrefix
};
