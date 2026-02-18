const mysql = require('mysql2/promise');

// Bộ nhớ đệm để chống spam race condition (ngăn gửi nhiều lệnh trong 1 giây)
global.diemdanhLock = global.diemdanhLock || new Set();

module.exports = {
    name: "diemdanh",
    description: "Điểm danh nhận quà hàng ngày (Chống spam & Fix múi giờ)",
    execute: async ({ api, event, config }) => {
        const { threadID, messageID, senderID } = event;

        // 1. CHỐT CHẶN RACE CONDITION
        if (global.diemdanhLock.has(senderID)) return;
        global.diemdanhLock.add(senderID);

        const db = config.database;
        const dbConfig = { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name };

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);

            // 2. LẤY THÔNG TIN & FIX MÚI GIỜ VIỆT NAM
            const [rows] = await connection.execute('SELECT credits, name, last_checkin, vip_until FROM messenger_users WHERE psid = ?', [senderID]);

            if (rows.length === 0) {
                global.diemdanhLock.delete(senderID);
                return api.sendMessage("❌ Bạn chưa có tài khoản. Gõ !tien để đăng ký.", threadID, messageID);
            }

            const user = rows[0];
            
            // Tính toán ngày hôm nay theo múi giờ VN (UTC+7)
            const now = new Date();
            const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
            const todayStr = vnTime.toISOString().split('T')[0];
            
            // Check VIP status
            const hasVIP = user.vip_until && new Date(user.vip_until) > now; 

            // Kiểm tra ngày điểm danh từ DB
            let lastCheckinStr = "";
            if (user.last_checkin) {
                // Ép kiểu về ngày VN để so sánh chính xác
                const lastDate = new Date(user.last_checkin);
                const lastVnTime = new Date(lastDate.getTime() + (7 * 60 * 60 * 1000));
                lastCheckinStr = lastVnTime.toISOString().split('T')[0];
            }

            if (lastCheckinStr === todayStr) {
                global.diemdanhLock.delete(senderID);
                return api.sendMessage(`🛑 Hôm nay bạn đã nhận quà rồi!\n👉 Hẹn bạn vào ngày mai.`, threadID, messageID);
            }

            // 3. THƯỞNG (Random 10k - 50k)
            let reward = Math.floor(Math.random() * (50000 - 10000 + 1)) + 10000;
            
            // VIP x2 thuong
            if (hasVIP) {
                reward = reward * 2;
            }
            
            // Cập nhật ngay lập tức
            await connection.execute(
                'UPDATE messenger_users SET credits = credits + ?, last_checkin = ? WHERE psid = ?', 
                [reward, todayStr, senderID]
            );

            let msg = `📅 ĐIỂM DANH THÀNH CÔNG!\n━━━━━━━━━━━━━━━━━━\n` +
                `🎁 Quà tặng: +${reward.toLocaleString()} xu\n`;
            
            if (hasVIP) msg += `👑 VIP Bonus: x2 thuong!\n`;
            
            msg += `💰 Số dư mới: ${(parseInt(user.credits) + reward).toLocaleString()} xu\n` +
                `✅ Chúc ${user.name} một ngày tốt lành!`;

            api.sendMessage(msg, threadID, messageID);

        } catch (e) {
            console.error(e);
            api.sendMessage("❌ Lỗi hệ thống, vui lòng thử lại.", threadID);
        } finally {
            // Mở khóa cho người dùng sau khi xử lý xong
            global.diemdanhLock.delete(senderID);
            if (connection) await connection.end();
        }
    }
};