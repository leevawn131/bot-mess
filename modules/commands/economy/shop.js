const mysql = require('mysql2/promise');
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "shop",
    description: "Xem danh sách vật phẩm có thể mua",
    usage: "!shop",
    
    execute: async ({ api, event, config }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "shop", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        const db = config.database;
        const dbConfig = { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name };

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);

            const [items] = await connection.execute('SELECT * FROM shop_items ORDER BY price ASC');
            
            if (items.length === 0) {
                return api.sendMessage("❌ Shop hiện đang trống.", threadID, messageID);
            }

            let msg = "🏪 SHOP VẬT PHẨM\n━━━━━━━━━━━━━━━━━━\n\n";
            
            items.forEach((item, index) => {
                msg += `${index + 1}. ${item.name}\n`;
                msg += `   Key: ${item.item_key}\n`;
                msg += `   Giá: ${item.price.toLocaleString()} xu\n`;
                msg += `   Mô tả: ${item.description}\n\n`;
            });

            msg += "━━━━━━━━━━━━━━━━━━\n";
            msg += "👉 Mua: !buy [item-key]\n";
            msg += "Ví dụ: !buy shield";

            return api.sendMessage(msg, threadID, messageID);

        } catch (e) {
            console.error(e);
            return api.sendMessage("❌ Lỗi khi tải danh sách shop.", threadID, messageID);
        } finally {
            if (connection) await connection.end();
        }
    }
};
