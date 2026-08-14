/**
 * LevelSystem.js - Version 1
 * Hệ thống Level & EXP cho bot Messenger.
 * Sử dụng SQLite3 thông qua module database.js.
 */

const { getConnection, ensureUserAccount } = require('./database');

// Cấu hình mặc định cho hệ thống level (có thể tùy chỉnh)
const CONFIG = {
    baseExp: 50,
    multiplier: 50,
    power: 1.4,
    chatCooldown: 30, // Cooldown cộng exp chat (giây)
    minCharLength: 3,  // Độ dài ký tự tối thiểu để nhận EXP
    charPerExp: 5,     // Số ký tự cho mỗi bậc EXP (1-5: 1 EXP, 6-10: 2 EXP,...)
    maxChatExp: 50     // Giới hạn EXP tối đa trên mỗi tin nhắn
};

// Lưu trữ bộ nhớ đệm cho nội dung tin nhắn gần nhất
const lastMessages = new Map();

let columnsChecked = false;

/**
 * Đảm bảo các cột Level/EXP tồn tại trong bảng messenger_users
 */
async function ensureLevelColumns(connection) {
    if (columnsChecked) return;
    try {
        const [columns] = await connection.execute("PRAGMA table_info(messenger_users)");
        const existing = new Set(columns.map((row) => String(row.name)));

        if (!existing.has("level")) {
            await connection.execute(
                "ALTER TABLE messenger_users ADD COLUMN level INTEGER NOT NULL DEFAULT 0"
            );
            console.log("✅ Đã thêm cột 'level' vào bảng messenger_users");
        }

        if (!existing.has("current_exp")) {
            await connection.execute(
                "ALTER TABLE messenger_users ADD COLUMN current_exp INTEGER NOT NULL DEFAULT 0"
            );
            console.log("✅ Đã thêm cột 'current_exp' vào bảng messenger_users");
        }

        if (!existing.has("total_exp")) {
            await connection.execute(
                "ALTER TABLE messenger_users ADD COLUMN total_exp INTEGER NOT NULL DEFAULT 0"
            );
            console.log("✅ Đã thêm cột 'total_exp' vào bảng messenger_users");
        }
        columnsChecked = true;
    } catch (err) {
        console.error("❌ Lỗi khởi tạo cột Level/EXP:", err.message);
    }
}

/**
 * Lấy số EXP yêu cầu để lên cấp tiếp theo
 * Công thức: floor(baseExp + multiplier * level^power)
 */
function getRequiredExp(level) {
    const lvl = Math.max(0, parseInt(level, 10) || 0);
    if (lvl === 0) return 20;
    if (lvl === 1) return 35;
    if (lvl === 2) return 55;
    if (lvl === 3) return 90;
    if (lvl === 4) return 150;

    // Từ Level 5 trở đi:
    const realLevel = lvl - 4;
    return Math.floor(150 + 50 * Math.pow(realLevel, 1.4));
}

/**
 * Lấy danh hiệu tương ứng với Level hiện tại (không lưu DB)
 */
function getTitle(level) {
    const lvl = Math.max(0, parseInt(level, 10) || 0);
    if (lvl === 0) return { icon: "🌑", title: "Sơ Khai" };
    if (lvl >= 1 && lvl <= 5) return { icon: "🌱", title: "Tân Thủ" };
    if (lvl >= 6 && lvl <= 10) return { icon: "📘", title: "Học Việc" };
    if (lvl >= 11 && lvl <= 15) return { icon: "📝", title: "Người Mới" };
    if (lvl >= 16 && lvl <= 20) return { icon: "💬", title: "Thành Viên" };
    if (lvl >= 21 && lvl <= 25) return { icon: "📣", title: "Năng Nổ" };
    if (lvl >= 26 && lvl <= 30) return { icon: "⭐", title: "Tích Cực" };
    if (lvl >= 31 && lvl <= 40) return { icon: "🎯", title: "Chăm Chỉ" };
    if (lvl >= 41 && lvl <= 50) return { icon: "🔥", title: "Cây Chat" };
    if (lvl >= 51 && lvl <= 60) return { icon: "🌟", title: "Nổi Bật" };
    if (lvl >= 61 && lvl <= 70) return { icon: "🎖️", title: "Gương Mặt Quen Thuộc" };
    if (lvl >= 71 && lvl <= 80) return { icon: "💎", title: "Kỳ Cựu" };
    if (lvl >= 81 && lvl <= 90) return { icon: "🛡️", title: "Người Đồng Hành" };
    if (lvl >= 91 && lvl <= 100) return { icon: "🏅", title: "Trụ Cột" };
    if (lvl >= 101 && lvl <= 120) return { icon: "👑", title: "Biểu Tượng" };
    if (lvl >= 121 && lvl <= 140) return { icon: "🚀", title: "Tiên Phong" };
    if (lvl >= 141 && lvl <= 160) return { icon: "⚡", title: "Huyền Thoại" };
    if (lvl >= 161 && lvl <= 180) return { icon: "🌌", title: "Bá Chủ" };
    if (lvl >= 181 && lvl <= 200) return { icon: "🏛️", title: "Tượng Đài" };
    if (lvl >= 201 && lvl <= 250) return { icon: "🏆", title: "Bất Tử" };
    if (lvl >= 251 && lvl <= 300) return { icon: "☀️", title: "Vô Song" };
    if (lvl >= 301 && lvl <= 400) return { icon: "🌠", title: "Thần Thoại" };
    if (lvl >= 401 && lvl <= 500) return { icon: "💠", title: "Chí Tôn" };
    return { icon: "♾️", title: "Bất Diệt" };
}

