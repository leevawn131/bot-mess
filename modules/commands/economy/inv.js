const mysql = require('mysql2/promise');
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "inv",
    description: "Xem túi đồ của bạn",
    usage: "!inv",
    
    execute: async ({ api, event, config }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "inv", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        const db = config.database;
        const dbConfig = { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name };

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);

            // Lấy inventory của user
            const [items] = await connection.execute(
                `SELECT ui.item_key, ui.uses_left, si.name, si.description 
                FROM user_inventory ui 
                JOIN shop_items si ON ui.item_key = si.item_key 
                WHERE ui.psid = ? AND ui.uses_left > 0`,
                [senderID]
            );
            
            // Check VIP status
            const [user] = await connection.execute('SELECT vip_until FROM messenger_users WHERE psid = ?', [senderID]);
            
            let msg = "🎒 TÚI ĐỒ CỦA BẠN\n━━━━━━━━━━━━━━━━━━\n\n";
            
            if (user.length > 0 && user[0].vip_until) {
                const vipUntil = new Date(user[0].vip_until);
                const now = new Date();
                
                if (vipUntil > now) {
                    const daysLeft = Math.ceil((vipUntil - now) / (1000 * 60 * 60 * 24));
                    msg += `👑 VIP: Còn ${daysLeft} ngày\n\n`;
                }
            }

            if (items.length === 0) {
                msg += "📦 Túi đồ trống!\n";
                msg += "👉 Gọi !shop để mua vật phẩm.";
            } else {
                items.forEach((item, index) => {
                    msg += `${index + 1}. ${item.name} (${item.item_key})\n`;
                    msg += `   Số lượt: ${item.uses_left}\n`;
                    msg += `   Mô tả: ${item.description}\n\n`;
                });
                msg += "━━━━━━━━━━━━━━━━━━\n";
                msg += "👉 Dùng: !use [item-key]";
            }

            return api.sendMessage(msg, threadID, messageID);

        } catch (e) {
            console.error(e);
            return api.sendMessage("❌ Lỗi khi xem túi đồ.", threadID, messageID);
        } finally {
            if (connection) await connection.end();
        }
    }
};
