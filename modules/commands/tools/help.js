const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "help",
    description: "Xem danh sách lệnh",
    usage: "[tên lệnh]",
    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;
        const prefix = "!"; 

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "help", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            // 1. Lấy danh sách lệnh từ Map global
            const commandList = Array.from(global.commands.keys());
            
            if (!args[0]) {
                // TẠO TIN NHẮN GỌN GÀNG (Tránh quá dài gây lỗi Facebook)
                let msg = "📜 DANH SÁCH LỆNH\n━━━━━━━━━━━━━\n";
                msg += commandList.join(", "); // Dùng dấu phẩy cho gọn để tránh quá nhiều dòng
                msg += `\n\n👉 Gõ ${prefix}help [tên lệnh] để xem chi tiết.`;

                // CHỈ GỬI 2 THAM SỐ ĐỂ AN TOÀN TUYỆT ĐỐI
                return api.sendMessage(msg, threadID);
            }

            // 2. Chi tiết từng lệnh
            const commandName = args[0].toLowerCase();
            const command = global.commands.get(commandName);

            if (!command) {
                return api.sendMessage(`❌ Lệnh "${commandName}" không tồn tại.`, threadID);
            }

            const detailMsg = `ℹ️ LỆNH: ${commandName.toUpperCase()}\n` +
                              `📝 Mô tả: ${command.description || "Chưa có"}\n` +
                              `🛠️ Cách dùng: ${prefix}${commandName} ${command.usage || ""}`;

            return api.sendMessage(detailMsg, threadID);

        } catch (e) {
            console.error("Lỗi Help:", e);
        }
    }
};