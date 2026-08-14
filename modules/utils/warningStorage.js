const { execute } = require("./database");
const { getAdminBotUIDs, toAdminIdList } = require("./checkPermission");
const { getThreadInfoCached } = require("./threadInfo");

let isInitialized = false;
let initPromise = null;

async function initTable() {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            await execute(`
                CREATE TABLE IF NOT EXISTS user_warnings (
                    thread_id TEXT,
                    user_id TEXT,
                    warning_count INTEGER DEFAULT 0,
                    reasons TEXT,
                    updated_at INTEGER,
                    PRIMARY KEY (thread_id, user_id)
                )
            `);
            isInitialized = true;
        } catch (err) {
            console.error("❌ Lỗi khởi tạo bảng user_warnings:", err);
        } finally {
            initPromise = null;
        }
    })();

    return initPromise;
}

// Tự động khởi tạo bảng
initTable().catch(() => {});

async function getUserName(api, threadID, userID) {
    try {
        const threadInfo = await getThreadInfoCached(api, threadID);
        if (threadInfo && Array.isArray(threadInfo.userInfo)) {
            const found = threadInfo.userInfo.find(u => String(u.id) === String(userID));
            if (found && found.name) return found.name;
        }
    } catch (e) {}

    if (global.data && global.data.userName && global.data.userName.has(String(userID))) {
        return global.data.userName.get(String(userID));
    }
    if (global.data && global.data.userName && global.data.userName.has(Number(userID))) {
        return global.data.userName.get(Number(userID));
    }

    try {
        const info = await api.getUserInfo(userID);
        if (info && info[userID] && info[userID].name) {
            if (global.data && global.data.userName) {
                global.data.userName.set(String(userID), info[userID].name);
            }
            return info[userID].name;
        }
    } catch (e) {}

    return "Người dùng";
}

async function isImmune(api, threadID, userID) {
    const botID = String(api.getCurrentUserID());
    if (String(userID) === botID) return true;

    const adminBots = getAdminBotUIDs();
    if (adminBots.includes(String(userID))) return true;

    try {
        const threadInfo = await getThreadInfoCached(api, threadID);
        const adminIDs = toAdminIdList(threadInfo);
        if (adminIDs.includes(String(userID))) return true;
    } catch (e) {
        // Bỏ qua lỗi lấy thông tin nhóm
    }

    return false;
}

async function kickUser(api, uid, tid) {
    if (typeof api.removeUserFromGroup === "function") {
        await api.removeUserFromGroup(uid, tid);
    } else if (typeof api.removeParticipant === "function") {
        await api.removeParticipant(uid, tid);
    } else if (typeof api.gcmember === "function") {
        await api.gcmember("remove", uid, tid);
    } else if (typeof api.removeUser === "function") {
        await api.removeUser(uid, tid);
    } else {
        throw new Error("Không tìm thấy hàm kick trong thư viện API");
    }
}

/**
 * Thêm cảnh báo cho người dùng
 */
