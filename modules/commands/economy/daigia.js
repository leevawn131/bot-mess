const { execute } = require('../../utils/database');
const path = require("path");
const fs = require("fs");
const { checkCooldown } = require('../../utils/cooldown');
const { getThreadInfoCached } = require('../../utils/threadInfo');
const prefix = process.env.BOT_PREFIX;

// ID CỦA BẠN (Sẽ bị loại khỏi danh sách xếp hạng)
const BOSS_ID = "100037351338722";

module.exports = {
    name: "daigia",
    description: "Xem top 10 đại gia giàu nhất",
    usage: `\n${prefix}daigia → Xem bảng xếp hạng Top 10 người giàu nhất\n━━━━━━━━━━━━━\n📊 Xếp hạng theo tổng xu hiện có\n🏆 Hiển thị tên, số xu và thứ hạng của bạn`,
    execute: async ({ api, event }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "daigia", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            // 2. Lấy thông tin nhóm để lấy danh sách thành viên
            let memberInfo = [];
            try {
                const threadInfo = await getThreadInfoCached(api, threadID);
                memberInfo = threadInfo.userInfo || [];
            } catch (e) {
                console.error("Lỗi lấy threadInfo:", e);
            }

            // Lấy danh sách userID trong nhóm VÀ LOẠI BỎ BOSS_ID NGAY LẬP TỨC
            const memberIDs = memberInfo
                .map(m => String(m.id))
                .filter(id => id !== BOSS_ID); // <--- Lọc ID của bạn ở đây

            if (memberIDs.length === 0) {
                return api.sendMessage("📊 Không thể lấy danh sách thành viên nhóm (hoặc nhóm chỉ có mình Boss).", threadID);
            }

            // 3. Lấy top 10 người giàu nhất trong nhóm từ bảng messenger_users (Thế giới này)
            let rows = [];
            try {
                const placeholders = memberIDs.map(() => '?').join(',');
                rows = await execute(
                    `SELECT psid, credits, name FROM messenger_users
                     WHERE thread_id = ? AND psid IN (${placeholders})
                     ORDER BY credits DESC LIMIT 10`,
                    [String(threadID), ...memberIDs]
                );
            } catch (e) {
                console.error("Lỗi truy vấn đại gia:", e);
            }

            if (rows.length === 0) {
                return api.sendMessage("📊 Chưa có dữ liệu đại gia trong nhóm này.", threadID);
            }

            // 4. Tạo message hiển thị
            let msg = "💎 TOP 10 ĐẠI GIA 💎\n";
            msg += "━━━━━━━━━━━━━━━━━━━━━━━\n\n";

            for (let i = 0; i < rows.length; i++) {
                const userID = String(rows[i].psid);
                const credits = parseInt(rows[i].credits) || 0;

                // Tìm tên từ thông tin nhóm (ưu tiên)
                let userName = rows[i].name || "Người dùng";
                const user = memberInfo.find(u => String(u.id) === userID);
                if (user && user.name) {
                    userName = user.name;
                }

                // Emoji huy chương
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🔹";
                const rank = (i + 1).toString().padStart(2, " ");

                msg += `${medal} ${rank}. ${userName}: ${credits.toLocaleString('vi-VN')} credits\n`;
            }

            msg += "\n━━━━━━━━━━━━━━━━━━━━━━━";
            return api.sendMessage(msg, threadID);

        } catch (e) {
            console.error("Lỗi daigia:", e);
            return api.sendMessage("❌ Lỗi khi lấy thống kê đại gia.", threadID);
        }
    }
};