const { execute, getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const {
  checkMinigameLimit,
  recordMinigameSuccess,
} = require("../../utils/minigameLimiter");
const prefix = process.env.BOT_PREFIX;

// ID CỦA BOSS (Nhà cái ôm lô)
const BOSS_ID = "100037351338722";
const RATE = 70; // Tỉ lệ 1 ăn 70

module.exports = {
  name: "lode",
  description: "Ghi lô đề (1 ăn 70) - Xổ ngay lập tức",
  usage: `\n${prefix}lode [số 00-99] [tiền_cược] → Ghi lô đề\n━━━━━━━━━━━━━\n🎰 Tỉ lệ: 1 ăn 70 | Tối đa 5 con/lần\n🎲 Xổ ngay lập tức sau khi ghi\n💡 Ví dụ: ${prefix}lode 69 10000\n💡 Nhiều con: ${prefix}lode 12 5000 45 3000`,

  execute: async ({ api, event, args, config }) => {
    const { threadID, senderID, messageID } = event;
    const prefix = config?.prefix || "!";

    // Cooldown 10s
    const cooldown = checkCooldown({
      command: "lode",
      key: threadID,
      durationMs: 10000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi chơi tiếp!`,
        threadID,
        messageID,
      );
    }

    // Boss không được chơi (để tránh tự lấy tiền túi bỏ túi mình)
    if (senderID === BOSS_ID)
      return api.sendMessage(
        "❌ Boss là chủ lô, không được đánh!",
        threadID,
        messageID,
      );

    const limitCheck = checkMinigameLimit(senderID);
    if (!limitCheck.allowed) {
      return api.sendMessage(limitCheck.message, threadID, messageID);
    }

    // Validate đầu vào
    const pick = args[0];
    const amountStr = args[1];

    if (!pick || isNaN(pick) || pick < 0 || pick > 99 || pick.length !== 2) {
      return api.sendMessage(
        `⚠️ Cách chơi:\n${prefix}lode [số 00-99] [tiền_cược]\nVí dụ: ${prefix}lode 88 10000\nCược tối đa 5 con/lần`,
        threadID,
        messageID,
      );
    }

    const db = config.database;
    const dbConfig = {
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.name,
    };

    let connection;
    try {
      connection = await getConnection();

      // Check tiền
      const [rows] = await connection.execute(
        "SELECT credits, vip_until FROM messenger_users WHERE psid = ?",
        [senderID],
      );
      if (rows.length === 0)
        return api.sendMessage(
          `❌ Bạn chưa có tài khoản (${prefix}diemdanh để nhận tiền).`,
          threadID,
          messageID,
        );

      const balance = parseInt(rows[0].credits);
      const hasVIP =
        rows[0].vip_until && new Date(rows[0].vip_until) > new Date();
      let amount = 0;
      if (amountStr === "all" || amountStr === "tat") {
        amount = balance;
      } else if (amountStr && typeof amountStr === "string" && amountStr.endsWith("%")) {
        const percentStr = amountStr.slice(0, -1);
        const percent = parseFloat(percentStr);
        if (!isNaN(percent) && percent > 0 && percent <= 100) {
          amount = Math.floor((balance * percent) / 100);
        } else {
          return api.sendMessage("⚠️ Phần trăm cược không hợp lệ (phải từ 1% đến 100%).", threadID, messageID);
        }
      } else {
        amount = parseInt(amountStr);
      }

      if (isNaN(amount) || amount <= 0)
        return api.sendMessage(
          "⚠️ Tiền cược không hợp lệ.",
          threadID,
          messageID,
        );
      if (balance < amount)
        return api.sendMessage(
          `💸 Không đủ tiền! Còn: ${balance.toLocaleString()}`,
          threadID,
          messageID,
        );

      // Chặn cược > 500k nếu đang trong tù
      const [jailRows] = await connection.execute(
        "SELECT jail_until FROM user_jail WHERE psid = ? AND jail_until > NOW()",
        [senderID],
      );
      if (jailRows.length > 0 && amount > 500000) {
        const remainingMs = new Date(jailRows[0].jail_until) - new Date();
        const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const timeStr = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
        return api.sendMessage(
          `🔒 Bạn đang trong tù, chỉ được cược tối đa 500k.\n⏰ Còn lại: ${timeStr}`,
          threadID,
          messageID,
        );
      }

      // Giới hạn cược 200k nếu nợ quá hạn
      const [loanRows] = await connection.execute(
        "SELECT principal, taken_at, due_days FROM bank_loans WHERE psid = ?",
        [senderID],
      );
      const now = new Date();
      if (loanRows.length > 0) {
        const loan = loanRows[0];
        const takenAt = new Date(loan.taken_at);
        const dueDate = new Date(
          takenAt.getTime() + loan.due_days * 24 * 60 * 60 * 1000,
        );

        if (now > dueDate && amount > 200000) {
          const daysOverdue = Math.floor(
            (now - dueDate) / (1000 * 60 * 60 * 24),
          );
          return api.sendMessage(
            `⚠️ BẠN ĐANG NỢ TIỀN!\n━━━━━━━━━━━━━\n Nợ quá hạn: ${daysOverdue} ngày\n💰 Số tiền vay: ${parseInt(loan.principal).toLocaleString()}\n📉 Cược tối đa: 200k (phục vụ trả nợ)\n━━━━━━━━━━━━━\n💡 Trả nợ để cược bình thường!`,
            threadID,
            messageID,
          );
        }
      }

      // Check VIP status            // Check lucky effect
      const [luckyCheck] = await connection.execute(
        'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "luck" AND uses_left > 0',
        [senderID],
      );
      const hasLucky = luckyCheck.length > 0;

      // TRỪ TIỀN NGƯỜI CHƠI TRƯỚC (Coi như đã đóng tiền cho Boss)
      await connection.execute(
        "UPDATE messenger_users SET credits = credits - ? WHERE psid = ?",
        [amount, senderID],
      );

      const minigameState = recordMinigameSuccess(senderID);

      // Tăng games_played nếu cược >= 50k
      if (amount >= 50000) {
        await connection.execute(
          "UPDATE messenger_users SET games_played = games_played + 1 WHERE psid = ?",
          [senderID],
        );
      }

      // --- QUAY SỐ ---
      api.sendMessage(
        `🎰 Đang quay số... Chúc bạn may mắn với con số **${pick}**...`,
        threadID,
      );

      // Delay 2 giây cho hồi hộp
      await new Promise((r) => setTimeout(r, 2000));

      // Ti le trung: 1/100 = 1%
      // Lucky buff: +8% -> 9%
      // VIP buff: +5% -> 14% (co ca lucky va VIP)
      let winChance = 0.01; // 1%

      if (hasLucky) {
        const luckyBonus = luckyCheck[0].effect_value / 100;
        winChance += luckyBonus;
      }

      if (hasVIP) {
        winChance += 0.05;
      }

      const isWin = Math.random() < winChance;
      const result = isWin
        ? pick
        : Math.floor(Math.random() * 100)
            .toString()
            .padStart(2, "0");

      let msg = `🎱 **KẾT QUẢ XỔ SỐ: ${result}**\n`;

      if (result === pick) {
        // TRÚNG LÔ
        const winMoney = amount * RATE;
        msg += `🎉 **CHÚC MỪNG!** Bạn đã trúng con lô **${pick}**\n`;
        msg += `💰 Tiền thưởng: ${winMoney.toLocaleString()} credits (1 ăn 70)\n`;
        if (hasLucky) msg += `🍀 Bùa may đã phát huy tác dụng!\n`;
        if (hasVIP) msg += `👑 VIP đã buff tỉ lệ!\n`;
        msg += `💸 Boss vừa phải móc túi trả tiền cho bạn 😭`;

        // Cộng tiền thắng cho User
        await connection.execute(
          "UPDATE messenger_users SET credits = credits + ? WHERE psid = ?",
          [winMoney, senderID],
        );

        // Trừ tiền của Boss (Vì Boss phải trả thưởng)
        const bossLoss = winMoney - amount;
        await connection.execute(
          "UPDATE messenger_users SET credits = credits - ? WHERE psid = ?",
          [bossLoss, BOSS_ID],
        );

        // Tru luot dung lucky
        if (hasLucky) {
          await connection.execute(
            'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "luck"',
            [senderID],
          );
          await connection.execute(
            "DELETE FROM active_effects WHERE uses_left <= 0",
          );
        }
      } else {
        // TRƯỢT LÔ
        msg += `☁️ **RẤT TIẾC!** Vận may chưa đến.\n`;
        msg += `💸 Bạn mất ${amount.toLocaleString()} credits.\n`;

        // VIP hoàn 5% khi thua
        let refund = 0;
        if (hasVIP) {
          refund = Math.floor(amount * 0.05);
          await connection.execute(
            "UPDATE messenger_users SET credits = credits + ? WHERE psid = ?",
            [refund, senderID],
          );
          msg += `👑 VIP hoàn lại: ${refund.toLocaleString()} credits\n`;
        }

        msg += `📈 Số tiền còn lại đã được chuyển vào quỹ từ thiện của Boss 🐧`;

        // Cộng tiền thua của User vào túi Boss (tru phan hoan lai)
        await connection.execute(
          "UPDATE messenger_users SET credits = credits + ? WHERE psid = ?",
          [amount - refund, BOSS_ID],
        );

        // Tru luot dung lucky
        if (hasLucky) {
          await connection.execute(
            'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "luck"',
            [senderID],
          );
          await connection.execute(
            "DELETE FROM active_effects WHERE uses_left <= 0",
          );
        }
      }

      if (minigameState.locked) {
        msg += `\n\n${minigameState.message}`;
      }

      return api.sendMessage(msg, threadID, messageID);
    } catch (e) {
      console.error(e);
      api.sendMessage("❌ Lỗi Database.", threadID, messageID);
    } finally {
      if (connection) connection.release();
    }
  },
};
