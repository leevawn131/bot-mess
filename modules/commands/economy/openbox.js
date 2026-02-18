const mysql = require('mysql2/promise');
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "openbox",
    description: "Mở hộp bí ẩn",
    usage: "!openbox, !openbox [số_lượng] hoặc !openbox all",
    
    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        
        // Xác định số lượng hộp cần mở
        let quantityToOpen = 1;
        let openAll = false;
        
        if (args[0]) {
            const arg = args[0].toLowerCase();
            if (arg === 'all') {
                openAll = true;
            } else {
                const num = parseInt(arg);
                if (isNaN(num) || num <= 0) {
                    return api.sendMessage("⚠️ Số lượng không hợp lệ!\nCách dùng: !openbox [số] hoặc !openbox all", threadID, messageID);
                }
                quantityToOpen = num;
            }
        }

        // Check cooldown (10s)
        const cooldown = checkCooldown({ command: "openbox", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi mở hộp lại!`, threadID, messageID);
        }

        const db = config.database;
        const dbConfig = { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name };

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);

            // Check xem có hộp bí ẩn không
            const [boxes] = await connection.execute(
                `SELECT ui.* FROM user_inventory ui 
                WHERE ui.psid = ? AND ui.item_key = 'box' AND ui.uses_left > 0`,
                [senderID]
            );
            
            if (boxes.length === 0) {
                return api.sendMessage("❌ Bạn không có hộp bí ẩn nào.\n👉 Mua tại !shop với giá 20,000 xu", threadID, messageID);
            }

            // Helper function để random phần thưởng
            const generateReward = () => {
                const rand = Math.random();
                let reward = {};

                if (rand < 0.815) {
                    // 81.5%: Tiền ít (8k-15k)
                    reward.type = 'credits';
                    reward.value = Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000;
                    reward.msg = `💰 ${reward.value.toLocaleString()} xu`;
                } else if (rand < 0.965) {
                    // 15%: Tiền trung bình (15k-30k)
                    reward.type = 'credits';
                    reward.value = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;
                    reward.msg = `💰 ${reward.value.toLocaleString()} xu`;
                } else if (rand < 0.995) {
                    // 3%: Tiền cao (40k-80k)
                    reward.type = 'credits';
                    reward.value = Math.floor(Math.random() * (80000 - 40000 + 1)) + 40000;
                    reward.msg = `💰 ${reward.value.toLocaleString()} xu`;
                } else {
                    // 0.5%: Tiền rất cao (200k)
                    reward.type = 'credits';
                    reward.value = 200000;
                    reward.msg = `💰 ${reward.value.toLocaleString()} xu 🎉`;
                }
                return reward;
            };

            if (openAll || quantityToOpen > 1) {
                // Mở nhiều hộp
                let totalBoxes = openAll ? boxes[0].uses_left : quantityToOpen;
                
                // Check xem có đủ hộp không
                if (totalBoxes > boxes[0].uses_left) {
                    return api.sendMessage(`❌ Bạn chỉ có ${boxes[0].uses_left} hộp. Không thể mở ${totalBoxes} hộp!`, threadID, messageID);
                }
                
                let totalCredits = 0;
                const rewards = [];

                // Mở từng hộp
                for (let i = 0; i < totalBoxes; i++) {
                    const reward = generateReward();
                    if (reward.type === 'credits') {
                        totalCredits += reward.value;
                        rewards.push(reward.msg);
                    }
                }

                // Trừ hộp bí ẩn
                const remainingBoxes = boxes[0].uses_left - totalBoxes;
                if (remainingBoxes <= 0) {
                    await connection.execute('DELETE FROM user_inventory WHERE id = ?', [boxes[0].id]);
                } else {
                    await connection.execute('UPDATE user_inventory SET uses_left = ? WHERE id = ?', [remainingBoxes, boxes[0].id]);
                }

                // Trao thưởng (credits)
                await connection.execute('UPDATE messenger_users SET credits = credits + ? WHERE psid = ?', [totalCredits, senderID]);

                // Đặt cooldown (10 giây)
                // Hiển thị kết quả
                const rewardList = rewards.slice(0, 10).join('\n');
                const remainingCount = rewards.length > 10 ? `\n... và ${rewards.length - 10} phần thưởng khác` : '';

                return api.sendMessage(
                    `📦 MỞ ${totalBoxes} HỘP BÍ ẨN\n━━━━━━━━━━━━━━━━━━\n\n✨ Phần thưởng:\n${rewardList}${remainingCount}\n\n💰 Tổng cộng: ${totalCredits.toLocaleString()} xu\n\n🎊 Chúc mừng!`,
                    threadID, messageID
                );
            } else {
                // Mở 1 hộp (cách cũ)
                const reward = generateReward();

                // Trừ hộp bí ẩn
                const box = boxes[0];
                if (box.uses_left <= 1) {
                    await connection.execute('DELETE FROM user_inventory WHERE id = ?', [box.id]);
                } else {
                    await connection.execute('UPDATE user_inventory SET uses_left = uses_left - 1 WHERE id = ?', [box.id]);
                }

                // Trao thưởng
                if (reward.type === 'credits') {
                    await connection.execute('UPDATE messenger_users SET credits = credits + ? WHERE psid = ?', [reward.value, senderID]);
                } else if (reward.type === 'item') {
                    // Check item đã có chưa
                    const [existing] = await connection.execute(
                        'SELECT * FROM user_inventory WHERE psid = ? AND item_key = ?',
                        [senderID, reward.itemKey]
                    );
                    
                    if (existing.length > 0) {
                        await connection.execute(
                            'UPDATE user_inventory SET uses_left = uses_left + ? WHERE psid = ? AND item_key = ?',
                            [reward.uses, senderID, reward.itemKey]
                        );
                    } else {
                        await connection.execute(
                            'INSERT INTO user_inventory (psid, item_key, uses_left) VALUES (?, ?, ?)',
                            [senderID, reward.itemKey, reward.uses]
                        );
                    }
                }

                return api.sendMessage(
                    `📦 MỞ HỘP BÍ ẨN\n━━━━━━━━━━━━━━━━━━\n\n✨ Bạn nhận được:\n${reward.msg}\n\n🎊 Chúc mừng!`,
                    threadID, messageID
                );
            }

        } catch (e) {
            console.error(e);
            return api.sendMessage("❌ Lỗi khi mở hộp.", threadID, messageID);
        } finally {
            if (connection) await connection.end();
        }
    }
};
