const { execute } = require('../../utils/database');
const { recordAction } = require('../../utils/questSystem');
const prefix = process.env.BOT_PREFIX || '!';

global.diemdanhLock = global.diemdanhLock || new Set();

module.exports = {
    name: "diemdanh",
    description: "Điểm danh nhận quà hàng ngày",
    usage: `\n${prefix}diemdanh → Điểm danh nhận xu miễn phí mỗi ngày\n━━━━━━━━━━━━━\n🎁 Nhận xu ngẫu nhiên mỗi lần điểm danh\n👑 VIP nhận thưởng gấp đôi\n⏰ Reset lúc 00:00 hàng ngày`,
    execute: async ({ api, event, config }) => {
        const { threadID, messageID, senderID } = event;
        const stringThreadID = String(threadID);
        const stringSenderID = String(senderID);

        const lockKey = `${stringThreadID}_${stringSenderID}`;
        if (global.diemdanhLock.has(lockKey)) return;
        global.diemdanhLock.add(lockKey);

        try {
            // Lấy thông tin theo (thread_id, psid)
            let rows = await execute(
                'SELECT credits, name, last_checkin, vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?',
                [stringThreadID, stringSenderID]
            );

            if (rows.length === 0) {
                // Tự tạo tài khoản mới ở nhóm này
                const userName = (global.data && global.data.userName && global.data.userName.get(stringSenderID)) || "Người dùng";
                await execute(
                    'INSERT INTO messenger_users (thread_id, psid, name, credits) VALUES (?, ?, ?, 10000)',
                    [stringThreadID, stringSenderID, userName]
                );
                rows = await execute(
                    'SELECT credits, name, last_checkin, vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?',
                    [stringThreadID, stringSenderID]
                );
            }

            const user = rows[0];
            
            const now = new Date();
            const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
            const todayStr = vnTime.toISOString().split('T')[0];
            
            const hasVIP = user.vip_until && new Date(user.vip_until) > now; 

            let lastCheckinStr = "";
            if (user.last_checkin) {
                const lastDate = new Date(user.last_checkin);
                const lastVnTime = new Date(lastDate.getTime() + (7 * 60 * 60 * 1000));
                lastCheckinStr = lastVnTime.toISOString().split('T')[0];
            }

            if (lastCheckinStr === todayStr) {
                return api.sendMessage(`🛑 Hôm nay bạn đã nhận quà ở thế giới nhóm này rồi!\n👉 Hẹn bạn vào ngày mai.`, threadID, messageID);
            }

            let reward = Math.floor(Math.random() * (50000 - 10000 + 1)) + 10000;
            
            if (hasVIP) {
                reward = reward * 2;
            }
            
            await execute(
                'UPDATE messenger_users SET credits = credits + ?, last_checkin = ? WHERE thread_id = ? AND psid = ?',
                [reward, todayStr, stringThreadID, stringSenderID]
            );

            try {
                recordAction(stringSenderID, 'checkin', 1);
            } catch (_) {}

            let msg = `📅 ĐIỂM DANH THÀNH CÔNG (THẾ GIỚI NÀY)!\n━━━━━━━━━━━━━\n` +
                `🎁 Quà tặng: +${reward.toLocaleString('vi-VN')} xu\n`;
            
            if (hasVIP) msg += `👑 VIP Bonus: x2 thưởng!\n`;
            
            msg += `💰 Số dư mới: ${(parseInt(user.credits) + reward).toLocaleString('vi-VN')} xu\n` +
                `✅ Chúc ${user.name} một ngày tốt lành!`;

            return api.sendMessage(msg, threadID, messageID);

        } catch (e) {
            console.error(e);
            return api.sendMessage("❌ Lỗi hệ thống, vui lòng thử lại.", threadID);
        } finally {
            global.diemdanhLock.delete(lockKey);
        }
    }
};