async function addWarning(api, threadID, userID, reason = "Nhắc nhở chú ý luật nhóm") {
    await initTable();
    const tid = String(threadID);
    const uid = String(userID);
    const cleanReason = String(reason).trim() || "Nhắc nhở chú ý luật nhóm";

    // Kiểm tra quyền miễn trừ
    const immune = await isImmune(api, tid, uid);
    if (immune) {
        return { immune: true, count: 0 };
    }

    try {
        const rows = await execute("SELECT warning_count, reasons FROM user_warnings WHERE thread_id = ? AND user_id = ?", [tid, uid]);
        let currentCount = 0;
        let reasonsList = [];

        if (Array.isArray(rows) && rows.length > 0) {
            currentCount = Number(rows[0].warning_count || 0);
            try {
                reasonsList = JSON.parse(rows[0].reasons || "[]");
            } catch (e) {
                reasonsList = String(rows[0].reasons || "").split(";").filter(Boolean);
            }
        }

        currentCount += 1;
        reasonsList.push(cleanReason);

        const name = await getUserName(api, tid, uid);

        if (currentCount >= 3) {
            // Kick người dùng
            try {
                // Tắt tạm thời các sự kiện leave nếu có thể
                if (global.leaveEventSuppressByThread) {
                    global.leaveEventSuppressByThread[tid] = Date.now() + 15000;
                }
                await kickUser(api, uid, tid);
                await execute("DELETE FROM user_warnings WHERE thread_id = ? AND user_id = ?", [tid, uid]);
                api.sendMessage(
                    `🔨 [CẢNH BÁO] Thành viên ${name} (${uid}) đã đạt giới hạn 3 lần cảnh báo và bị kick khỏi nhóm!\n` +
                    `• Lần 1: ${reasonsList[0] || "Không rõ"}\n` +
                    `• Lần 2: ${reasonsList[1] || "Không rõ"}\n` +
                    `• Lần 3 (Cuối): ${cleanReason}`,
                    tid
                );
                return { kicked: true, count: currentCount };
            } catch (kickErr) {
                console.error(`[WarningStorage] Lỗi kick user ${uid}:`, kickErr);
                // Vẫn lưu vào db nhưng báo lỗi kick
                await execute(
                    `INSERT OR REPLACE INTO user_warnings (thread_id, user_id, warning_count, reasons, updated_at)
                     VALUES (?, ?, ?, ?, ?)`,
                    [tid, uid, currentCount, JSON.stringify(reasonsList), Date.now()]
                );
                api.sendMessage(
                    `⚠️ [CẢNH BÁO] Thành viên ${name} (${uid}) đã vi phạm lần 3 nhưng bot không thể kick (Thiếu quyền QTV hoặc lỗi Facebook).\n` +
                    `• Lý do vi phạm: ${cleanReason}`,
                    tid
                );
                return { kicked: false, error: true, count: currentCount };
            }
        } else {
            // Lưu lại điểm cảnh báo mới
            await execute(
                `INSERT OR REPLACE INTO user_warnings (thread_id, user_id, warning_count, reasons, updated_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [tid, uid, currentCount, JSON.stringify(reasonsList), Date.now()]
            );
            api.sendMessage(
                `⚠️ [CẢNH BÁO] Thành viên ${name} (${uid}) đã bị cảnh báo (Lần ${currentCount}/3)!\n` +
                `• Lý do: ${cleanReason}\n` +
                `*(Đạt đủ 3 lần cảnh báo sẽ bị kick tự động)*`,
                tid
            );
            return { kicked: false, count: currentCount };
        }
    } catch (err) {
        console.error(`[WarningStorage] Lỗi thêm cảnh báo cho user ${uid}:`, err);
        return { error: true, count: 0 };
    }
}

/**
 * Lấy thông tin cảnh báo của người dùng
 */
async function getWarnings(threadID, userID) {
    await initTable();
    try {
        const rows = await execute("SELECT warning_count, reasons FROM user_warnings WHERE thread_id = ? AND user_id = ?", [String(threadID), String(userID)]);
        if (Array.isArray(rows) && rows.length > 0) {
            let reasonsList = [];
            try {
                reasonsList = JSON.parse(rows[0].reasons || "[]");
            } catch (e) {
                reasonsList = String(rows[0].reasons || "").split(";").filter(Boolean);
            }
            return {
                count: Number(rows[0].warning_count || 0),
                reasons: reasonsList
            };
        }
    } catch (err) {
        console.error(`[WarningStorage] Lỗi lấy cảnh báo cho user ${userID}:`, err);
    }
    return { count: 0, reasons: [] };
}

/**
 * Reset cảnh báo của người dùng
 */
async function resetWarnings(threadID, userID) {
    await initTable();
    try {
        await execute("DELETE FROM user_warnings WHERE thread_id = ? AND user_id = ?", [String(threadID), String(userID)]);
        return true;
    } catch (err) {
        console.error(`[WarningStorage] Lỗi reset cảnh báo cho user ${userID}:`, err);
        return false;
    }
}

/**
 * Reset toàn bộ cảnh báo của nhóm
 */
async function resetAllWarnings(threadID) {
    await initTable();
    try {
        await execute("DELETE FROM user_warnings WHERE thread_id = ?", [String(threadID)]);
        return true;
    } catch (err) {
        console.error(`[WarningStorage] Lỗi reset tất cả cảnh báo của thread ${threadID}:`, err);
        return false;
    }
}

/**
 * Danh sách người dùng bị cảnh báo trong nhóm
 */
async function listWarnings(api, threadID) {
    await initTable();
    try {
        const rows = await execute("SELECT user_id, warning_count, reasons FROM user_warnings WHERE thread_id = ?", [String(threadID)]);
        if (Array.isArray(rows)) {
            const list = [];
            for (const r of rows) {
                let reasonsList = [];
                try {
                    reasonsList = JSON.parse(r.reasons || "[]");
                } catch (e) {
                    reasonsList = String(r.reasons || "").split(";").filter(Boolean);
                }
                const name = await getUserName(api, threadID, r.user_id);
                list.push({
                    userID: String(r.user_id),
                    name: name,
                    count: Number(r.warning_count || 0),
                    reasons: reasonsList
                });
            }
            return list;
        }
    } catch (err) {
        console.error(`[WarningStorage] Lỗi lấy danh sách cảnh báo của thread ${threadID}:`, err);
    }
    return [];
}

module.exports = {
    addWarning,
    getWarnings,
    resetWarnings,
    resetAllWarnings,
    listWarnings,
    getUserName
};
