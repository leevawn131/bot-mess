const mysql = require('mysql2/promise');
const { checkCooldown } = require('../../utils/cooldown');

// ID CỦA BOSS (Hưởng lợi từ tiền phạt)
const BOSS_ID = "100037351338722";

module.exports = {
    name: "cuop",
    description: "Cướp tiền người khác hoặc ngân hàng",
    usage: "!cuop @tag | reply | !cuop nganhang",
    
    execute: async ({ api, event, config, args }) => {
        const { threadID, senderID, mentions, messageID, messageReply, body } = event;

        const rawArgs = Array.isArray(args) && args.length
            ? args
            : (body ? body.trim().split(/\s+/).slice(1) : []);
        const subCommand = rawArgs[0]?.toLowerCase();
        const isBankRob = subCommand === "nganhang";

        // 1. XÁC ĐỊNH MỤC TIÊU (Hỗ trợ cả Tag và Reply)
        let targetID = null;
        if (!isBankRob) {
            if (Object.keys(mentions).length > 0) {
                targetID = Object.keys(mentions)[0];
            } else if (messageReply) {
                targetID = messageReply.senderID;
            }

            if (!targetID) {
                return api.sendMessage("❌ Bạn muốn cướp ai? Hãy Tag hoặc Reply tin nhắn người đó!", threadID, messageID);
            }

            if (targetID === senderID) return api.sendMessage("❌ Bị điên à mà tự cướp chính mình?", threadID, messageID);
        }

        // 2. CHECK COOLDOWN (180s = 3 phút)
        const cooldown = checkCooldown({ command: "cuop", key: senderID, durationMs: 180000 });
        if (!cooldown.allowed) {
            const minutes = Math.ceil(cooldown.timeLeft / 60);
            return api.sendMessage(`👮 Đang bị truy nã! Hãy trốn kỹ ${cooldown.timeLeft} giây nữa (khoảng ${minutes} phút) mới được đi cướp tiếp.`, threadID, messageID);
        }

        // Config DB
        const db = config.database;
        const dbConfig = { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name };

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);

            // Check tù
            const [jailRows] = await connection.execute(
                'SELECT jail_until, reason FROM user_jail WHERE psid = ? AND jail_until > NOW()',
                [senderID]
            );

            if (jailRows.length > 0) {
                const remainingMs = new Date(jailRows[0].jail_until) - new Date();
                const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
                return api.sendMessage(
                    `🔒 BẠN ĐANG TRONG TÙ!\n━━━━━━━━━━━━━━━━━━\n⏰ Còn lại: ${remainingHours} giờ\n⚠️ Lý do: ${jailRows[0].reason}\n❌ Không thể cướp`,
                    threadID,
                    messageID
                );
            }

            // --- CƯỚP NGÂN HÀNG ---
            if (isBankRob) {
                const [senderRows] = await connection.execute(
                    'SELECT credits, name FROM messenger_users WHERE psid = ?',
                    [senderID]
                );
                if (senderRows.length === 0) {
                    return api.sendMessage("❌ Bạn chưa có tài khoản.", threadID, messageID);
                }

                const senderName = senderRows[0].name || "Thành viên";
                const senderCredits = parseInt(senderRows[0].credits) || 0;

                // Kiểm tra credits tối thiểu để cướp ngân hàng
                if (senderCredits < 10000) {
                    return api.sendMessage("❌ Bạn cần ít nhất 10,000 credits để cướp ngân hàng!", threadID, messageID);
                }

                const [poolRows] = await connection.execute(
                    'SELECT total_balance FROM bank_pool WHERE id = 1'
                );
                const poolBalance = parseInt(poolRows[0]?.total_balance) || 0;

                if (poolBalance <= 0) {
                    return api.sendMessage("🏦 Ngân hàng đang trống. Không thể cướp!", threadID, messageID);
                }

                let winRate = 0.19;
                if (senderID === BOSS_ID) winRate = 1.0;

                const isSuccess = Math.random() < winRate;
                const now = new Date();

                if (isSuccess) {
                    const percent = Math.floor(Math.random() * 11) + 5; // 5-15%
                    const stealAmount = Math.min(Math.floor((poolBalance * percent) / 100), poolBalance);

                    // Lấy danh sách tất cả users có tài khoản ngân hàng
                    const [bankUsers] = await connection.execute(
                        'SELECT psid, balance FROM bank_accounts WHERE balance > 0'
                    );

                    await connection.beginTransaction();
                    try {
                        let totalStolen = 0; // Tính tổng tiền THỰC TẾ bị cướp
                        
                        // Chia đều số tiền bị cướp cho tất cả users có tiền trong ngân hàng
                        if (bankUsers.length > 0) {
                            const sharePerUser = Math.floor(stealAmount / bankUsers.length);
                            
                            for (const user of bankUsers) {
                                const deductAmount = Math.min(sharePerUser, user.balance);
                                await connection.execute(
                                    'UPDATE bank_accounts SET balance = balance - ? WHERE psid = ?',
                                    [deductAmount, user.psid]
                                );
                                totalStolen += deductAmount; // Cộng dồn số tiền thực tế bị trừ
                            }
                        }

                        // Cập nhật pool với số tiền THỰC TẾ bị cướp
                        await connection.execute(
                            'UPDATE bank_pool SET total_balance = total_balance - ? WHERE id = 1',
                            [totalStolen]
                        );

                        // Thêm tiền cho kẻ cướp với số tiền THỰC TẾ
                        await connection.execute(
                            'UPDATE messenger_users SET credits = credits + ? WHERE psid = ?',
                            [totalStolen, senderID]
                        );

                        await connection.commit();
                    } catch (err) {
                        await connection.rollback();
                        throw err;
                    }

                    api.sendMessage(
                        `🏦 **CƯỚP NGÂN HÀNG THÀNH CÔNG!**\n👤 ${senderName}\n💰 Lấy được: ${totalStolen.toLocaleString()}\n🔥 Thoát khỏi truy nã... tạm thời!`,
                        threadID,
                        messageID
                    );
                } else {
                    const fine = 100000; // 100k fixed penalty
                    const jailUntil = new Date(now.getTime() + 1 * 60 * 60 * 1000);

                    await connection.beginTransaction();
                    try {
                        await connection.execute(
                            'UPDATE messenger_users SET credits = credits - ? WHERE psid = ?',
                            [fine, senderID]
                        );
                        await connection.execute(
                            'UPDATE messenger_users SET credits = credits + ? WHERE psid = ?',
                            [fine, BOSS_ID]
                        );
                        
                        await connection.execute(
                            'INSERT INTO user_jail (psid, jail_until, reason) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE jail_until = ?, reason = ?',
                            [senderID, jailUntil, 'Cướp ngân hàng', jailUntil, 'Cướp ngân hàng']
                        );
                        await connection.commit();
                    } catch (err) {
                        await connection.rollback();
                        throw err;
                    }

                    api.sendMessage(
                        `🚔 **CƯỚP NGÂN HÀNG THẤT BẠI!**\n👮 Bạn bị bắt và vào tù 1h.\n💸 Tiền phạt: 500,000 credits`,
                        threadID,
                        messageID
                    );
                }

                return;
            }

            // 3. Lấy thông tin tài chính + Tên của 2 người + VIP status
            const [rows] = await connection.execute(
                'SELECT psid, credits, name, vip_until FROM messenger_users WHERE psid IN (?, ?)', 
                [senderID, targetID]
            );

            const senderData = rows.find(r => r.psid == senderID);
            const targetData = rows.find(r => r.psid == targetID);
            
            // Check VIP cua nguoi bi cuop
            const now = new Date();
            const targetHasVIP = targetData?.vip_until && new Date(targetData.vip_until) > now;
            
            // Check shield protection cho nguoi bi cuop
            const [shieldCheck] = await connection.execute(
                'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "protect_rob" AND uses_left > 0',
                [targetID]
            );
            const hasShield = shieldCheck.length > 0;

            // Xử lý tên nạn nhân
            let targetName = targetData ? targetData.name : "Nạn nhân";
            if (!targetData) {
                try {
                    const userInfo = await api.getUserInfo(targetID);
                    targetName = userInfo[targetID].name;
                } catch (e) {}
            }

            // Kiểm tra điều kiện cướp
            if (!senderData || senderData.credits < 1000) {
                return api.sendMessage("❌ Bạn cần ít nhất 1,000 credits để làm vốn mua súng đi cướp!", threadID, messageID);
            }
            if (!targetData || targetData.credits < 1000) {
                return api.sendMessage(`❌ ${targetName} quá nghèo (dưới 1k), cướp không bõ công!`, threadID, messageID);
            }

            // 4. TÍNH TOÁN TỈ LỆ
            let winRate = 0.3; // Mặc định 30% thắng
            let fine = 0;      // Tiền phạt nếu thua
            let stealAmount = 0;

            // --- ĐẶC QUYỀN BOSS ---
            // Nếu Boss đi cướp: Tỉ lệ thắng 100%
            if (senderID === BOSS_ID) winRate = 1.0;
            
            // Nếu ai đó cướp Boss: Tỉ lệ thắng 0% (Luôn thua)
            if (targetID === BOSS_ID) winRate = 0;
            
            // --- SHIELD EFFECT ---
            // Giam ti le thanh cong khi cuop nguoi co shield
            if (hasShield) {
                const shieldPower = shieldCheck[0].effect_value / 100; // VD: 50 -> 0.5
                winRate = winRate * (1 - shieldPower);
            }

            // --- QUAY SỐ ---
            const isSuccess = Math.random() < winRate;

            if (isSuccess) {
                // CƯỚP THÀNH CÔNG (Lấy 10% - 20% tiền nạn nhân)
                const percent = Math.floor(Math.random() * 11) + 10; // 10-20%
                stealAmount = Math.floor((targetData.credits * percent) / 100);
                
                // VIP giam 5% tien bi cuop
                if (targetHasVIP) {
                    stealAmount = Math.floor(stealAmount * 0.95);
                }

                await connection.execute('UPDATE messenger_users SET credits = credits + ? WHERE psid = ?', [stealAmount, senderID]);
                await connection.execute('UPDATE messenger_users SET credits = credits - ? WHERE psid = ?', [stealAmount, targetID]);
                
                // Tru luot dung shield neu co
                if (hasShield) {
                    await connection.execute(
                        'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "protect_rob"',
                        [targetID]
                    );
                    await connection.execute('DELETE FROM active_effects WHERE uses_left <= 0');
                }

                let msg = `🔫 **CƯỚP THÀNH CÔNG!**\nBạn đã trấn lột ${stealAmount.toLocaleString()} credits từ ${targetName}.\n(Nạn nhân khóc thét 😭)`;
                if (hasShield) msg += `\n🛡️ Khien bao ve da giam sat thuong!`;
                if (targetHasVIP) msg += `\n👑 VIP da giam 5% tien mat!`;
                
                api.sendMessage(msg, threadID, messageID);
            } else {
                // CƯỚP THẤT BẠI (Bị phạt tiền -> Chuyển về BOSS)
                fine = 2000; // Phạt mặc định
                if (targetID === BOSS_ID) fine = 10000; // Cướp Boss phạt nặng hơn

                // Trừ tiền thằng đi cướp
                await connection.execute('UPDATE messenger_users SET credits = credits - ? WHERE psid = ?', [fine, senderID]);
                
                // Cộng tiền phạt vào ví BOSS (Nếu Boss không phải là người đi cướp)
                if (senderID !== BOSS_ID) {
                    await connection.execute('UPDATE messenger_users SET credits = credits + ? WHERE psid = ?', [fine, BOSS_ID]);
                }

                // Vào tù 3 phút
                const jailUntil = new Date(Date.now() + 3 * 60 * 1000);
                await connection.execute(
                    'INSERT INTO user_jail (psid, jail_until, reason) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE jail_until = ?, reason = ?',
                    [senderID, jailUntil, 'Cướp fail', jailUntil, 'Cướp fail']
                );

                api.sendMessage(
                    `👮 **BỊ BẮT RỒI CON ƠI!**\nCướp ${targetName} bất thành, bạn bị Công An phạt ${fine.toLocaleString()} credits.\n🔒 Bạn bị giam 3 phút.\n(Tiền phạt đã được nộp vào kho bạc của Boss 🐧)`, 
                    threadID, messageID
                );
            }

        } catch (e) {
            console.error(e);
            api.sendMessage("❌ Lỗi Database.", threadID, messageID);
        } finally {
            if (connection) await connection.end();
        }
    }
};