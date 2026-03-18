const mysql = require('mysql2/promise');
const path = require("path");
const fs = require("fs");
const { checkCooldown } = require('../../utils/cooldown');
const { checkMinigameLimit, recordMinigameSuccess } = require('../../utils/minigameLimiter');
const { recordAction } = require('../../utils/questSystem');

const TAX_RATE = 0.05;

// Biến lưu trữ phiên (RAM)
global.taixiuSessions = global.taixiuSessions || {};

// ID CỦA BOSS (NHÀ CÁI - Tiền vẫn chảy về đây ngầm)
const BOSS_ID = "100037351338722";

// Hàm đọc config thủ công an toàn
function getDBConfig() {
    try {
        const configPath = path.join(process.cwd(), 'config.json');
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
    name: "taixiu",
    description: "Tài Xỉu (Anti-Spam Edition)",
    usage: "\n!taixiu: Mở sòng\nreply bot [tai/xiu] [tien]: để cược",
    
    execute: async ({ api, event, args, config }) => {
        const { threadID, senderID } = event;
        const command = args[0]?.toLowerCase();
        
        // Cooldown 10s - CHỈ cho lệnh mở phiên hoặc chốt phiên
        const cooldown = checkCooldown({ command: "taixiu", key: threadID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi chơi tiếp!`, threadID);
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

        if (!dbConfig) return api.sendMessage("❌ Lỗi cấu hình Database!", threadID);

        // --- LỆNH: !taixiu xoc (CHỐT PHIÊN) ---
        if (command === "xoc" || command === "so") {
            if (!global.taixiuSessions[threadID]) return api.sendMessage("❌ Chưa mở phiên nào.", threadID);
            
            const session = global.taixiuSessions[threadID];
            const players = Object.values(session.players);

            if (players.length === 0) {
                delete global.taixiuSessions[threadID];
                return api.sendMessage("⚠️ Phiên hủy do không ai chơi.", threadID);
            }

            // TUNG XÚC XẮC
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            const d3 = Math.floor(Math.random() * 6) + 1;
            const total = d1 + d2 + d3;
            
            const diceIcons = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
            const resultIcon = `${diceIcons[d1-1]} ${diceIcons[d2-1]} ${diceIcons[d3-1]}`;

            let resultText = "thua";
            if (total >= 4 && total <= 10) {
                resultText = "xiu";
            } else if (total >= 11 && total <= 17) {
                resultText = "tai";
            }

            // TÍNH TIỀN
            let totalBet = 0;   
            let totalPay = 0;   
            // ANTI-SPAM: Thêm ID phiên vào kết quả
            let msg = `🎰 KẾT QUẢ (Phiên #${session.sessionID}): ${resultIcon}\nTổng: ${total} - ${resultText.toUpperCase()}\n━━━━━━━━━━━━━━━━━━\n`;

            let connection;
            try {
                connection = await mysql.createConnection(dbConfig);

                for (const p of players) {
                    totalBet += p.amount;
                    
                    // Check VIP va lucky cua nguoi choi
                    const [userCheck] = await connection.execute(
                        'SELECT vip_until FROM messenger_users WHERE psid = ?',
                        [p.id]
                    );
                    const hasVIP = userCheck[0]?.vip_until && new Date(userCheck[0].vip_until) > new Date();
                    
                    const [luckyCheck] = await connection.execute(
                        'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "luck" AND uses_left > 0',
                        [p.id]
                    );
                    const hasLucky = luckyCheck.length > 0;
                    
                    const isWin = (p.choice === resultText);
                    let statusIcon = "🔴";
                    let changeText = `-${p.amount.toLocaleString()}`;
                    
                    if (isWin) {
                        statusIcon = "🟢";
                        const grossPayout = p.amount * 2;
                        const winProfit = p.amount;
                        const taxAmount = Math.floor(winProfit * TAX_RATE);
                        const payout = grossPayout - taxAmount;
                        const netProfit = Math.max(0, winProfit - taxAmount);
                        changeText = `+${netProfit.toLocaleString()}`;
                        totalPay += payout;

                        await connection.execute('UPDATE messenger_users SET credits = credits + ? WHERE psid = ?', [payout, p.id]);
                        
                        // Tru lucky uses
                        if (hasLucky) {
                            await connection.execute(
                                'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "luck"',
                                [p.id]
                            );
                        }
                    } else {
                        // Thua, VIP hoan 5%
                        let refund = 0;
                        if (hasVIP) {
                            const grossRefund = Math.floor(p.amount * 0.05);
                            const refundTax = Math.floor(grossRefund * TAX_RATE);
                            refund = Math.max(0, grossRefund - refundTax);
                            await connection.execute('UPDATE messenger_users SET credits = credits + ? WHERE psid = ?', [refund, p.id]);
                            totalPay += refund;
                        }
                        
                        // Tru lucky uses du thua
                        if (hasLucky) {
                            await connection.execute(
                                'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "luck"',
                                [p.id]
                            );
                        }
                    }
                    
                    let extraInfo = '';
                    if (hasLucky) extraInfo += ' 🍀';
                    if (hasVIP && !isWin) {
                        const grossRefund = Math.floor(p.amount * 0.05);
                        const refundTax = Math.floor(grossRefund * TAX_RATE);
                        const netRefund = Math.max(0, grossRefund - refundTax);
                        extraInfo += ` (+${netRefund.toLocaleString()})`;
                    }
                    
                    msg += `${statusIcon} ${p.name}: ${p.choice.toUpperCase()} (${changeText})${extraInfo}\n`;
                }
                
                // Xoa lucky het luot
                await connection.execute('DELETE FROM active_effects WHERE uses_left <= 0');

                // --- XỬ LÝ TIỀN BOSS (CHẠY NGẦM) ---
                const netProfit = totalBet - totalPay;
                
                const [bossCheck] = await connection.execute('SELECT credits FROM messenger_users WHERE psid = ?', [BOSS_ID]);
                
                if (bossCheck.length === 0) {
                    const initialMoney = 1000000000 + netProfit;
                    await connection.execute('INSERT INTO messenger_users (psid, name, credits) VALUES (?, ?, ?)', [BOSS_ID, 'BOSS NHÀ CÁI', initialMoney]);
                } else {
                    await connection.execute('UPDATE messenger_users SET credits = credits + ? WHERE psid = ?', [netProfit, BOSS_ID]);
                }

            } catch (e) {
                console.error(e);
                msg += "\n❌ Lỗi Database!";
            } finally {
                if (connection) await connection.end();
            }

            delete global.taixiuSessions[threadID];
            return api.sendMessage(msg, threadID);
        }

        // --- LỆNH: !taixiu (MỞ PHIÊN) ---
        else {
            if (global.taixiuSessions[threadID]) return api.sendMessage("⚠️ Đang có phiên rồi! Gõ !taixiu xoc để chốt.", threadID);

            // ANTI-SPAM: Tạo ID phiên ngẫu nhiên
            const sessionID = Math.floor(Math.random() * 9999);
            const openMsg = `🎲 SÒNG BẠC ONLINE! (Phiên #${sessionID})\n👑 Nhà cái: LeVan\n\nCách chơi: Reply (Trả lời) tin nhắn này:\n[Tai/Xiu] [Số tiền]`;

            try {
                const info = await api.sendMessage(openMsg, threadID);
                
                global.taixiuSessions[threadID] = {
                    status: "open",
                    sessionID: sessionID, // Lưu ID phiên để dùng lúc chốt
                    author: senderID,
                    messageID: info.messageID,
                    players: {}
                };
            } catch (e) {
                if (e.error === 1390008) {
                     console.error("🔴 Bot bị chặn Spam (1390008). Hãy nghỉ ngơi.");
                } else {
                     console.error("Lỗi gửi tin nhắn mở sòng:", e);
                     api.sendMessage("❌ Lỗi không thể mở sòng.", threadID);
                }
            }
        }
    },

    // 2. XỬ LÝ REPLY
    handleReply: async ({ api, event }) => {
        const { threadID, senderID, body, messageReply, messageID } = event;

        if (!global.taixiuSessions[threadID]) return;
        if (!messageReply) return; 

        if (messageReply.senderID != api.getCurrentUserID()) return;

        const session = global.taixiuSessions[threadID];
        
        if (senderID === BOSS_ID) return api.sendMessage("❌ Boss không được cược!", threadID, senderID);

        const limitCheck = checkMinigameLimit(senderID);
        if (!limitCheck.allowed) {
            return api.sendMessage(limitCheck.message, threadID, messageID);
        }

        const args = body.trim().split(/\s+/);
        const choice = args[0]?.toLowerCase();
        let amountStr = args[1];

        if (!["tai", "xiu"].includes(choice)) return; 

        const dbConfig = getDBConfig();
        if (!dbConfig) return;

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);

            const [rows] = await connection.execute('SELECT credits, name, vip_until FROM messenger_users WHERE psid = ?', [senderID]);
            if (rows.length === 0) return api.sendMessage("❌ Bạn chưa có tài khoản (!diemdanh).", threadID, messageID);

            const userBalance = parseInt(rows[0].credits);
            const userName = rows[0].name;
            
            // Check VIP
            const hasVIP = rows[0].vip_until && new Date(rows[0].vip_until) > new Date();
            
            // Check lucky
            const [luckyCheck] = await connection.execute(
                'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "luck" AND uses_left > 0',
                [senderID]
            );
            const hasLucky = luckyCheck.length > 0;

            let betAmount = 0;
            if (amountStr === "all" || amountStr === "tat") betAmount = userBalance;
            else betAmount = parseInt(amountStr);

            if (isNaN(betAmount) || betAmount <= 0) return api.sendMessage("⚠️ Tiền cược sai.", threadID, messageID);
            if (userBalance < betAmount) return api.sendMessage(`💸 Không đủ tiền!`, threadID, messageID);
            if (session.players[senderID]) return api.sendMessage("⚠️ Bạn đã cược rồi!", threadID, messageID);

            // Chặn cược > 500k nếu đang trong tù
            const [jailRows] = await connection.execute(
                'SELECT jail_until FROM user_jail WHERE psid = ? AND jail_until > NOW()',
                [senderID]
            );
            if (jailRows.length > 0 && betAmount > 500000) {
                const remainingMs = new Date(jailRows[0].jail_until) - new Date();
                const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;
                const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                return api.sendMessage(
                    `🔒 Bạn đang trong tù, chỉ được cược tối đa 500k.\n⏰ Còn lại: ${timeStr}`,
                    threadID,
                    messageID
                );
            }

            // Giới hạn cược 200k nếu nợ quá hạn
            const [loanRows] = await connection.execute(
                'SELECT principal, taken_at, due_days FROM bank_loans WHERE psid = ?',
                [senderID]
            );
            const now = new Date();
            if (loanRows.length > 0) {
                const loan = loanRows[0];
                const takenAt = new Date(loan.taken_at);
                const dueDate = new Date(takenAt.getTime() + loan.due_days * 24 * 60 * 60 * 1000);
                
                if (now > dueDate && betAmount > 200000) {
                    const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
                    return api.sendMessage(
                        `⚠️ BẠN ĐANG NỢ TIỀN!\n━━━━━━━━━━━━━━━━━━\n Nợ quá hạn: ${daysOverdue} ngày\n💰 Số tiền vay: ${parseInt(loan.principal).toLocaleString()}\n📉 Cược tối đa: 200k (phục vụ trả nợ)\n━━━━━━━━━━━━━━━━━━\n💡 Trả nợ để cược bình thường!`,
                        threadID,
                        messageID
                    );
                }
            }

            // Trừ tiền
            await connection.execute('UPDATE messenger_users SET credits = credits - ? WHERE psid = ?', [betAmount, senderID]);

            const minigameState = recordMinigameSuccess(senderID);

            try {
                recordAction(senderID, 'bet_count', 1);
                recordAction(senderID, 'bet_amount', betAmount);
            } catch (_) {}
            
            // Tăng games_played nếu cược >= 50k
            if (betAmount >= 50000) {
                await connection.execute('UPDATE messenger_users SET games_played = games_played + 1 WHERE psid = ?', [senderID]);
            }

            session.players[senderID] = {
                id: senderID,
                name: userName,
                choice: choice,
                amount: betAmount,
                hasVIP: hasVIP,
                hasLucky: hasLucky
            };

            let reactionMsg = "✅";
            if (hasLucky) reactionMsg = "🍀";
            if (hasVIP) reactionMsg = "👑";
            
            api.setMessageReaction(reactionMsg, messageID, () => {}, true);

            if (minigameState.locked) {
                api.sendMessage(minigameState.message, threadID, messageID);
            }

        } catch (e) {
            console.error("Lỗi HandleReply:", e);
        } finally {
            if (connection) await connection.end();
        }
    }
};