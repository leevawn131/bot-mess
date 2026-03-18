const mysql = require('mysql2/promise');
const { checkCooldown } = require('../../utils/cooldown');
const { recordAction } = require('../../utils/questSystem');
const { consumeEnergy } = require('../../utils/energySystem');

module.exports = {
    name: "lamviec",
    description: "Làm việc kiếm tiền (Có tỷ lệ Fail mất tiền)",
    execute: async ({ api, event, config }) => {
        const { threadID, messageID, senderID } = event;
        
        // 1. CHECK COOLDOWN (60 giây)
        const cooldown = checkCooldown({ command: "lamviec", key: senderID, durationMs: 60000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Nghỉ mệt đi đại ca! Chờ ${cooldown.timeLeft}s nữa hãy làm tiếp.`, threadID, messageID);
        }

        // 2. KẾT NỐI DATABASE
        const db = config.database;
        const dbConfig = { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name };
        
        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);
            
            // Check tài khoản
            const [rows] = await connection.execute('SELECT credits, vip_until FROM messenger_users WHERE psid = ?', [senderID]);
            if (rows.length === 0) return api.sendMessage("❌ Bạn chưa có tài khoản. Gõ !tien tạo trước đã.", threadID, messageID);

            const energyUse = await consumeEnergy(connection, senderID, 15);
            if (!energyUse.ok) {
                if (energyUse.reason === 'not_enough') {
                    return api.sendMessage(energyUse.message, threadID, messageID);
                }
                return api.sendMessage("❌ Không thể kiểm tra thể lực lúc này.", threadID, messageID);
            }
            
            const currentBalance = parseInt(rows[0].credits);
            
            // Check VIP status
            const now = new Date();
            const hasVIP = rows[0].vip_until && new Date(rows[0].vip_until) > now;
            
            // Check work_glove effect
            const [workGlove] = await connection.execute(
                'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "work_bonus" AND uses_left > 0',
                [senderID]
            );
            const hasWorkGlove = workGlove.length > 0;

            // 3. TÍNH TOÁN (LÀM ĐƯỢC HAY FAIL)
            // Tỷ lệ fail: 20% (Random < 0.2)
            let failRate = 0.2;
            
            // VIP giảm 10% xui (20% -> 10%)
            if (hasVIP) {
                failRate = 0.1;
            }
            
            const isFail = Math.random() < failRate;

            if (isFail) {
                // --- TRƯỜNG HỢP FAIL (MẤT TIỀN) ---
                const fines = [
                    "đi bán vé số bị giật mất tập vé",
                    "làm bồi bàn lỡ tay làm vỡ chồng bát đĩa",
                    "đi chạy Grab vượt đèn đỏ bị công an bắt",
                    "làm bảo vệ ngủ gật bị trộm dắt mất chiếc xe đạp",
                    "đi ship hàng bị khách bom hàng",
                    "ngồi code thuê lỡ tay xóa nhầm database khách hàng",
                    "đi phụ hồ làm rơi viên gạch trúng chân cai thầu",
                    "đi phát tờ rơi xả rác bừa bãi bị dân phòng phạt",
                    "đang đi làm thì bị người yêu cũ trấn lột"
                ];
                const reason = fines[Math.floor(Math.random() * fines.length)];
                // Phạt từ 10k đến 50k
                const lostMoney = Math.floor(Math.random() * (50000 - 10000 + 1)) + 10000;

                // Trừ tiền
                await connection.execute('UPDATE messenger_users SET credits = credits - ? WHERE psid = ?', [lostMoney, senderID]);

                try {
                    recordAction(senderID, 'work', 1);
                } catch (_) {}

                return api.sendMessage(
                    `⚠️ XUI XẺO!\nBạn ${reason}.\n💸 Bị trừ: -${lostMoney.toLocaleString()} credits.\n⚡ Thể lực: -15 (${energyUse.energy}/${energyUse.maxEnergy})\n😭 Số dư còn: ${(currentBalance - lostMoney).toLocaleString()}`,
                    threadID, messageID
                );

            } else {
                // --- TRƯỜNG HỢP THÀNH CÔNG (NHẬN TIỀN) ---
                const jobs = [
                    "đi bán vé số dạo", "làm phụ hồ", "chạy GrabBike", "đi bưng bê", 
                    "ngồi code dạo", "nhặt ve chai", "trông xe", "phát tờ rơi", 
                    "bán trà đá", "đi đòi nợ thuê", "làm shipper", "cọ toilet",
                    "hát rong", "bán kem trộn", "cài Win dạo", "thông cống"
                ];
                const jobName = jobs[Math.floor(Math.random() * jobs.length)];
                
                // Lương: 10k -> 100k
                let salary = Math.floor(Math.random() * (100000 - 10000 + 1)) + 10000;
                
                // Work glove bonus +50%
                if (hasWorkGlove) {
                    const bonusPercent = workGlove[0].effect_value / 100;
                    salary = Math.floor(salary * (1 + bonusPercent));
                }
                
                // VIP bonus +50%
                if (hasVIP) {
                    salary = Math.floor(salary * 1.5);
                }

                await connection.beginTransaction();
                try {
                    if (hasWorkGlove) {
                        await connection.execute(
                            'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "work_bonus"',
                            [senderID]
                        );
                        await connection.execute('DELETE FROM active_effects WHERE uses_left <= 0');
                    }

                    // Cộng tiền
                    await connection.execute('UPDATE messenger_users SET credits = credits + ? WHERE psid = ?', [salary, senderID]);

                    await connection.commit();
                } catch (txErr) {
                    await connection.rollback();
                    throw txErr;
                }

                try {
                    recordAction(senderID, 'work', 1);
                    recordAction(senderID, 'work_earn', salary);
                } catch (_) {}

                let msg = `🛠️ THÀNH CÔNG!\nBạn đã ${jobName} chăm chỉ.\n💰 Nhận lương: +${salary.toLocaleString()} credits\n`;
                if (hasWorkGlove) msg += `🧤 Găng tay: +${workGlove[0].effect_value}%!\n`;
                if (hasVIP) msg += `👑 VIP: +50%!\n`;
                msg += `⚡ Thể lực: -15 (${energyUse.energy}/${energyUse.maxEnergy})\n`;
                msg += `💳 Số dư mới: ${(currentBalance + salary).toLocaleString()}`;
                
                return api.sendMessage(msg, threadID, messageID);
            }

        } catch (e) {
            console.error(e);
            return api.sendMessage("❌ Lỗi Database.", threadID, messageID);
        } finally {
            if (connection) await connection.end();
        }
    }
};
