const fs = require("fs");
const path = require("path");
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "top",
    description: "Xem top 10 người nhắn tin nhiều nhất",
    usage: "",
    execute: async ({ api, event }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "top", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            const statsPath = path.join(__dirname, "../../../message_stats.json");

            // Kiểm tra file tồn tại
            if (!fs.existsSync(statsPath)) {
                return api.sendMessage("📊 Chưa có dữ liệu thống kê. Hãy chờ một chút để bot thu thập dữ liệu!", threadID);
            }

            // Đọc dữ liệu
            const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
            
            // Lấy dữ liệu của nhóm hiện tại
            const threadStats = stats[threadID] || {};

            if (Object.keys(threadStats).length === 0) {
                return api.sendMessage("📊 Chưa có dữ liệu thống kê trong nhóm này.", threadID);
            }

            // Lấy thông tin nhóm (chứa tên tất cả thành viên)
            let threadInfo;
            let memberInfo = [];
            try {
                threadInfo = await api.getThreadInfo(threadID);
                memberInfo = threadInfo.userInfo || [];
            } catch (e) {
                console.error("Lỗi lấy threadInfo:", e);
            }

            // Chuyển đổi object thành mảng và sắp xếp
            const userStats = Object.entries(threadStats)
                .map(([userID, count]) => ({ userID, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10); // Lấy top 10

            // Lấy tên người dùng
            let msg = "🏆 TOP 10 NGƯỜI NHẮN TIN NHIỀU NHẤT 🏆\n";
            msg += "━━━━━━━━━━━━━━━━━━━━━━━━\n\n";

            for (let i = 0; i < userStats.length; i++) {
                const { userID, count } = userStats[i];
                
                // Tìm tên từ thông tin nhóm (cách hiệu quả nhất)
                let userName = "Người dùng";
                const user = memberInfo.find(u => String(u.id) === String(userID));
                if (user && user.name) {
                    userName = user.name;
                } else {
                    // Fallback: thử getUserInfo nếu không tìm thấy trong nhóm
                try {
                    const userInfo = await api.getUserInfo(userID);
                        userName = userInfo[userID]?.name || `User ${String(userID).slice(-6)}`;
                } catch (e) {
                        userName = `User ${String(userID).slice(-6)}`;
                    }
                }

                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🔹";
                const rank = (i + 1).toString().padStart(2, " ");
                
                msg += `${medal} ${rank}. ${userName}: ${count} tin nhắn\n`;
            }

            msg += "\n━━━━━━━━━━━━━━━━━━━━━━━━";

            return api.sendMessage(msg, threadID);

        } catch (e) {
            console.error("Lỗi top:", e);
            return api.sendMessage("❌ Lỗi khi lấy thống kê top 10.", threadID);
        }
    }
};
