const { execute } = require("./database");

// In-memory cache for fast prefix lookups with a 10-second TTL
// Structure: threadID -> { prefix, lastChecked, lastChanged }
const prefixCache = new Map();
let isInitialized = false;
let initPromise = null;

async function initTable() {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            await execute(`
                CREATE TABLE IF NOT EXISTS thread_custom_prefixes (
                    thread_id TEXT PRIMARY KEY,
                    prefix TEXT NOT NULL,
                    last_changed INTEGER NOT NULL,
                    changed_by TEXT
                )
            `);
            const rows = await execute("SELECT thread_id, prefix, last_changed FROM thread_custom_prefixes");
            if (Array.isArray(rows)) {
                const now = Date.now();
                for (const row of rows) {
                    const tid = String(row.thread_id);
                    prefixCache.set(tid, {
                        prefix: row.prefix,
                        lastChecked: now,
                        lastChanged: Number(row.last_changed || 0)
                    });

                    // Sync with global.data.threadData for backward compatibility
                    if (global.data && global.data.threadData) {
                        let tData = global.data.threadData.get(tid) || {};
                        tData.PREFIX = row.prefix;
                        global.data.threadData.set(tid, tData);
                    }
                }
            }
            isInitialized = true;
        } catch (err) {
            console.error("❌ Lỗi khởi tạo bảng thread_custom_prefixes:", err);
        } finally {
            initPromise = null;
        }
    })();

    return initPromise;
}

// Trigger table initialization
initTable().catch(() => {});

/**
 * Lấy prefix riêng của nhóm.
 * @param {string|number} threadID 
 * @returns {Promise<string|null>} Prefix riêng hoặc null nếu không có
 */
async function getCustomPrefix(threadID) {
    const threadKey = String(threadID);
    const now = Date.now();

    if (prefixCache.has(threadKey)) {
        const cached = prefixCache.get(threadKey);
        if (now - cached.lastChecked < 10000) { // 10 seconds cache TTL
            return cached.prefix;
        }
    }

    await initTable();
    try {
        const rows = await execute("SELECT prefix, last_changed FROM thread_custom_prefixes WHERE thread_id = ?", [threadKey]);
        if (Array.isArray(rows) && rows.length > 0) {
            const pref = rows[0].prefix;
            const lastChanged = Number(rows[0].last_changed || 0);

            prefixCache.set(threadKey, {
                prefix: pref,
                lastChecked: now,
                lastChanged: lastChanged
            });

            // Sync with global.data.threadData for backward compatibility
            if (global.data && global.data.threadData) {
                let tData = global.data.threadData.get(threadKey) || {};
                tData.PREFIX = pref;
                global.data.threadData.set(threadKey, tData);
            }

            return pref;
        } else {
            // Cache negative lookup so we do not spam DB checks
            prefixCache.set(threadKey, {
                prefix: null,
                lastChecked: now,
                lastChanged: 0
            });

            if (global.data && global.data.threadData) {
                let tData = global.data.threadData.get(threadKey) || {};
                delete tData.PREFIX;
                global.data.threadData.set(threadKey, tData);
            }
        }
    } catch (err) {
        console.error(`❌ Lỗi lấy custom prefix cho thread ${threadID}:`, err);
    }
    return prefixCache.has(threadKey) ? prefixCache.get(threadKey).prefix : null;
}

/**
 * Lưu prefix riêng của nhóm.
 * @param {string|number} threadID 
 * @param {string} prefix 
 * @param {string|number} senderID 
 * @returns {Promise<string>}
 */
async function setCustomPrefix(threadID, prefix, senderID = "") {
    const threadKey = String(threadID);
    const cleanPrefix = String(prefix).trim();
    const now = Date.now();

    prefixCache.set(threadKey, {
        prefix: cleanPrefix,
        lastChecked: now,
        lastChanged: now
    });

    // Sync with global.data.threadData for backward compatibility
    if (global.data && global.data.threadData) {
        let tData = global.data.threadData.get(threadKey) || {};
        tData.PREFIX = cleanPrefix;
        global.data.threadData.set(threadKey, tData);
    }

    await initTable();
    try {
        await execute(
            `INSERT OR REPLACE INTO thread_custom_prefixes (thread_id, prefix, last_changed, changed_by)
             VALUES (?, ?, ?, ?)`,
            [threadKey, cleanPrefix, now, String(senderID)]
        );
    } catch (err) {
        console.error(`❌ Lỗi lưu custom prefix cho thread ${threadID}:`, err);
    }
    return cleanPrefix;
}

/**
 * Lấy thời gian thay đổi prefix lần cuối của nhóm.
 * @param {string|number} threadID 
 * @returns {Promise<number>} Timestamp (ms) hoặc 0 nếu chưa từng thay đổi
 */
async function getLastChangedTime(threadID) {
    const threadKey = String(threadID);
    const now = Date.now();

    if (prefixCache.has(threadKey)) {
        const cached = prefixCache.get(threadKey);
        if (now - cached.lastChecked < 10000) {
            return cached.lastChanged;
        }
    }

    await initTable();
    try {
        const rows = await execute("SELECT prefix, last_changed FROM thread_custom_prefixes WHERE thread_id = ?", [threadKey]);
        if (Array.isArray(rows) && rows.length > 0) {
            const pref = rows[0].prefix;
            const lastChanged = Number(rows[0].last_changed || 0);

            prefixCache.set(threadKey, {
                prefix: pref,
                lastChecked: now,
                lastChanged: lastChanged
            });
            return lastChanged;
        } else {
            prefixCache.set(threadKey, {
                prefix: null,
                lastChecked: now,
                lastChanged: 0
            });
        }
    } catch (err) {
        console.error(`❌ Lỗi lấy thời gian đổi prefix cho thread ${threadID}:`, err);
    }
    return prefixCache.has(threadKey) ? prefixCache.get(threadKey).lastChanged : 0;
}

/**
 * Xóa prefix riêng của nhóm (quay về mặc định).
 * @param {string|number} threadID 
 * @returns {Promise<void>}
 */
async function removeCustomPrefix(threadID) {
    const threadKey = String(threadID);
    prefixCache.delete(threadKey);

    // Sync with global.data.threadData for backward compatibility
    if (global.data && global.data.threadData) {
        let tData = global.data.threadData.get(threadKey) || {};
        delete tData.PREFIX;
        global.data.threadData.set(threadKey, tData);
    }

    await initTable();
    try {
        await execute("DELETE FROM thread_custom_prefixes WHERE thread_id = ?", [threadKey]);
    } catch (err) {
        console.error(`❌ Lỗi xóa custom prefix cho thread ${threadID}:`, err);
    }
}

module.exports = {
    getCustomPrefix,
    setCustomPrefix,
    getLastChangedTime,
    removeCustomPrefix
};
