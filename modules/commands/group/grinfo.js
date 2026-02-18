const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "grinfo",
    description: "Xem thông tin nhóm (Fix MessageID Error)",
    execute: async ({ api, event }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "grinfo", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            // 1. Lấy dữ liệu nhóm
            const threadInfo = await api.getThreadInfo(threadID);
            
            // 2. Xử lý thông tin
            const name = threadInfo.threadName || "Chưa đặt tên";
            const totalMembers = threadInfo.participantIDs.length;
            const totalAdmins = threadInfo.adminIDs.length;
            const approvalMode = threadInfo.approvalMode ? "Bật" : "Tắt";
            const emoji = threadInfo.emoji || "👍";
            
            // Đếm Nam/Nữ
            const boy = threadInfo.userInfo.filter(u => u.gender === "MALE").length;
            const girl = threadInfo.userInfo.filter(u => u.gender === "FEMALE").length;
            const other = totalMembers - boy - girl;

            // 3. Soạn nội dung
            let msg = `📂 === HỒ SƠ NHÓM === 📂\n`;
            msg += `━━━━━━━━━━━━━━━━━━\n`;
            msg += `📛 Tên: ${name}\n`;
            msg += `🛡️ Phê duyệt: ${approvalMode}\n`;
            msg += `👑 Quản trị viên: ${totalAdmins}\n`;
            msg += `👥 Tổng thành viên: ${totalMembers}\n`;
            msg += `   ♂️ Nam: ${boy} | ♀️ Nữ: ${girl} | 🌈 Khác: ${other}\n`;
            msg += `🎨 Emoji: ${emoji}\n`;
            msg += `━━━━━━━━━━━━━━━━━━`;

            // Ép kiểu messageID về chuỗi thuần túy để tránh lỗi "not String"
            const replyID = String(messageID);

            // 4. Xử lý ảnh nhóm
            if (threadInfo.imageSrc) {
                const imagePath = path.join(__dirname, `cache_grinfo_${threadID}.png`);
                try {
                    // Tải ảnh
                    const imageResponse = await axios.get(threadInfo.imageSrc, { responseType: "arraybuffer" });
                    fs.writeFileSync(imagePath, Buffer.from(imageResponse.data));

                    // Gửi tin nhắn (Dùng await, bỏ callback)
                    // Cấu trúc: sendMessage(msg, threadID, replyID)
                    await api.sendMessage({
                        body: msg,
                        attachment: fs.createReadStream(imagePath)
                    }, threadID, replyID);

                    // Xóa ảnh sau khi gửi xong
                    fs.unlinkSync(imagePath);

                } catch (e) {
                    console.error("Lỗi ảnh:", e);
                    // Nếu lỗi ảnh thì gửi text
                    return api.sendMessage(msg, threadID, replyID);
                }
            } else {
                // Nếu không có ảnh -> Gửi text
                return api.sendMessage(msg, threadID, replyID);
            }

        } catch (error) {
            console.error("Grinfo Error:", error);
            api.sendMessage("❌ Lỗi lấy thông tin nhóm.", threadID);
        }
    }
};