const fs = require('fs');
const path = require('path');
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "reset",
    description: "Khởi động lại Bot và thông báo khi thành công",
    execute: async ({ api, event, args, config }) => {
        const { threadID, senderID, messageID } = event;
        const adminIDs = config.adminIDs || [];

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "reset", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        if (!adminIDs.map(id => String(id)).includes(String(senderID))) {
            return api.sendMessage("⚠️ Chỉ Chủ bot mới được reset bot.", threadID);
        }

        try {
            // Lưu ID nhóm vào file tạm trước khi thoát
            const resetPath = path.join(__dirname, '../../../reset_data.json');
            fs.writeFileSync(resetPath, JSON.stringify({ 
                threadID: threadID,
                time: Date.now() 
            }));

            api.sendMessage("🔄 Đang khởi động lại hệ thống... Vui lòng chờ.", threadID);

            setTimeout(() => {
                process.exit(1); 
            }, 2000);
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    }
};