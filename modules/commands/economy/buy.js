const mysql = require('mysql2/promise');
const { checkCooldown } = require('../../utils/cooldown');
const { ensureEnergyPotionItem } = require('../../utils/energySystem');

module.exports = {
    name: "buy",
    description: "Mua vật phẩm từ shop",
    usage: "!buy [item-key] [số_lượng]",
    
    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        const itemKey = args[0]?.toLowerCase();
        const quantityStr = args[1];

        if (!itemKey) {
            return api.sendMessage("⚠️ Hãy nhập item key và số lượng.\nVí dụ: !buy shield 2", threadID, messageID);
        }

        // Check cooldown (10s)
        const cooldown = checkCooldown({ command: "buy", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi mua lại!`, threadID, messageID);
        }

        let quantity = 1;
        if (quantityStr) {
            quantity = parseInt(quantityStr);
            if (isNaN(quantity) || quantity <= 0) {
                return api.sendMessage("⚠️ Số lượng không hợp lệ!", threadID, messageID);
            }
        }

        const db = config.database;
        const dbConfig = { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name };

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);
            await ensureEnergyPotionItem(connection);

            // Check item tồn tại trong shop
            const [items] = await connection.execute('SELECT * FROM shop_items WHERE item_key = ?', [itemKey]);
            
            if (items.length === 0) {
                return api.sendMessage("❌ Item không tồn tại trong shop. Gọi !shop để xem danh sách.", threadID, messageID);
            }

            const item = items[0];
            const totalPrice = item.price * quantity;

            // Check tiền của người chơi
            const [users] = await connection.execute('SELECT credits, name FROM messenger_users WHERE psid = ?', [senderID]);
            
            if (users.length === 0) {
                return api.sendMessage("❌ Bạn chưa có tài khoản. Gọi !diemdanh để tạo tài khoản.", threadID, messageID);
            }

            const user = users[0];
            
            if (user.credits < totalPrice) {
                return api.sendMessage(`💸 Không đủ tiền!\nGiá: ${totalPrice.toLocaleString()} xu\nBạn có: ${user.credits.toLocaleString()} xu`, threadID, messageID);
            }

            await connection.beginTransaction();

            try {

            // Xử lý VIP riêng
            if (item.type === 'vip') {
                // Trừ tiền
                await connection.execute('UPDATE messenger_users SET credits = credits - ? WHERE psid = ?', [totalPrice, senderID]);
                
                // Tính thời gian VIP
                const now = new Date();
                const [currentUser] = await connection.execute('SELECT vip_until FROM messenger_users WHERE psid = ?', [senderID]);
                
                let vipUntil;
                if (currentUser[0].vip_until && new Date(currentUser[0].vip_until) > now) {
                    // Nếu đang có VIP, cộng thêm
                    vipUntil = new Date(currentUser[0].vip_until);
                    vipUntil.setDate(vipUntil.getDate() + (item.effect_value * quantity));
                } else {
                    // Nếu hết VIP hoặc chưa có, tính từ bây giờ
                    vipUntil = new Date();
                    vipUntil.setDate(vipUntil.getDate() + (item.effect_value * quantity));
                }
                
                await connection.execute('UPDATE messenger_users SET vip_until = ? WHERE psid = ?', [vipUntil, senderID]);

                await connection.commit();
                
                return api.sendMessage(
                    `✅ MUA THÀNH CÔNG!\n${item.name} x${quantity}\n💰 Trừ: ${totalPrice.toLocaleString()} xu\n👑 VIP đến: ${vipUntil.toLocaleString('vi-VN')}\n💳 Còn lại: ${(user.credits - totalPrice).toLocaleString()} xu`,
                    threadID, messageID
                );
            }

            // Xử lý các item khác
            // Check item đã có trong inventory chưa (nếu stackable thì tăng uses_left)
            if (item.stackable) {
                const [existing] = await connection.execute(
                    'SELECT * FROM user_inventory WHERE psid = ? AND item_key = ?', 
                    [senderID, itemKey]
                );
                
                const totalUses = item.uses * quantity;
                if (existing.length > 0) {
                    // Tăng uses_left
                    await connection.execute(
                        'UPDATE user_inventory SET uses_left = uses_left + ? WHERE psid = ? AND item_key = ?',
                        [totalUses, senderID, itemKey]
                    );
                } else {
                    // Thêm mới
                    await connection.execute(
                        'INSERT INTO user_inventory (psid, item_key, uses_left) VALUES (?, ?, ?)',
                        [senderID, itemKey, totalUses]
                    );
                }
            } else {
                // Không stackable, thêm mới từng cái
                for (let i = 0; i < quantity; i++) {
                    await connection.execute(
                        'INSERT INTO user_inventory (psid, item_key, uses_left) VALUES (?, ?, ?)',
                        [senderID, itemKey, item.uses]
                    );
                }
            }

            // Trừ tiền
            await connection.execute('UPDATE messenger_users SET credits = credits - ? WHERE psid = ?', [totalPrice, senderID]);

            await connection.commit();

            return api.sendMessage(
                `✅ MUA THÀNH CÔNG!\n${item.name} x${quantity}\n💰 Trừ: ${totalPrice.toLocaleString()} xu\n📦 Tổng lượng: ${item.uses * quantity}\n💳 Còn lại: ${(user.credits - totalPrice).toLocaleString()} xu`,
                threadID, messageID
            );

            } catch (txErr) {
                await connection.rollback();
                throw txErr;
            }

        } catch (e) {
            console.error(e);
            return api.sendMessage("❌ Lỗi khi mua item.", threadID, messageID);
        } finally {
            if (connection) await connection.end();
        }
    }
};
