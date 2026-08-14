const { checkCooldown } = require('../../utils/cooldown');
const { getThreadInfoCached } = require('../../utils/threadInfo');
const LevelSystem = require('../../utils/LevelSystem');
const { getConnection } = require('../../utils/database');
const prefix = process.env.BOT_PREFIX || "!";

module.exports = {
    name: "toplv",
    description: "Xem bảng xếp hạng Level trong nhóm",
    usage: `\n${prefix}toplv → Xem bảng xếp hạng level của thành viên nhóm`,
    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "toplv", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            // 1. Lấy thông tin nhóm
            const threadInfo = await getThreadInfoCached(api, threadID);
            if (!threadInfo || typeof threadInfo !== 'object' || !threadInfo.isGroup) {
                return api.sendMessage("⚠️ Lệnh này chỉ sử dụng được trong nhóm chat.", threadID, messageID);
            }

            const participantIDs = Array.isArray(threadInfo.participantIDs)
                ? threadInfo.participantIDs.map((id) => String(id))
                : [];

            if (participantIDs.length === 0) {
                return api.sendMessage("📭 Không tìm thấy thành viên trong nhóm.", threadID, messageID);
            }

            // 2. Lấy dữ liệu Level/EXP từ database
            const connection = await getConnection();
            let dbRows = [];
            try {
                const [rows] = await connection.execute(
                    "SELECT psid, level, current_exp, total_exp FROM messenger_users WHERE thread_id = ?",
                    [String(threadID)]
                );
                dbRows = rows || [];
            } finally {
                connection.release();
            }

            const dbMap = new Map(dbRows.map(row => [String(row.psid), row]));
            const memberInfo = threadInfo.userInfo || [];
            const memberMap = new Map(memberInfo.map((u) => [String(u.id), u]));

            // 3. Map thành viên và sắp xếp theo Level/EXP
            const levelRanked = participantIDs.map(uid => {
                const user = memberMap.get(uid);
                const name = user?.name || `Thành viên (${uid.slice(-6)})`;
                const dbRow = dbMap.get(uid) || { level: 0, current_exp: 0, total_exp: 0 };
                return {
                    uid,
                    name,
                    level: dbRow.level !== undefined && dbRow.level !== null ? Number(dbRow.level) : 0,
                    currentExp: Number(dbRow.current_exp) || 0,
                    totalExp: Number(dbRow.total_exp) || 0
                };
            }).sort((a, b) => {
                if (b.level !== a.level) return b.level - a.level;
                return b.totalExp - a.totalExp;
            });

            // Lấy tối đa top 20
            const limit = 20;
            const topList = levelRanked.slice(0, limit);

            let msg = `🏆 BẢNG XẾP HẠNG LEVEL NHÓM 🏆\n`;
            msg += `━━━━━━━━━━━━━━━━━\n`;

            const formatNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

            topList.forEach((item, index) => {
                const titleInfo = LevelSystem.getTitle(item.level);
                msg += `${index + 1}. ${item.name} - Cấp ${item.level} ${titleInfo.icon} ${titleInfo.title}\n`;
            });

            msg += `━━━━━━━━━━━━━━━━━\n`;
            msg += `👉 Hãy tích cực trò chuyện để nâng cao thứ hạng của bạn!`;

            return api.sendMessage(msg, threadID, messageID);

        } catch (err) {
            console.error("❌ Lỗi lệnh toplv:", err);
            return api.sendMessage("⚠️ Đã xảy ra lỗi khi lấy bảng xếp hạng level.", threadID, messageID);
        }
    }
};
