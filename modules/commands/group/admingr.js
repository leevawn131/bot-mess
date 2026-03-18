const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "admingr",
    description: "Xem danh sách Quản trị viên nhóm (Lấy tên từ ThreadInfo)",
    execute: async ({ api, event }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "admingr", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            // 1. Lấy thông tin nhóm (Trong này đã có sẵn tên của các thành viên)
            const threadInfo = await api.getThreadInfo(threadID);
            
            if (!threadInfo.isGroup) {
                return api.sendMessage("⚠️ Lệnh này chỉ dùng trong nhóm chat.", threadID, messageID);
            }

            // 2. Lấy danh sách ID của Quản trị viên
            const adminIDs = threadInfo.adminIDs.map(item => String(item.id));
            
            // 3. Lấy mảng thông tin thành viên có sẵn trong nhóm
            const memberInfo = threadInfo.userInfo;

            let msg = `🛡️ DANH SÁCH QUẢN TRỊ VIÊN (${adminIDs.length})\n━━━━━━━━━━━━━━━━━━\n`;
            
            // 4. Duyệt qua danh sách Admin
            adminIDs.forEach((id, index) => {
                // Tìm thông tin của Admin đó trong mảng thành viên nhóm
                const user = memberInfo.find(u => String(u.id) === id);
                
                // Lấy tên (Ưu tiên tên thật, nếu không có thì dùng placeholder)
                const name = user ? user.name : "Thành viên ẩn danh";
                
                msg += `${index + 1}. ${name}\n`;
            });

            return api.sendMessage(msg, threadID, messageID);

        } catch (e) {
            console.error("Lỗi admingr:", e);
            return api.sendMessage("❌ Lỗi: Không thể truy xuất dữ liệu nhóm.", threadID, messageID);
        }
    }
};