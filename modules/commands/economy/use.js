const mysql = require('mysql2/promise');
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "use",
    description: "Sử dụng vật phẩm trong túi đồ",
    usage: "!use [item-key]",
    
    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        // Cooldown 5s
        const cooldown = checkCooldown({ command: "use", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }
        const itemKey = args[0]?.toLowerCase();

        if (!itemKey) {
            return api.sendMessage("⚠️ Hãy nhập item key.\nVí dụ: !use shield", threadID, messageID);
        }

        const db = config.database;
        const dbConfig = { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name };

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);

            // Check item trong inventory
            const [invItems] = await connection.execute(
                `SELECT ui.*, si.type, si.effect_value, si.uses, si.name 
                FROM user_inventory ui 
                JOIN shop_items si ON ui.item_key = si.item_key 
                WHERE ui.psid = ? AND ui.item_key = ? AND ui.uses_left > 0`,
                [senderID, itemKey]
            );
            
            if (invItems.length === 0) {
                return api.sendMessage("❌ Bạn không có item này trong túi.\nGọi !inv để xem túi đồ.", threadID, messageID);
            }

            const invItem = invItems[0];

            // Kiểm tra item type (chỉ dùng được một số loại)
            if (invItem.type === 'lootbox') {
                return api.sendMessage("❌ Hộp bí ẩn cần dùng lệnh !openbox", threadID, messageID);
            }

            if (invItem.type === 'vip') {
                return api.sendMessage("❌ VIP tự động kích hoạt khi mua, không cần dùng.", threadID, messageID);
            }

            // Kích hoạt effect vào active_effects
            // Check xem đã có effect này chưa
            const [existingEffects] = await connection.execute(
                'SELECT * FROM active_effects WHERE psid = ? AND effect_type = ?',
                [senderID, invItem.type]
            );

            if (existingEffects.length > 0) {
                // Tăng uses_left
                await connection.execute(
                    'UPDATE active_effects SET uses_left = uses_left + ?, effect_value = ? WHERE psid = ? AND effect_type = ?',
                    [invItem.uses, invItem.effect_value, senderID, invItem.type]
                );
            } else {
                // Thêm mới
                await connection.execute(
                    'INSERT INTO active_effects (psid, effect_type, effect_value, uses_left) VALUES (?, ?, ?, ?)',
                    [senderID, invItem.type, invItem.effect_value, invItem.uses]
                );
            }

            // Trừ uses_left trong inventory
            if (invItem.uses_left <= 1) {
                // Xóa item khỏi inventory nếu hết
                await connection.execute('DELETE FROM user_inventory WHERE id = ?', [invItem.id]);
            } else {
                await connection.execute('UPDATE user_inventory SET uses_left = uses_left - 1 WHERE id = ?', [invItem.id]);
            }

            return api.sendMessage(
                `✅ ĐÃ KÍCH HOẠT!\n${invItem.name}\n🔥 Hiệu ứng: ${invItem.type}\n📊 Giá trị: ${invItem.effect_value}%\n🎯 Còn ${invItem.uses} lượt sử dụng`,
                threadID, messageID
            );

        } catch (e) {
            console.error(e);
            return api.sendMessage("❌ Lỗi khi sử dụng item.", threadID, messageID);
        } finally {
            if (connection) await connection.end();
        }
    }
};
