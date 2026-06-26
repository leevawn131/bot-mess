const { execute, getConnection } = require("../../utils/database");
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { checkCooldown } = require('../../utils/cooldown');
const { consumeEnergy } = require('../../utils/energySystem');

const PRICE = 1000000; // 1 triệu credits
const VIDEO_DIR = path.resolve(__dirname, '../../../cache/vidgai');

function getDBConfig() {
    try {
        const configPath = path.resolve(__dirname, '../../../config.json');
        if (!fs.existsSync(configPath)) return null;
        const configFile = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const db = configFile.database;
        return {
            host: db.host,
            port: db.port,
            user: db.user,
            password: db.password,
            database: db.name
        };
    } catch (e) {
        return null;
    }
}

module.exports = {
    name: "vidgai",
    description: "Mua video gái TikTok (1,000,000 credits)",
    usage: "\n!vidgai → Mua và nhận video ngẫu nhiên\n━━━━━━━━━━━━━\n💰 Giá: 1,000,000 xu/lần\n⚡ Tốn năng lượng mỗi lần dùng\n🎬 Gửi video TikTok ngẫu nhiên",

    execute: async ({ api, event, config }) => {
        const { threadID, senderID, messageID } = event;

        // Cooldown 20s
        const cooldown = checkCooldown({ command: "vidgai", key: senderID, durationMs: 20000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lệnh này!`, threadID, messageID);
        }

        let dbInfo = config?.database;
        let dbConfig = null;
        if (dbInfo) {
            dbConfig = {
                host: dbInfo.host,
                port: dbInfo.port,
                user: dbInfo.user,
                password: dbInfo.password,
                database: dbInfo.name
            };
        } else {
            dbConfig = getDBConfig();
        }

        if (!dbConfig) {
            api.sendMessage("❌ Lỗi cấu hình Database!", threadID);
            return;
        }

        let connection;
        try {
            connection = await getConnection();

            // Lấy thông tin người dùng
            const [userRows] = await connection.execute(
                'SELECT credits, name FROM messenger_users WHERE psid = ?',
                [senderID]
            );

            const prefix = config?.prefix || "!";
            if (userRows.length === 0) {
                api.sendMessage(`❌ Bạn chưa có tài khoản (${prefix}tien).`, threadID);
                return;
            }

            const userName = userRows[0].name;
            const userBalance = parseInt(userRows[0].credits) || 0;

            // Kiểm tra đủ tiền
            if (userBalance < PRICE) {
                const shortfall = PRICE - userBalance;
                api.sendMessage(
                    `💸 Không đủ tiền!\n💰 Bạn có: ${userBalance.toLocaleString()}\n💵 Cần: ${PRICE.toLocaleString()}\n⚠️ Thiếu: ${shortfall.toLocaleString()}`,
                    threadID
                );
                return;
            }

            const energyUse = await consumeEnergy(connection, senderID, 20);
            if (!energyUse.ok) {
                if (energyUse.reason === 'not_enough') {
                    return api.sendMessage(energyUse.message, threadID, messageID);
                }
                return api.sendMessage("❌ Không thể kiểm tra thể lực lúc này.", threadID, messageID);
            }

            // Trừ tiền user
            await connection.execute(
                'UPDATE messenger_users SET credits = credits - ? WHERE psid = ?',
                [PRICE, senderID]
            );

            // Cộng tiền vào BOSS
            const BOSS_ID = "100037351338722";
            const [bossCheck] = await connection.execute(
                'SELECT credits FROM messenger_users WHERE psid = ?',
                [BOSS_ID]
            );

            if (bossCheck.length === 0) {
                await connection.execute(
                    'INSERT INTO messenger_users (psid, name, credits) VALUES (?, ?, ?)',
                    [BOSS_ID, 'BOSS NHÀ CÁI', PRICE]
                );
            } else {
                await connection.execute(
                    'UPDATE messenger_users SET credits = credits + ? WHERE psid = ?',
                    [PRICE, BOSS_ID]
                );
            }

            // Chọn video ngẫu nhiên từ folder
            let videoFiles = [];
            try {
                videoFiles = fs.readdirSync(VIDEO_DIR).filter(f => 
                    /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(f)
                );
            } catch (err) {
                console.error("Lỗi đọc folder video:", err);
            }

            if (videoFiles.length === 0) {
                api.sendMessage("❌ Không có video nào trong kho. Vui lòng thử lại sau!", threadID);
                connection.release();
                return;
            }

            // Random nhiều vòng để giảm cảm giác lặp
            const rerollTimes = crypto.randomInt(3, 11); // 3 -> 10 lần random
            let randomFileName = videoFiles[crypto.randomInt(0, videoFiles.length)];
            for (let i = 1; i < rerollTimes; i++) {
                randomFileName = videoFiles[crypto.randomInt(0, videoFiles.length)];
            }

            const filePath = path.join(VIDEO_DIR, randomFileName);

            if (connection) { connection.release(); connection = null; }

            // Gửi video
            try {
                const attachment = fs.createReadStream(filePath);
                const videoMsg = await api.sendMessage({ attachment }, threadID);
                
                const billMsg = await api.sendMessage(
                    `✅ Đã mua thành công!\n👤 ${userName}\n💸 Trừ: ${PRICE.toLocaleString()} credits\n⚡ Thể lực: -20 (${energyUse.energy}/${energyUse.maxEnergy})`,
                    threadID
                );

                // Xóa video sau 60 giây
                setTimeout(() => {
                    try {
                        api.unsendMessage(videoMsg.messageID);
                    } catch (e) {
                        console.error("Lỗi xóa video:", e);
                    }
                }, 60000);
            } catch (err) {
                console.error("Lỗi gửi video:", err);
                
                // Hoàn tiền nếu gửi video lỗi
                let refundConnection;
                try {
                    refundConnection = await getConnection();
                    await refundConnection.execute(
                        'UPDATE messenger_users SET credits = credits + ? WHERE psid = ?',
                        [PRICE, senderID]
                    );
                    api.sendMessage("❌ Lỗi gửi video. Tiền đã hoàn lại!", threadID);
                } catch (e) {
                    api.sendMessage("❌ Lỗi xử lý. Vui lòng liên hệ admin!", threadID);
                } finally {
                    if (refundConnection) refundConnection.release();
                }
            }

        } catch (error) {
            console.error("Lỗi vidgai:", error);
            api.sendMessage("❌ Lỗi xử lý lệnh. Vui lòng thử lại!", threadID);
            if (connection) connection.release();
        }
    }
};