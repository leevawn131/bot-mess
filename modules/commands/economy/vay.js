const { execute } = require('../../utils/database');
const path = require('path');
const fs = require('fs');
const { checkCooldown } = require('../../utils/cooldown');
const { parseMoneyAmount } = require('../../utils/parseMoney');
const prefix = process.env.BOT_PREFIX;

// ID CỦA BOSS (Cho vay tiền)
const BOSS_ID = "100037351338722";

// Hàm lấy ngày từ Date object (dùng giờ hệ thống đã là UTC+7)
function getDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Hạn mức vay tối đa
const MAX_LOAN = 5000000;

// Lãi suất mỗi ngày
const DAILY_INTEREST_RATE = 0.075; // 7.5%

function formatMoney(amount) {
    return Math.floor(Number(amount) || 0).toLocaleString('vi-VN');
}

function normalizeDate(value, fallback = new Date()) {
    const d = value ? new Date(value) : new Date(fallback);
    if (Number.isNaN(d.getTime())) return new Date(fallback);
    return d;
}

function getElapsedLoanDays(lastCheckAt, now = new Date()) {
    const lastCheckDate = normalizeDate(lastCheckAt, now);
    const lastCheckDay = getDateString(lastCheckDate);
    const nowDay = getDateString(now);

    if (lastCheckDay === nowDay) return 0;
    return Math.max(0, Math.floor((now - lastCheckDate) / (1000 * 60 * 60 * 24)));
}

function previewCompoundedPrincipal(loan, now = new Date()) {
    const principal = Math.max(0, Math.floor(Number(loan?.principal) || 0));
    const rate = Number(loan?.interest_rate) || DAILY_INTEREST_RATE;
    const lastCheckAt = loan?.last_loan_check || loan?.taken_at || now;
    const daysElapsed = getElapsedLoanDays(lastCheckAt, now);

    if (daysElapsed <= 0) {
        return {
            principal,
            daysElapsed
        };
    }

    return {
        principal: Math.floor(principal * Math.pow(1 + rate, daysElapsed)),
        daysElapsed
    };
}

async function syncLoanWithCompoundInterest(loan, psid, threadId, now = new Date()) {
    const preview = previewCompoundedPrincipal(loan, now);
    const currentPrincipal = Math.max(0, Math.floor(Number(loan?.principal) || 0));

    if (preview.daysElapsed > 0 || preview.principal !== currentPrincipal) {
        await execute(
            'UPDATE bank_loans SET principal = ?, last_loan_check = ? WHERE thread_id = ? AND psid = ?',
            [preview.principal, now, threadId, psid]
        );
    }

    return preview;
}

