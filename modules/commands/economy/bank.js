const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const { checkCooldown } = require('../../utils/cooldown');

// ID CỦA BOSS (Trả tiền lãi cho người gửi tiết kiệm)
const BOSS_ID = "100037351338722";

// Hàm lấy ngày từ Date object (dùng giờ hệ thống đã là UTC+7)
function getDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
module.exports = {
    name: "bank",
    description: "Quản lý tiền gửi ngân hàng (lãi 5%/ngày)",
    usage: "!bank gui [số_tiền] | !bank rut [số_tiền] | !bank check\n⚠️ Chỉ gửi 1 lần/ngày, rút phải chờ sang ngày mới + check lãi",
    
    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "bank", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        // Đọc config
        const configPath = path.resolve(__dirname, '../../../config.json');
        let dbConfig = {};
        try {
            const configFile = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const db = configFile.database;
            dbConfig = { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name };
        } catch (err) {
            return api.sendMessage("❌ Lỗi config.json", threadID);
        }

        const command = args[0]?.toLowerCase();
        const amountStr = args[1];

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);

            // Lấy thông tin user
            const [userRows] = await connection.execute('SELECT credits, name FROM messenger_users WHERE psid = ?', [senderID]);
            if (userRows.length === 0) {
                return api.sendMessage("❌ Bạn chưa có tài khoản. Gõ !tien để tạo.", threadID, messageID);
            }

            const userCredits = parseInt(userRows[0].credits);
            const userName = userRows[0].name;

            // === GỬI TIỀN VÀO BANK ===
            if (["gui", "deposit", "save"].includes(command)) {
                let amount = 0;
                if (amountStr === "all") {
                    amount = userCredits;
                } else {
                    amount = parseInt(amountStr);
                }

                if (isNaN(amount) || amount <= 0) {
                    return api.sendMessage("⚠️ Số tiền không hợp lệ.\nVí dụ: !bank gui 50000", threadID, messageID);
                }

                if (userCredits < amount) {
                    return api.sendMessage(`💸 Không đủ tiền! Có: ${userCredits.toLocaleString()}`, threadID, messageID);
                }

                // Check xem đã gửi trong ngày hôm nay chưa
                const [bankRows] = await connection.execute('SELECT * FROM bank_accounts WHERE psid = ?', [senderID]);
                if (bankRows.length > 0) {
                    const lastDeposit = new Date(bankRows[0].last_deposit);
                    const now = new Date();
                    
                    // Kiểm tra xem đã sang ngày tiếp theo chưa (dựa trên ngày lịch)
                    const lastDepositDay = getDateString(lastDeposit);
                    const nowDay = getDateString(now);
                    
                    if (lastDepositDay === nowDay) {
                        const tomorrowStart = new Date(now);
                        tomorrowStart.setDate(tomorrowStart.getDate() + 1);
                        tomorrowStart.setHours(0, 0, 0, 0);
                        
                        const hoursRemaining = Math.ceil((tomorrowStart - now) / (1000 * 60 * 60));
                        
                        return api.sendMessage(
                            `⏳ BạN ĐÃ GỮI TIỀN HÔM NAY!\n━━━━━━━━━━━━━━━━━━\n⏰ Có thể gửi lại: ngày mai từ 00:00 (UTC+7)\n⏳ Còn lại: ~${hoursRemaining}h`,
                            threadID,
                            messageID
                        );
                    }
                }

                await connection.beginTransaction();
                try {
                    // Trừ tiền ví
                    await connection.execute('UPDATE messenger_users SET credits = credits - ? WHERE psid = ?', [amount, senderID]);

                    // Lấy hoặc tạo tài khoản bank
                    const now = new Date();
                    if (bankRows.length === 0) {
                        // Tạo tài khoản mới
                        await connection.execute(
                            'INSERT INTO bank_accounts (psid, balance, last_bank_check, last_deposit) VALUES (?, ?, ?, ?)',
                            [senderID, amount, now, now]
                        );
                    } else {
                        // Cộng vào tài khoản có sẵn
                        await connection.execute(
                            'UPDATE bank_accounts SET balance = balance + ?, last_deposit = ? WHERE psid = ?',
                            [amount, now, senderID]
                        );
                    }

                    // Cộng vào bank pool
                    await connection.execute('UPDATE bank_pool SET total_balance = total_balance + ? WHERE id = 1', [amount]);

                    await connection.commit();

                    return api.sendMessage(
                        `✅ GỬI TIỀN THÀNH CÔNG!\n👤 ${userName}\n💰 Số tiền: ${amount.toLocaleString()}\n🏦 Lãi suất: 5%/ngày (lãi kép)\n━━━━━━━━━━━━━━━━━━\n💡 Dùng !bank check để cập nhật lãi\n⏳ Có thể rút sau 24h + check lãi`,
                        threadID,
                        messageID
                    );
                } catch (err) {
                    await connection.rollback();
                    throw err;
                }
            }

            // === RÚT TIỀN TỪ BANK ===
            else if (["rut", "withdraw", "wd"].includes(command)) {
                const [bankRows] = await connection.execute('SELECT * FROM bank_accounts WHERE psid = ?', [senderID]);
                
                if (bankRows.length === 0 || bankRows[0].balance <= 0) {
                    return api.sendMessage("❌ Bạn chưa có tiền trong ngân hàng.\n💡 Dùng !bank gui để gửi tiền.", threadID, messageID);
                }

                const now = new Date();
                const lastDeposit = new Date(bankRows[0].last_deposit);
                const lastCheck = new Date(bankRows[0].last_bank_check);

                // Kiểm tra điều kiện 1: Đã sang ngày tiếp theo kể từ lần gửi cuối chưa
                const lastDepositDay = getDateString(lastDeposit);
                const nowDay = getDateString(now);
                
                if (lastDepositDay === nowDay) {
                    const tomorrowStart = new Date(now);
                    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
                    tomorrowStart.setHours(0, 0, 0, 0);
                    
                    const hoursRemaining = Math.ceil((tomorrowStart - now) / (1000 * 60 * 60));
                    
                    return api.sendMessage(
                        `⏳ CHƯA ĐỦ NGÀY!\n━━━━━━━━━━━━━━━━━━\n⏰ Cần chờ đến ngày mai từ 00:00 (UTC+7)\n⏱️ Còn lại: ~${hoursRemaining}h`,
                        threadID,
                        messageID
                    );
                }

                // Kiểm tra điều kiện 2: Đã dùng lệnh check sau khi gửi chưa
                if (lastCheck < lastDeposit) {
                    return api.sendMessage(
                        `⚠️ VUI LÒNG CHECK TRƯỚC KHI RÚT!\n━━━━━━━━━━━━━━━━━━\n💡 Gõ !bank check để cập nhật lãi\n➡️ Sau đó mới rút tiền được`,
                        threadID,
                        messageID
                    );
                }

                const bankBalance = parseInt(bankRows[0].balance);
                let amount = 0;
                
                if (amountStr === "all") {
                    amount = bankBalance;
                } else {
                    amount = parseInt(amountStr);
                }

                if (isNaN(amount) || amount <= 0) {
                    return api.sendMessage("⚠️ Số tiền không hợp lệ.\nVí dụ: !bank rut 50000", threadID, messageID);
                }

                if (bankBalance < amount) {
                    return api.sendMessage(
                        `💸 Số dư không đủ!\n🏦 Số dư bank: ${bankBalance.toLocaleString()}`,
                        threadID,
                        messageID
                    );
                }

                await connection.beginTransaction();
                try {
                    // Cộng tiền vào ví
                    await connection.execute('UPDATE messenger_users SET credits = credits + ? WHERE psid = ?', [amount, senderID]);

                    // Trừ tiền từ bank
                    await connection.execute('UPDATE bank_accounts SET balance = balance - ? WHERE psid = ?', [amount, senderID]);

                    // Trừ từ bank pool
                    await connection.execute('UPDATE bank_pool SET total_balance = total_balance - ? WHERE id = 1', [amount]);

                    await connection.commit();

                    const remainingBank = bankBalance - amount;
                    return api.sendMessage(
                        `✅ RÚT TIỀN THÀNH CÔNG!\n👤 ${userName}\n💰 Số tiền: ${amount.toLocaleString()}\n🏦 Còn lại trong bank: ${remainingBank.toLocaleString()}`,
                        threadID,
                        messageID
                    );
                } catch (err) {
                    await connection.rollback();
                    throw err;
                }
            }

            // === KIỂM TRA SỐ DƯ + CẬP NHẬT LÃI ===
            else if (["check", "balance", "bal"].includes(command)) {
                const [bankRows] = await connection.execute('SELECT * FROM bank_accounts WHERE psid = ?', [senderID]);
                
                if (bankRows.length === 0) {
                    return api.sendMessage(
                        `🏦 TÀI KHOẢN NGÂN HÀNG\n━━━━━━━━━━━━━━━━━━\n👤 ${userName}\n💰 Số dư: 0\n━━━━━━━━━━━━━━━━━━\n💡 Dùng !bank gui để gửi tiền`,
                        threadID,
                        messageID
                    );
                }

                const lastCheck = new Date(bankRows[0].last_bank_check);
                const now = new Date();
                let balance = parseInt(bankRows[0].balance);

                // Tính số ngày từ lần check cuối (dựa trên ngày lịch)
                const lastCheckDay = getDateString(lastCheck);
                const nowDay = getDateString(now);
                
                // Nếu cùng ngày thì số ngày là 0, nếu khác ngày thì tính thẳng
                let daysPassed = 0;
                if (lastCheckDay !== nowDay) {
                    daysPassed = Math.max(0, Math.floor((now - lastCheck) / (1000 * 60 * 60 * 24)));
                }

                let interestEarned = 0;
                let newBalance = balance;

                if (daysPassed >= 1) {
                    // Tính lãi kép: balance × (1 + 0.05)^n
                    newBalance = Math.floor(balance * Math.pow(1.05, daysPassed));
                    interestEarned = newBalance - balance;

                    if (interestEarned > 0) {
                        await connection.beginTransaction();
                        try {
                            // Cập nhật số dư mới
                            await connection.execute(
                                'UPDATE bank_accounts SET balance = ?, last_bank_check = ? WHERE psid = ?',
                                [newBalance, now, senderID]
                            );

                            // Boss trả tiền lãi (thêm vào bank pool)
                            await connection.execute(
                                'UPDATE bank_pool SET total_balance = total_balance + ? WHERE id = 1',
                                [interestEarned]
                            );

                            // Trừ tiền boss
                            await connection.execute(
                                'UPDATE messenger_users SET credits = credits - ? WHERE psid = ?',
                                [interestEarned, BOSS_ID]
                            );

                            await connection.commit();

                            return api.sendMessage(
                                `🏦 CẬP NHẬT LÃI THÀNH CÔNG!\n━━━━━━━━━━━━━━━━━━\n👤 ${userName}\n💰 Số dư cũ: ${balance.toLocaleString()}\n📈 Lãi ${daysPassed} ngày (5%/ngày): +${interestEarned.toLocaleString()}\n💵 Số dư mới: ${newBalance.toLocaleString()}\n━━━━━━━━━━━━━━━━━━\n✅ Bây giờ có thể rút tiền!`,
                                threadID,
                                messageID
                            );
                        } catch (err) {
                            await connection.rollback();
                            throw err;
                        }
                    }
                } else {
                    // Chỉ cập nhật thời gian check (không có lãi)
                    await connection.execute(
                        'UPDATE bank_accounts SET last_bank_check = ? WHERE psid = ?',
                        [now, senderID]
                    );
                }

                // Tính thời gian đến ngày tiếp theo
                const tomorrowStart = new Date(now);
                tomorrowStart.setDate(tomorrowStart.getDate() + 1);
                tomorrowStart.setHours(0, 0, 0, 0);
                const hoursUntilNextDay = Math.ceil((tomorrowStart - now) / (1000 * 60 * 60));

                return api.sendMessage(
                    `🏦 TÀI KHOẢN NGÂN HÀNG\n━━━━━━━━━━━━━━━━━━\n👤 ${userName}\n💰 Số dư: ${newBalance.toLocaleString()}\n📊 Lãi suất: 5%/ngày\n⏰ Lãi kế tiếp: ~${hoursUntilNextDay}h\n━━━━━━━━━━━━━━━━━━\n💡 Dùng !bank rut để rút tiền`,
                    threadID,
                    messageID
                );
            }

            // HƯỚNG DẪN
            else {
                return api.sendMessage(
                    `🏦 NGÂN HÀNG - HƯỚNG DẪN\n━━━━━━━━━━━━━━━━━━\n📥 !bank gui [số_tiền] - Gửi tiền\n📤 !bank rut [số_tiền] - Rút tiền\n🔍 !bank check - Kiểm tra & cập nhật lãi\n━━━━━━━━━━━━━━━━━━\n💰 Lãi suất: 5%/ngày (lãi kép)\n⚠️ Quy tắc rút tiền:\n  • Phải chờ sang ngày tiếp theo (00:00 UTC+7)\n  • Phải dùng !bank check để cập nhật lãi\n  • Sau đó mới có thể rút\n📝 Chỉ được gửi 1 lần/ngày (tính theo ngày lịch)`,
                    threadID,
                    messageID
                );
            }

        } catch (e) {
            console.error("Lỗi Bank:", e);
            return api.sendMessage("❌ Lỗi hệ thống ngân hàng.", threadID, messageID);
        } finally {
            if (connection) await connection.end();
        }
    }
};
