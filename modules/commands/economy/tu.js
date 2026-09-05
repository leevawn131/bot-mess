const { execute, getConnection } = require('../../utils/database');
const path = require('path');
const fs = require('fs');
const { checkCooldown } = require('../../utils/cooldown');
const { ensureMentionsFromHistory } = require('../../utils/mentionResolver');


module.exports = {
    name: "tu",
    description: "Quản lý nhà tù",
    usage: "!tu check | !tu check all | !tu cuu @tag|reply",

    execute: async ({ api, event, args, config }) => {
        await ensureMentionsFromHistory(api, event);
        const { threadID, messageID, senderID, mentions, messageReply } = event;
        const prefix = config?.prefix || "!";

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "tu", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        const command = args[0]?.toLowerCase();
        let connection;

        try {
            connection = await getConnection();

            // Check all tù nhân
            if (command === "check" && args[1] === "all") {
                const [rows] = await connection.execute(
                    "SELECT uj.psid, uj.jail_until, uj.reason, mu.name FROM user_jail uj LEFT JOIN messenger_users mu ON uj.psid = mu.psid AND mu.thread_id = uj.thread_id WHERE uj.thread_id = ? AND uj.jail_until > datetime('now', 'localtime')",
                    [String(threadID)]
                );

                if (rows.length === 0) {
                    return api.sendMessage("🏛️ Không có tù nhân nào.", threadID, messageID);
                }

                let msg = "🏛️ DANH SÁCH TÙ NHÂN\n━━━━━━━━━━━━━\n";
                rows.forEach((row, index) => {
                    const remainingMs = new Date(row.jail_until) - new Date();

                    if (remainingMs <= 0) {
                        msg += `${index + 1}. ${row.name || row.psid}
                    ⏰ Còn: 00:00:00 
                    ⚠️ Lý do: ${row.reason}\n`;
                        return;
                    }

                    const totalSeconds = Math.floor(remainingMs / 1000);

                    const hours = Math.floor(totalSeconds / 3600);
                    const minutes = Math.floor((totalSeconds % 3600) / 60);
                    const seconds = totalSeconds % 60;

                    const timeStr = `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;

                    msg += `${index + 1}. ${row.name || row.psid}
                    ⏰ Còn: ${timeStr}
                    ⚠️ Lý do: ${row.reason}\n`;
                });

                return api.sendMessage(msg, threadID, messageID);
            }

            // Check tù của mình
            if (command === "check") {
                const [rows] = await connection.execute(
                    "SELECT * FROM user_jail WHERE thread_id = ? AND psid = ? AND jail_until > datetime('now', 'localtime')",
                    [String(threadID), senderID]
                );

                if (rows.length === 0) {
                    return api.sendMessage("✅ Bạn không bị tù.", threadID, messageID);
                }

                const jail = rows[0];
                const remainingMs = new Date(jail.jail_until) - new Date();

                if (remainingMs <= 0) {
                    return api.sendMessage("✅ Bạn không bị tù.", threadID, messageID);
                }

                const totalSeconds = Math.floor(remainingMs / 1000);
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;

                const timeStr =
                    `${hours.toString().padStart(2, '0')}:` +
                    `${minutes.toString().padStart(2, '0')}:` +
                    `${seconds.toString().padStart(2, '0')}`;

               return api.sendMessage(
                    `🔒 BẠN ĐANG TRONG TÙ!
            ━━━━━━━━━━━━━
            ⏰ Còn lại: ${timeStr}
            ⚠️ Lý do: ${jail.reason}
            ━━━━━━━━━━━━━
             💡 Dùng ${prefix}tu cuu để xin tại ngoại`,
                    threadID,
                    messageID
                );
            }


            // Cứu tù
            if (command === "cuu") {
                let targetID = null;
                if (Object.keys(mentions).length > 0) {
                    targetID = Object.keys(mentions)[0];
                } else if (messageReply) {
                    targetID = messageReply.senderID;
                }

                if (!targetID) {
                    return api.sendMessage("⚠️ Tag hoặc reply người cần cứu.", threadID, messageID);
                }

                const [rows] = await connection.execute(
                    "SELECT * FROM user_jail WHERE thread_id = ? AND psid = ? AND jail_until > datetime('now', 'localtime')",
                    [String(threadID), targetID]
                );

                if (rows.length === 0) {
                    return api.sendMessage("✅ Người này không bị tù.", threadID, messageID);
                }

                const jail = rows[0];
                const reason = jail.reason;

                const [targetRows] = await connection.execute(
                    'SELECT name FROM messenger_users WHERE thread_id = ? AND psid = ?',
                    [String(threadID), targetID]
                );
                const targetName = targetRows[0]?.name || "Thành viên";

                // Phí cứu tù theo mức độ
                let fee = 200000;
                if (reason === "Cướp ngân hàng") fee = 500000;
                else if (reason === "Cướp fail") fee = 300000;
                else if (reason === "Nợ quá hạn") fee = 400000;

                // Check tiền
                const [userRows] = await connection.execute('SELECT credits FROM messenger_users WHERE thread_id = ? AND psid = ?', [String(threadID), senderID]);
                const credits = parseInt(userRows[0].credits);

                if (credits < fee) {
                    return api.sendMessage(
                        `💸 KHÔNG ĐỦ TIỀN CỨU TÙ!\n━━━━━━━━━━━━━\n💰 Phí: ${fee.toLocaleString('vi-VN')}\n💵 Bạn có: ${credits.toLocaleString('vi-VN')}\n💔 Thiếu: ${(fee - credits).toLocaleString('vi-VN')}`,
                        threadID,
                        messageID
                    );
                }

                await connection.beginTransaction();
                try {
                    // Trừ tiền user
                    await connection.execute('UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?', [fee, String(threadID), senderID]);

                    // Thả tù cho người được cứu
                    await connection.execute('DELETE FROM user_jail WHERE thread_id = ? AND psid = ?', [String(threadID), targetID]);

                    await connection.commit();

                    return api.sendMessage(
                        `✅ CỨU TÙ THÀNH CÔNG!\n━━━━━━━━━━━━━\n👤 Người được cứu: ${targetName}\n💰 Phí: ${fee.toLocaleString('vi-VN')}\n🔓 Đã được thả\n━━━━━━━━━━━━━\n⚠️ Đừng phạm lỗi nữa nhé!`,
                        threadID,
                        messageID
                    );
                } catch (err) {
                    await connection.rollback();
                    throw err;
                }
            }

            return api.sendMessage(
                `🏛️ NHÀ TÙ - HƯỚNG DẪN\n━━━━━━━━━━━━━\n🔍 ${prefix}tu check - Kiểm tra thời gian tù\n👥 ${prefix}tu check all - Xem danh sách tù nhân\n🔓 ${prefix}tu cuu @tag|reply - Bảo lãnh ra tù\n━━━━━━━━━━━━━\n💰 Phí cứu tù: 200k - 500k`,
                threadID,
                messageID
            );

        } catch (e) {
            console.error("Lỗi Tù:", e);
            return api.sendMessage("❌ Lỗi hệ thống nhà tù.", threadID, messageID);
        } finally {
            if (connection) connection.release();
        }
    }
};
