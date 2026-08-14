const { execute } = require("./database");

// In-memory cache to speed up lookups on member joins
const blockCache = new Map(); // thread_id -> Set of user_ids
let isInitialized = false;
let initPromise = null;

async function initTable() {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            await execute(`
                CREATE TABLE IF NOT EXISTS thread_blocked_members (
                    thread_id TEXT,
                    user_id TEXT,
                    name TEXT,
                    blocked_at INTEGER NOT NULL,
                    blocked_by TEXT,
                    PRIMARY KEY (thread_id, user_id)
                )
            `);
            try {
                await execute("ALTER TABLE thread_blocked_members ADD COLUMN name TEXT");
            } catch (e) {
                // Bỏ qua nếu cột đã tồn tại
            }

            const rows = await execute("SELECT thread_id, user_id FROM thread_blocked_members");
            if (Array.isArray(rows)) {
                for (const row of rows) {
                    const tid = String(row.thread_id);
                    const uid = String(row.user_id);
                    if (!blockCache.has(tid)) {
                        blockCache.set(tid, new Set());
                    }
                    blockCache.get(tid).add(uid);
                }
            }
            isInitialized = true;
        } catch (err) {
            console.error("❌ Lỗi khởi tạo bảng thread_blocked_members:", err);
        } finally {
            initPromise = null;
        }
    })();

    return initPromise;
}

// Trigger initialization on import
initTable().catch(() => {});

/**
 * Check if a user is blocked in a thread
 * @param {string|number} threadID 
 * @param {string|number} userID 
 * @returns {Promise<boolean>}
 */
async function isBlocked(threadID, userID) {
    const tid = String(threadID);
    const uid = String(userID);
    await initTable();
    if (blockCache.has(tid)) {
        return blockCache.get(tid).has(uid);
    }
    return false;
}

/**
 * Add a user to the block list
 * @param {string|number} threadID 
 * @param {string|number} userID 
 * @param {string} name 
 * @param {string} blockedBy 
 * @returns {Promise<boolean>}
 */
async function addBlock(threadID, userID, name = "", blockedBy = "") {
    const tid = String(threadID);
    const uid = String(userID);
    await initTable();

    if (!blockCache.has(tid)) {
        blockCache.set(tid, new Set());
    }
    blockCache.get(tid).add(uid);

    try {
        await execute(
            `INSERT OR REPLACE INTO thread_blocked_members (thread_id, user_id, name, blocked_at, blocked_by)
             VALUES (?, ?, ?, ?, ?)`,
            [tid, uid, String(name || "Người dùng Facebook"), Date.now(), String(blockedBy)]
        );
        return true;
    } catch (err) {
        console.error(`❌ Lỗi lưu blocked user ${uid} cho thread ${tid}:`, err);
        return false;
    }
}

/**
 * Remove a user from the block list (unban)
 * @param {string|number} threadID 
 * @param {string|number} userID 
 * @returns {Promise<boolean>}
 */
async function removeBlock(threadID, userID) {
    const tid = String(threadID);
    const uid = String(userID);
    await initTable();

    if (blockCache.has(tid)) {
        blockCache.get(tid).delete(uid);
    }

    try {
        await execute(
            "DELETE FROM thread_blocked_members WHERE thread_id = ? AND user_id = ?",
            [tid, uid]
        );
        return true;
    } catch (err) {
        console.error(`❌ Lỗi xoá blocked user ${uid} cho thread ${tid}:`, err);
        return false;
    }
}

/**
 * Get all blocked users in a thread
 * @param {string|number} threadID 
 * @returns {Promise<Array<{user_id: string, name: string, blocked_at: number, blocked_by: string}>>}
 */
async function getBlockedList(threadID) {
    const tid = String(threadID);
    await initTable();
    try {
        const rows = await execute(
            "SELECT user_id, name, blocked_at, blocked_by FROM thread_blocked_members WHERE thread_id = ? ORDER BY blocked_at DESC",
            [tid]
        );
        return rows || [];
    } catch (err) {
        console.error(`❌ Lỗi lấy danh sách blocked cho thread ${tid}:`, err);
        return [];
    }
}

module.exports = {
    isBlocked,
    addBlock,
    removeBlock,
    getBlockedList
};