/**
 * Lấy cấp độ hiện tại của người dùng
 */
async function getLevel(uid, threadID = 'global') {
    const connection = await getConnection();
    await ensureLevelColumns(connection);

    try {
        const user = await ensureUserAccount(threadID, uid);
        return user.level !== undefined && user.level !== null ? Number(user.level) : 0;
    } catch (err) {
        console.error(`❌ Lỗi lấy level của ${uid}:`, err.message);
        return 0;
    }
}

/**
 * Lấy EXP hiện tại của người dùng
 */
async function getExp(uid, threadID = 'global') {
    const connection = await getConnection();
    await ensureLevelColumns(connection);

    try {
        const user = await ensureUserAccount(threadID, uid);
        return Number(user.current_exp) || 0;
    } catch (err) {
        console.error(`❌ Lỗi lấy EXP của ${uid}:`, err.message);
        return 0;
    }
}

/**
 * Lấy tổng số EXP của người dùng
 */
async function getTotalExp(uid, threadID = 'global') {
    const connection = await getConnection();
    await ensureLevelColumns(connection);

    try {
        const user = await ensureUserAccount(threadID, uid);
        return Number(user.total_exp) || 0;
    } catch (err) {
        console.error(`❌ Lỗi lấy tổng EXP của ${uid}:`, err.message);
        return 0;
    }
}

/**
 * Cộng thêm EXP cho người dùng (hỗ trợ cộng nhiều, thăng nhiều cấp cùng lúc)
 */
async function addExp(uid, amount, threadID = 'global', userName = "Người dùng") {
    amount = Math.max(0, parseInt(amount, 10) || 0);
    if (amount === 0) return null;

    const connection = await getConnection();
    await ensureLevelColumns(connection);

    try {
        // Đảm bảo user đã tồn tại
        const user = await ensureUserAccount(threadID, uid, userName);

        let level = user.level !== undefined && user.level !== null ? Number(user.level) : 0;
        let currentExp = (Number(user.current_exp) || 0) + amount;
        let totalExp = (Number(user.total_exp) || 0) + amount;

        let didLevelUp = false;
        let originalLevel = level;

        // Vòng lặp thăng cấp nếu EXP dư dồi dào
        while (currentExp >= getRequiredExp(level)) {
            currentExp -= getRequiredExp(level);
            level += 1;
            didLevelUp = true;
        }

        await connection.execute(
            `UPDATE messenger_users 
             SET level = ?, current_exp = ?, total_exp = ?
             WHERE thread_id = ? AND psid = ?`,
            [level, currentExp, totalExp, String(threadID), String(uid)]
        );

        return {
            uid,
            threadID,
            oldLevel: originalLevel,
            newLevel: level,
            currentExp,
            totalExp,
            didLevelUp
        };
    } catch (err) {
        console.error(`❌ Lỗi cộng EXP cho ${uid} tại nhóm ${threadID}:`, err.message);
        throw err;
    }
}

/**
 * Tính số EXP nhận được theo độ dài tin nhắn (cấp số cộng mỗi 5 ký tự, tối thiểu 3 ký tự)
 * < 3 ký tự: 0 EXP
 * 3 - 5 ký tự: 1 EXP
 * 6 - 10 ký tự: 2 EXP
 * 11 - 15 ký tự: 3 EXP
 * 16 - 20 ký tự: 4 EXP
 * ...
 */
function calculateChatExp(text) {
    if (!text || typeof text !== 'string') return 0;
    const trimmed = text.trim();
    const minLength = CONFIG.minCharLength || 3;
    if (trimmed.length < minLength) return 0;

    const step = CONFIG.charPerExp || 5;
    const rawExp = Math.ceil(trimmed.length / step);
    const maxExp = CONFIG.maxChatExp || 25;

    return Math.min(rawExp, maxExp);
}

/**
 * Cộng EXP từ tin nhắn trò chuyện (có kiểm tra cooldown & trùng lặp)
 */
async function addChatExp(uid, text, threadID = 'global', userName = "Người dùng") {
    if (!text || typeof text !== 'string') return null;
    const expToAdd = calculateChatExp(text);
    if (expToAdd <= 0) return null;

    // Kiểm tra trạng thái thuê bot (nếu là nhóm chat)
    if (threadID && threadID !== 'global') {
        try {
            const { checkRentalStatus } = require('./rental');
            const isRented = await checkRentalStatus(threadID);
            if (!isRented) return null;
        } catch (rentalErr) {
            console.error(`❌ Lỗi kiểm tra rentalStatus cho ${threadID}:`, rentalErr.message);
        }

        try {
            const { isLevelEnabled } = require('./levelSettings');
            const enabled = await isLevelEnabled(threadID);
            if (!enabled) return null;
        } catch (levelErr) {
            console.error(`❌ Lỗi kiểm tra isLevelEnabled cho ${threadID}:`, levelErr.message);
        }
    }

    // Kiểm tra tin nhắn trùng lặp (áp dụng riêng cho từng nhóm)
    const lastMsgKey = `${threadID}_${uid}`;
    const lastMsgText = lastMessages.get(lastMsgKey);
    if (lastMsgText === text) {
        return null;
    }

    // Lưu cache trạng thái
    lastMessages.set(lastMsgKey, text);

    // Tiến hành cộng EXP
    return await addExp(uid, expToAdd, threadID, userName);
}

module.exports = {
    getLevel,
    getExp,
    getTotalExp,
    getRequiredExp,
    getTitle,
    calculateChatExp,
    addChatExp,
    addExp,
    CONFIG
};