module.exports = {
    name: "vay",
    description: "Vay tiền từ Boss (lãi 7.5%/ngày)",
    usage: `\n${prefix}vay [số_tiền] [số_ngày] → Vay tiền mới\n${prefix}vay check → Xem thông tin khoản vay hiện tại\n${prefix}vay tra → Trả nợ (toàn bộ hoặc 1 phần)\n${prefix}vay checkall → Xem tất cả con nợ (Boss only)\n━━━━━━━━━━━━━\n💰 Hạn mức: 1,000,000 xu | Lãi suất: 7.5%/ngày (lãi kép)\n⏰ Trả từ ngày mai | Quá hạn 3 ngày = Vào tù\n💡 Ví dụ: ${prefix}vay 500000 7`,

    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "vay", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, undefined, messageID);
        }

        const command = args[0]?.toLowerCase();

        try {
            // Kiểm tra xem user có đang trong tù không
            const jailRows = await execute(
                'SELECT * FROM user_jail WHERE thread_id = ? AND psid = ? AND jail_until > datetime(\'now\', \'localtime\')',
                [String(threadID), senderID]
            );

            if (jailRows.length > 0) {
                const jailUntil = new Date(jailRows[0].jail_until);
                const now = new Date();
                const remainingMs = jailUntil - now;
                const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;
                const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                return api.sendMessage(
                    `🔒 BẠN ĐANG TRONG TÙ!\n━━━━━━━━━━━━━\n⏰ Còn lại: ${timeStr}\n❌ Không thể vay tiền trong tù`,
                    threadID,
                    undefined,
                    messageID
                );
            }

            // Lấy thông tin user
            const userRows = await execute('SELECT credits, name FROM messenger_users WHERE thread_id = ? AND psid = ?', [String(threadID), senderID]);
            if (userRows.length === 0) {
                return api.sendMessage(`❌ Bạn chưa có tài khoản. Gõ ${prefix}tien để tạo.`, threadID, undefined, messageID);
            }

            const userName = userRows[0].name;

            // === CHECK ALL KHOẢN VAY (ADMIN/BOSS) ===
            if (command === "checkall") {
                if (senderID !== BOSS_ID) {
                    return api.sendMessage("❌ Chỉ Boss mới dùng được lệnh này.", threadID, undefined, messageID);
                }

                const loanRows = await execute(
                    `SELECT bl.psid, bl.principal, bl.interest_rate, bl.taken_at, bl.last_loan_check, bl.due_days, bl.is_overdue,
                            mu.name
                     FROM bank_loans bl
                     LEFT JOIN messenger_users mu ON mu.psid = bl.psid AND mu.thread_id = bl.thread_id
                     WHERE bl.thread_id = ?
                     ORDER BY bl.taken_at ASC`,
                    [String(threadID)]
                );

                if (loanRows.length === 0) {
                    return api.sendMessage("✅ Hiện không có khoản vay nào.", threadID, undefined, messageID);
                }

                const now = new Date();
                let msg = `📋 DANH SÁCH CON NỢ\n━━━━━━━━━━━━━\n`;
                msg += `👥 Tổng: ${loanRows.length}\n`;
                msg += `━━━━━━━━━━━━━\n`;

                loanRows.forEach((loan, idx) => {
                    const principal = parseInt(loan.principal);
                    const takenAt = new Date(loan.taken_at);
                    const dueDate = new Date(takenAt.getTime() + loan.due_days * 24 * 60 * 60 * 1000);

                    const preview = previewCompoundedPrincipal(loan, now);
                    const totalDebt = preview.principal;

                    const isOverdue = now > dueDate;
                    const daysOverdue = isOverdue ? Math.floor((now - dueDate) / (1000 * 60 * 60 * 24)) : 0;
                    const daysUntilDue = Math.max(0, Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24)));

                    const name = loan.name || "Không rõ";
                    const status = isOverdue ? `❌ Quá hạn ${daysOverdue} ngày` : `📅 Còn ${daysUntilDue} ngày`;

                    msg += `${idx + 1}. ${name}\n`;
                    msg += `🆔 ${loan.psid}\n`;
                    msg += `💰 Gốc: ${formatMoney(principal)}\n`;
                    msg += `💵 Nợ: ${formatMoney(totalDebt)}\n`;
                    msg += `${status}\n`;
                    msg += `━━━━━━━━━━━━━\n`;
                });

                return api.sendMessage(msg, threadID, undefined, messageID);
            }

            // === CHECK KHOẢN VAY ===
            if (["check", "info"].includes(command)) {
                const loanRows = await execute('SELECT * FROM bank_loans WHERE thread_id = ? AND psid = ?', [String(threadID), senderID]);
                
                if (loanRows.length === 0) {
                    return api.sendMessage(
                        `💳 THÔNG TIN VAY\n━━━━━━━━━━━━━\n👤 ${userName}\n📊 Không có khoản vay nào\n━━━━━━━━━━━━━\n💡 Vay tối đa: ${formatMoney(MAX_LOAN)}\n💰 Lãi suất: 7.5%/ngày`,
                        threadID,
                        undefined,
                        messageID
                    );
                }

                const loan = loanRows[0];
                const interestRate = parseFloat(loan.interest_rate);
                const takenAt = new Date(loan.taken_at);
                const now = new Date();
                const dueDate = new Date(takenAt.getTime() + loan.due_days * 24 * 60 * 60 * 1000);

                const syncedLoan = await syncLoanWithCompoundInterest(loan, senderID, String(threadID), now);
                const principal = syncedLoan.principal;
                const totalDebt = principal;

                // Kiểm tra quá hạn
                const isOverdue = now > dueDate;
                const daysOverdue = isOverdue ? Math.floor((now - dueDate) / (1000 * 60 * 60 * 24)) : 0;

                const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
                
                let msg = `💳 THÔNG TIN KHOẢN VAY\n━━━━━━━━━━━━━\n👤 ${userName}\n`;
                msg += `💰 Gốc hiện tại: ${formatMoney(principal)}\n`;
                msg += `📈 Lãi suất: ${(interestRate * 100).toFixed(1)}%/ngày\n`;
                msg += `💵 Tổng nợ hiện tại: ${formatMoney(totalDebt)}\n`;
                msg += `━━━━━━━━━━━━━\n`;
                
                if (isOverdue) {
                    msg += `❌ QUÁ HẠN ${daysOverdue} NGÀY!\n`;
                    if (daysOverdue >= 3) {
                        msg += `⚠️ Chuẩn bị vào tù!\n`;
                    }
                } else {
                    msg += `📅 Hạn trả: ${daysUntilDue} ngày nữa\n`;
                }
                
                msg += `━━━━━━━━━━━━━\n`;
                msg += `💡 Dùng ${prefix}vay tra để trả nợ`;

                return api.sendMessage(msg, threadID, undefined, messageID);
            }

            // === TRẢ NỢ ===
            else if (["tra", "pay", "repay"].includes(command)) {
                const loanRows = await execute('SELECT * FROM bank_loans WHERE thread_id = ? AND psid = ?', [String(threadID), senderID]);
                
                if (loanRows.length === 0) {
                    return api.sendMessage("❌ Bạn không có khoản vay nào cần trả.", threadID, undefined, messageID);
                }

                const loan = loanRows[0];
                const takenAt = new Date(loan.taken_at);
                const now = new Date();

                // Kiểm tra đã sang ngày tiếp theo chưa (dựa trên ngày lịch)
                const takenAtDay = getDateString(takenAt);
                const nowDay = getDateString(now);
                
                if (takenAtDay === nowDay) {
                    // Cùng ngày = không được trả
                    const tomorrowStart = new Date(now);
                    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
                    tomorrowStart.setHours(0, 0, 0, 0);
                    
                    const hoursLeft = Math.ceil((tomorrowStart - now) / (1000 * 60 * 60));
                    
                    return api.sendMessage(
                        `⏰ CHƯA ĐỦ THỜI GIAN!\n━━━━━━━━━━━━━\n⚠️ Vay hôm nay, trả từ ngày mai (00:00 UTC+7)\n⏳ Còn lại: ~${hoursLeft} giờ`,
                        threadID,
                        undefined,
                        messageID
                    );
                }

                const syncedLoan = await syncLoanWithCompoundInterest(loan, senderID, String(threadID), now);
                const totalDebt = syncedLoan.principal;

                const userCredits = parseInt(userRows[0].credits);

                const replyMsg = `💳 TRẢ NỢ\n━━━━━━━━━━━━━\n💰 Tổng nợ: ${formatMoney(totalDebt)}\n💵 Tiền có: ${formatMoney(userCredits)}\n━━━━━━━━━━━━━\nReply:\n1️⃣ - Trả toàn bộ\n2️⃣ - Trả một phần (gõ số tiền trực tiếp)`;
                const info = await api.sendMessage(replyMsg, threadID, undefined, messageID);

                global.vayReplyContexts = global.vayReplyContexts || {};
                if (info?.messageID) {
                    global.vayReplyContexts[info.messageID] = {
                        author: String(senderID),
                        threadID: String(threadID),
                        totalDebt,
                        principal: totalDebt,
                        userName,
                        createdAt: Date.now()
                    };
                }

                return;
            }

            // === VAY TIỀN ===
            else {
                // Kiểm tra xem đã có khoản vay chưa
                const loanRows = await execute('SELECT * FROM bank_loans WHERE thread_id = ? AND psid = ?', [String(threadID), senderID]);
                
                if (loanRows.length > 0) {
                    return api.sendMessage(
                        `❌ BẠN ĐÃ CÓ KHOẢN VAY!\n━━━━━━━━━━━━━\n💡 Phải trả hết nợ cũ mới vay được\n📊 Dùng ${prefix}vay check để xem chi tiết`,
                        threadID,
                        undefined,
                        messageID
                    );
                }

                const amountStr = args[0];
                const daysStr = args[1];

                if (!amountStr || !daysStr) {
                    return api.sendMessage(
                        `💳 VAY TIỀN - HƯỚNG DẪN\n━━━━━━━━━━━━━\n📝 Cú pháp: ${prefix}vay [số_tiền] [số_ngày]\n💡 Ví dụ: ${prefix}vay 500000 7\n━━━━━━━━━━━━━\n💰 Hạn mức: ${formatMoney(MAX_LOAN)}\n📈 Lãi suất: 7.5%/ngày\n⏰ Trả từ ngày mai (00:00 UTC+7)`,
                        threadID,
                        undefined,
                        messageID
                    );
                }

                const amount = parseMoneyAmount(amountStr);
                const days = parseInt(daysStr);

                if (isNaN(amount) || amount <= 0) {
                    return api.sendMessage("⚠️ Số tiền không hợp lệ!", threadID, undefined, messageID);
                }

                if (amount > MAX_LOAN) {
                    return api.sendMessage(
                        `❌ VƯỢT HẠN MỨC VAY!\n━━━━━━━━━━━━━\n💰 Hạn mức tối đa: ${formatMoney(MAX_LOAN)}\n📝 Bạn muốn vay: ${formatMoney(amount)}`,
                        threadID,
                        undefined,
                        messageID
                    );
                }

                if (isNaN(days) || days < 1 || days > 30) {
                    return api.sendMessage("⚠️ Số ngày phải từ 1-30 ngày!", threadID, undefined, messageID);
                }

                // Tính tổng lãi dự kiến
                const estimatedTotal = Math.floor(amount * Math.pow(1 + DAILY_INTEREST_RATE, days));
                const estimatedInterest = estimatedTotal - amount;

                const now = new Date();

                // Tạo khoản vay
                await execute(
                    'INSERT INTO bank_loans (thread_id, psid, principal, interest_rate, taken_at, last_loan_check, due_days, is_overdue) VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)',
                    [String(threadID), senderID, amount, DAILY_INTEREST_RATE, now, now, days]
                );

                // Cộng tiền cho user
                await execute('UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?', [amount, String(threadID), senderID]);

                // Trừ tiền boss
                await execute('UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?', [amount, String(threadID), BOSS_ID]);

                return api.sendMessage(
                    `✅ VAY TIỀN THÀNH CÔNG!\n━━━━━━━━━━━━━\n👤 ${userName}\n💰 Số tiền vay: ${formatMoney(amount)}\n📅 Thời hạn: ${days} ngày\n📈 Lãi suất: 7.5%/ngày (lãi kép)\n━━━━━━━━━━━━━\n💵 Dự kiến lãi: ~${formatMoney(estimatedInterest)}\n💸 Dự kiến trả: ~${formatMoney(estimatedTotal)}\n⏰ Trả từ ngày mai (00:00 UTC+7)\n━━━━━━━━━━━━━\n⚠️ Quá hạn 3 ngày = Vào tù!`,
                    threadID,
                    undefined,
                    messageID
                );
            }

        } catch (e) {
            console.log("Lỗi Vay:", e);
            return api.sendMessage(`❌ Lỗi hệ thống vay tiền: ${e.message}`, threadID, undefined, messageID);
        }
    },

    // Handle reply cho trả nợ
    handleReply: async ({ api, event, config }) => {
        const { threadID, messageID, senderID, body } = event;
        const prefix = config?.prefix || "!";

        if (event.type !== "message_reply") return;

        const replyContexts = global.vayReplyContexts || {};
        const context = replyContexts[event.messageReply?.messageID];
        if (!context) return;
        if (String(context.threadID) !== String(threadID)) return;
        if (String(context.author) !== String(senderID)) {
            return api.sendMessage("⚠️ Chỉ người đã mở trả nợ mới được reply.", threadID, undefined, messageID);
        }

        const reply = String(body || "").trim();
        const userName = context.userName || "Người dùng";

        try {
            // Cập nhật lại credits hiện tại
            const userRows = await execute('SELECT credits FROM messenger_users WHERE thread_id = ? AND psid = ?', [String(threadID), senderID]);
            if (userRows.length === 0) {
                delete replyContexts[event.messageReply?.messageID];
                return api.sendMessage("❌ Bạn chưa có tài khoản.", threadID, undefined, messageID);
            }

            const currentCredits = parseInt(userRows[0].credits);

            const loanRows = await execute('SELECT * FROM bank_loans WHERE thread_id = ? AND psid = ?', [String(threadID), senderID]);
            if (loanRows.length === 0) {
                delete replyContexts[event.messageReply?.messageID];
                return api.sendMessage("✅ Khoản vay đã được tất toán trước đó.", threadID, undefined, messageID);
            }

            const now = new Date();
            const syncedLoan = await syncLoanWithCompoundInterest(loanRows[0], senderID, String(threadID), now);
            const totalDebt = syncedLoan.principal;

            if (reply === "1") {
                // Trả toàn bộ
                if (currentCredits < totalDebt) {
                    return api.sendMessage(
                        `💸 KHÔNG ĐỦ TIỀN!\n━━━━━━━━━━━━━\n💰 Cần: ${formatMoney(totalDebt)}\n💵 Có: ${formatMoney(currentCredits)}\n💔 Thiếu: ${formatMoney(totalDebt - currentCredits)}`,
                        threadID,
                        undefined,
                        messageID
                    );
                }

                // Trừ tiền user
                await execute('UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?', [totalDebt, String(threadID), senderID]);

                // Cộng tiền cho boss
                await execute('UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?', [totalDebt, String(threadID), BOSS_ID]);

                // Xóa khoản vay
                await execute('DELETE FROM bank_loans WHERE thread_id = ? AND psid = ?', [String(threadID), senderID]);

                // Nếu đang trong tù vì nợ, thả ra
                await execute('DELETE FROM user_jail WHERE thread_id = ? AND psid = ? AND reason = "Nợ quá hạn"', [String(threadID), senderID]);

                delete replyContexts[event.messageReply?.messageID];
                return api.sendMessage(
                    `✅ TRẢ NỢ THÀNH CÔNG!\n━━━━━━━━━━━━━\n👤 ${userName}\n💰 Đã trả: ${formatMoney(totalDebt)}\n💵 Còn lại: ${formatMoney(currentCredits - totalDebt)}\n━━━━━━━━━━━━━\n🎉 Hết nợ rồi!`,
                    threadID,
                    undefined,
                    messageID
                );
            } else if (reply === "2") {
                return api.sendMessage("💡 Gõ trực tiếp số tiền bạn muốn trả (ví dụ: 200000 hoặc 200k).", threadID, undefined, messageID);
            } else {
                const partialAmount = parseMoneyAmount(reply);
                if (isNaN(partialAmount)) {
                    return api.sendMessage("⚠️ Reply không hợp lệ! Reply 1 hoặc gõ số tiền.", threadID, undefined, messageID);
                }

                if (partialAmount <= 0 || partialAmount > totalDebt) {
                    return api.sendMessage("⚠️ Số tiền không hợp lệ!", threadID, undefined, messageID);
                }

                if (currentCredits < partialAmount) {
                    return api.sendMessage(`💸 Không đủ tiền! Có: ${currentCredits.toLocaleString('vi-VN')}`, threadID, undefined, messageID);
                }

                // Trừ tiền user
                await execute('UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?', [partialAmount, String(threadID), senderID]);

                // Cộng tiền cho boss
                await execute('UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?', [partialAmount, String(threadID), BOSS_ID]);

                // Giảm gốc
                const newPrincipal = totalDebt - partialAmount;

                if (newPrincipal <= 0) {
                    // Trả hết
                    await execute('DELETE FROM bank_loans WHERE thread_id = ? AND psid = ?', [String(threadID), senderID]);
                    await execute('DELETE FROM user_jail WHERE thread_id = ? AND psid = ? AND reason = "Nợ quá hạn"', [String(threadID), senderID]);

                    delete replyContexts[event.messageReply?.messageID];

                    return api.sendMessage(
                        `✅ TRẢ NỢ THÀNH CÔNG!\n━━━━━━━━━━━━━\n👤 ${userName}\n💰 Đã trả: ${formatMoney(partialAmount)}\n💵 Còn lại: ${formatMoney(currentCredits - partialAmount)}\n━━━━━━━━━━━━━\n🎉 Hết nợ rồi!`,
                        threadID,
                        undefined,
                        messageID
                    );
                } else {
                    // Cập nhật gốc mới và reset last_loan_check
                    const now = new Date();
                    await execute(
                        'UPDATE bank_loans SET principal = ?, last_loan_check = ?, is_overdue = FALSE WHERE thread_id = ? AND psid = ?',
                        [newPrincipal, now, String(threadID), senderID]
                    );

                    // Nếu đang trong tù vì nợ, thả ra
                    await execute('DELETE FROM user_jail WHERE thread_id = ? AND psid = ? AND reason = "Nợ quá hạn"', [String(threadID), senderID]);

                    if (event.messageReply?.messageID) {
                        replyContexts[event.messageReply.messageID] = {
                            ...context,
                            principal: newPrincipal,
                            totalDebt: newPrincipal
                        };
                    }

                    return api.sendMessage(
                        `✅ TRẢ NỢ 1 PHẦN THÀNH CÔNG!\n━━━━━━━━━━━━━\n👤 ${userName}\n💰 Đã trả: ${formatMoney(partialAmount)}\n💵 Nợ còn lại: ${formatMoney(newPrincipal)}\n━━━━━━━━━━━━━\n💡 Dùng ${prefix}vay check để xem chi tiết`,
                        threadID,
                        undefined,
                        messageID
                    );
                }
            }

        } catch (e) {
            console.error("Lỗi Vay Reply:", e);
            return api.sendMessage("❌ Lỗi xử lý trả nợ.", threadID, undefined, messageID);
        }
    }
};
