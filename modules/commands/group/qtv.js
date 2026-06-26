const { checkCooldown } = require('../../utils/cooldown');
const { toAdminIdList } = require('../../utils/checkPermission');
const { getThreadInfoCached, clearThreadInfoCache } = require('../../utils/threadInfo');
const prefix = process.env.BOT_PREFIX;

module.exports = {
    name: "qtv",
    description: "Xem danh sách Quản trị viên nhóm",
    usage: `\n${prefix}qtv → Xem danh sách QTV của nhóm hiện tại\n━━━━━━━━━━━━━\n🛡️ Hiển thị STT và tên từng QTV`,
    execute: async ({ api, event }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "qtv", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            // 1. Lấy thông tin nhóm (Trong này đã có sẵn tên của các thành viên)
            clearThreadInfoCache(threadID);
            const threadInfo = await getThreadInfoCached(api, threadID);
            
            if (!threadInfo || typeof threadInfo !== 'object' || !threadInfo.isGroup) {
                return api.sendMessage("⚠️ Không thể lấy thông tin nhóm hoặc lệnh này chỉ dùng trong nhóm chat.", threadID, messageID);
            }

            // 2. Lấy danh sách ID của Quản trị viên
            const adminIDs = toAdminIdList(threadInfo);
            
            // 3. Lấy mảng thông tin thành viên có sẵn trong nhóm
            const memberInfo = threadInfo.userInfo || [];

            let msg = `🛡️ DANH SÁCH QUẢN TRỊ VIÊN (${adminIDs.length})\n━━━━━━━━━━━━━\n`;
            
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
            console.error("Lỗi lệnh qtv:", e);
            return api.sendMessage("❌ Lỗi: Không thể truy xuất dữ liệu nhóm.", threadID, messageID);
        }
    }
};