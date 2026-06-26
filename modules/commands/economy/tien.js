const { getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const { recordAction } = require("../../utils/questSystem");
const { getBotConfig } = require("../../utils/envConfig");
const { info, warn, error } = require("../../utils/logger");
const { ensureMentionsFromHistory } = require("../../utils/mentionResolver");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const prefix = process.env.BOT_PREFIX;

const TRANSFER_TAX_RATE = 0.02;

// ID CỦA BOSS (Không giới hạn hạn mức)
function getBossID() {
  const config = getBotConfig();
  return config.adminIDs?.[0] || "100037351338722";
}

module.exports = {
  name: "tien",
  description: "Xem tiền & chuyển tiền",
  usage: `\n${prefix}tien → Xem số dư & hạn mức chuyển tiền\n${prefix}tien chuyen [số_tiền] @tag → Chuyển tiền cho người được tag\n${prefix}tien chuyen [số_tiền] (reply) → Chuyển cho người được reply\n━━━━━━━━━━━━━━━━━━\n📌 Phí chuyển: 2% | Hạn mức/ngày có giới hạn\n💡 Hoặc dùng tắt: ${prefix}chuyentien [số_tiền] @tag`,
  execute: async ({ api, event, args, config, transferMode = false }) => {
    await ensureMentionsFromHistory(api, event);
    const { threadID, messageID, senderID, mentions, type, messageReply } =
      event;

    // Cooldown 5s
    const cooldown = checkCooldown({
      command: "tien",
      key: senderID,
      durationMs: 10000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    const bossID = getBossID();

    let connection;
    try {
      connection = await getConnection();

      // 2. HÀM LẤY TÊN (CHIÊU CUỐI: USER INFO + THREAD SCAN)
      const getName = async (uid) => {
        // Cách A: Nếu có tag, lấy luôn tên tag (Nhanh nhất)
        if (mentions[uid]) return mentions[uid].replace("@", "");

        // Cách B: Gọi API getUserInfo (Cách chính thống)
        const apiName = await new Promise((resolve) => {
          api.getUserInfo(uid, (err, info) => {
            if (err || !info || !info[uid]) return resolve(null);
            resolve(info[uid].name);
          });
        });
        if (apiName) return apiName;

        // Cách C: QUÉT THÀNH VIÊN NHÓM (Cứu cánh khi cách B thất bại)
        // Bot sẽ lấy danh sách tất cả thành viên trong nhóm hiện tại để tìm tên
        try {
          const threadInfo = await getThreadInfoCached(api, threadID);
          const mem = threadInfo.userInfo.find((u) => u.id == uid);
          if (mem && mem.name) return mem.name;
        } catch (e) {}

        // Cách D: Lấy từ Database (Nếu đã từng lưu đúng)
        try {
          const [rows] = await connection.execute(
            "SELECT name FROM messenger_users WHERE psid = ?",
            [uid],
          );
          if (
            rows.length > 0 &&
            rows[0].name &&
            rows[0].name !== "Thành viên mới"
          )
            return rows[0].name;
        } catch (e) {}

        return "Thành viên mới"; // Bất lực toàn tập
      };

      // Lấy tên người gửi
      let senderName = await getName(senderID);

      // 3. CHECK & UPDATE DATABASE
      const [userRows] = await connection.execute(
        "SELECT * FROM messenger_users WHERE psid = ?",
        [senderID],
      );

      if (userRows.length === 0) {
        // Người mới -> Tạo
        await connection.execute(
          "INSERT INTO messenger_users (psid, name, credits) VALUES (?, ?, ?)",
          [senderID, senderName, 10000],
        );
        api.sendMessage(
          `🎉 Chào mừng ${senderName}!\n🎁 +10,000 credits.`,
          threadID,
        );
      } else {
        // Người cũ -> CẬP NHẬT TÊN NẾU TÊN CŨ LÀ "THÀNH VIÊN MỚI"
        // Hoặc nếu tên hiện tại khác tên trong DB
        const dbName = userRows[0].name;
        if (
          senderName !== "Thành viên mới" &&
          (dbName === "Thành viên mới" || dbName !== senderName)
        ) {
          await connection.execute(
            "UPDATE messenger_users SET name = ? WHERE psid = ?",
            [senderName, senderID],
          );
        } else if (
          senderName === "Thành viên mới" &&
          dbName !== "Thành viên mới"
        ) {
          // Nếu lần này lỗi mạng không lấy được tên, nhưng trong DB có tên cũ xịn -> Dùng tên trong DB
          senderName = dbName;
        }
      }

      // --- XỬ LÝ LỆNH ---
      const command = args[0]?.toLowerCase();

      // CHUYỂN TIỀN
      if (["chuyen", "pay", "give"].includes(command)) {
        const prefix = config?.prefix || "!";
        if (!transferMode) {
          return api.sendMessage(
            `⚠️ Lệnh chuyển tiền đã tách riêng. Dùng: ${prefix}chuyentien <số_tiền> (tag/reply/ID).`,
            threadID,
            messageID,
          );
        }

        let targetID = null;
        if (Object.keys(mentions).length > 0)
          targetID = Object.keys(mentions)[0];
        else if (type === "message_reply") targetID = messageReply.senderID;
        else if (args[2] && !isNaN(args[2])) targetID = args[2]; // tien chuyen 50k [ID]

        if (!targetID)
          return api.sendMessage(
            "⚠️ Tag/Reply/ID người nhận.",
            threadID,
            messageID,
          );
        if (targetID === senderID)
          return api.sendMessage(
            "❌ Tự chuyển cho mình à?",
            threadID,
            messageID,
          );

        let amount = 0;
        for (let arg of args)
          if (!isNaN(arg) && arg !== targetID) {
            amount = parseInt(arg);
            break;
          }
        if (amount <= 0)
          return api.sendMessage("⚠️ Số tiền sai.", threadID, messageID);

        // Chặn chuyển tiền nếu đang trong tù
        const [jailRows] = await connection.execute(
          "SELECT jail_until, reason FROM user_jail WHERE psid = ? AND jail_until > NOW()",
          [senderID],
        );
        if (jailRows.length > 0) {
          return api.sendMessage(
            `🔒 Bạn đang trong tù, không thể chuyển tiền.\n⚠️ Lý do: ${jailRows[0].reason}`,
            threadID,
            messageID,
          );
        }

        // Chặn chuyển tiền nếu người nhận nợ quá hạn
        const [targetLoanRows] = await connection.execute(
          "SELECT principal, taken_at, due_days FROM bank_loans WHERE psid = ?",
          [targetID],
        );
        const now = new Date();
        if (targetLoanRows.length > 0) {
          const targetLoan = targetLoanRows[0];
          const takenAt = new Date(targetLoan.taken_at);
          const dueDate = new Date(
            takenAt.getTime() + targetLoan.due_days * 24 * 60 * 60 * 1000,
          );

          if (now > dueDate) {
            const daysOverdue = Math.floor(
              (now - dueDate) / (1000 * 60 * 60 * 24),
            );
            await connection.rollback();
            return api.sendMessage(
              `❌ NGƯỜI NHẬN ĐANG NỢ TIỀN!\n━━━━━━━━━━━━━━━━━━\n👤 ${await getName(targetID)}\n⚠️ Nợ quá hạn: ${daysOverdue} ngày\n🚫 Không thể chuyển tiền cho người đang nợ!\n━━━━━━━━━━━━━━━━━━\n💡 Chờ họ trả hết nợ rồi hãy chuyển!`,
              threadID,
              messageID,
            );
          }
        }

        const targetName = await getName(targetID);

        await connection.beginTransaction();
        try {
          const [sRows] = await connection.execute(
            "SELECT credits, games_played, vip_until FROM messenger_users WHERE psid = ?",
            [senderID],
          );
          const sBalance = parseInt(sRows[0]?.credits || 0);
          const taxAmount = Math.floor(amount * TRANSFER_TAX_RATE);
          const totalDebit = amount + taxAmount;
          if (sBalance < totalDebit) {
            await connection.rollback();
            return api.sendMessage(
              `💸 Thiếu tiền! Có: ${sBalance.toLocaleString()} | Cần: ${totalDebit.toLocaleString()} (gồm thuế 2%)`,
              threadID,
              messageID,
            );
          }

          // Variables for limit tracking
          let transferredToday = 0;
          let dailyLimit = 0;

          // NGOẠI LỆ: Boss không bị giới hạn hạn mức
          if (senderID !== bossID) {
            // Check VIP status
            const now = new Date();
            const hasVIP =
              sRows[0].vip_until && new Date(sRows[0].vip_until) > now;
            const gamesPlayed = parseInt(sRows[0]?.games_played || 0);

            // Tính hạn mức chuyển tiền dựa trên VIP và games_played
            const baseLimit = hasVIP ? 100000 : 50000;
            const bonusPerFiveGames = hasVIP ? 75000 : 50000;
            dailyLimit =
              baseLimit + Math.floor(gamesPlayed / 5) * bonusPerFiveGames;

            // Lấy hoặc tạo transfer_limits record
            const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
            const todayStr = vnTime.toISOString().split("T")[0];

            const [limitRows] = await connection.execute(
              "SELECT * FROM transfer_limits WHERE psid = ?",
              [senderID],
            );

            if (limitRows.length > 0) {
              const lastReset = new Date(limitRows[0].last_reset);
              const lastResetVN = new Date(
                lastReset.getTime() + 7 * 60 * 60 * 1000,
              );
              const lastResetStr = lastResetVN.toISOString().split("T")[0];

              if (lastResetStr === todayStr) {
                // Cùng ngày, lấy số đã chuyển
                transferredToday = parseInt(
                  limitRows[0].transferred_today || 0,
                );
              } else {
                // Đã qua ngày mới, reset về 0
                transferredToday = 0;
                await connection.execute(
                  "UPDATE transfer_limits SET transferred_today = 0, last_reset = ? WHERE psid = ?",
                  [now, senderID],
                );
              }
            } else {
              // Tạo record mới
              await connection.execute(
                "INSERT INTO transfer_limits (psid, transferred_today, last_reset) VALUES (?, 0, ?)",
                [senderID, now],
              );
            }

            // Kiểm tra hạn mức
            if (transferredToday + amount > dailyLimit) {
              await connection.rollback();
              const remaining = dailyLimit - transferredToday;
              let msg = `⚠️ VƯỢT HẠN MỨC CHUYỂN TIỀN!\n`;
              msg += `💳 Hạn mức hôm nay: ${dailyLimit.toLocaleString()}\n`;
              msg += `📤 Đã chuyển: ${transferredToday.toLocaleString()}\n`;
              msg += `💰 Còn lại: ${remaining.toLocaleString()}\n\n`;
              msg += `💡 Chơi minigame (cược ≥50k) để tăng hạn mức!\n`;
              msg += `📊 Đã chơi: ${gamesPlayed} lần (Mỗi 5 lần +${bonusPerFiveGames.toLocaleString()})`;
              if (!hasVIP)
                msg += `\n👑 VIP: Gấp đôi hạn mức gốc + 1.5x tiền tăng!`;
              return api.sendMessage(msg, threadID, messageID);
            }
          }

          const [tRows] = await connection.execute(
            "SELECT * FROM messenger_users WHERE psid = ?",
            [targetID],
          );
          if (tRows.length === 0) {
            await connection.rollback();
            return api.sendMessage(
              `❌ ${targetName} chưa đăng ký TK.`,
              threadID,
              messageID,
            );
          }

          await connection.execute(
            "UPDATE messenger_users SET credits = credits - ? WHERE psid = ?",
            [totalDebit, senderID],
          );
          await connection.execute(
            "UPDATE messenger_users SET credits = credits + ? WHERE psid = ?",
            [amount, targetID],
          );
          if (taxAmount > 0) {
            await connection.execute(
              "UPDATE messenger_users SET credits = credits + ? WHERE psid = ?",
              [taxAmount, bossID],
            );
          }

          // Cập nhật transferred_today (trừ Boss)
          if (senderID !== bossID) {
            await connection.execute(
              "UPDATE transfer_limits SET transferred_today = transferred_today + ? WHERE psid = ?",
              [amount, senderID],
            );
          }

          await connection.commit();

          try {
            recordAction(senderID, "transfer", 1);
            recordAction(senderID, "transfer_amount", amount);
          } catch (_) {}

          // Thông báo thành công
          if (senderID === bossID) {
            return api.sendMessage(
              `✅ GIAO DỊCH THÀNH CÔNG!\n📤 Gửi: ${senderName} 👑\n📥 Nhận: ${targetName}\n💰 Tiền chuyển: ${amount.toLocaleString()}\n🧾 Thuế chuyển (2%): ${taxAmount.toLocaleString()}\n💸 Tổng trừ: ${totalDebit.toLocaleString()}\n━━━━━━━━━━━━━━━━━━\n🔓 Không giới hạn (Boss)`,
              threadID,
              messageID,
            );
          } else {
            const newTransferred = transferredToday + amount;
            const remaining = dailyLimit - newTransferred;
            return api.sendMessage(
              `✅ GIAO DỊCH THÀNH CÔNG!\n📤 Gửi: ${senderName}\n📥 Nhận: ${targetName}\n💰 Tiền chuyển: ${amount.toLocaleString()}\n🧾 Thuế chuyển (2%): ${taxAmount.toLocaleString()}\n💸 Tổng trừ: ${totalDebit.toLocaleString()}\n━━━━━━━━━━━━━━━━━━\n💳 Hạn mức còn lại: ${remaining.toLocaleString()}/${dailyLimit.toLocaleString()}`,
              threadID,
              messageID,
            );
          }
        } catch (err) {
          await connection.rollback();
          throw err;
        }
      }

      // KIỂM TRA HẠN MỨC
      else if (["hanmuc", "limit", "hm"].includes(command)) {
        // Ngoại lệ cho Boss
        if (senderID === bossID) {
          return api.sendMessage(
            `👑 HẠN MỨC BOSS\n━━━━━━━━━━━━━━━━━━\n🔓 KHÔNG GIỚI HẠN\n━━━━━━━━━━━━━━━━━━\n💎 Boss có đặc quyền chuyển tiền không giới hạn`,
            threadID,
            messageID,
          );
        }

        const [userRows] = await connection.execute(
          "SELECT games_played, vip_until FROM messenger_users WHERE psid = ?",
          [senderID],
        );
        if (userRows.length === 0)
          return api.sendMessage(
            "❌ Bạn chưa có tài khoản.",
            threadID,
            messageID,
          );

        const now = new Date();
        const hasVIP =
          userRows[0].vip_until && new Date(userRows[0].vip_until) > now;
        const gamesPlayed = parseInt(userRows[0].games_played || 0);

        // Tính hạn mức
        const baseLimit = hasVIP ? 100000 : 50000;
        const bonusPerFiveGames = hasVIP ? 75000 : 50000;
        const dailyLimit =
          baseLimit + Math.floor(gamesPlayed / 5) * bonusPerFiveGames;

        // Lấy số tiền đã chuyển hôm nay
        const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
        const todayStr = vnTime.toISOString().split("T")[0];

        const [limitRows] = await connection.execute(
          "SELECT * FROM transfer_limits WHERE psid = ?",
          [senderID],
        );

        let transferredToday = 0;
        if (limitRows.length > 0) {
          const lastReset = new Date(limitRows[0].last_reset);
          const lastResetVN = new Date(
            lastReset.getTime() + 7 * 60 * 60 * 1000,
          );
          const lastResetStr = lastResetVN.toISOString().split("T")[0];

          if (lastResetStr === todayStr) {
            transferredToday = parseInt(limitRows[0].transferred_today || 0);
          }
        }

        const remaining = dailyLimit - transferredToday;
        const gamesUntilNextBonus = 5 - (gamesPlayed % 5);
        const nextBonusGames = gamesPlayed + gamesUntilNextBonus;

        let msg = `💳 HẠN MỨC CHUYỂN TIỀN\n`;
        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `📊 Hạn mức hôm nay: ${dailyLimit.toLocaleString()}\n`;
        msg += `📤 Đã chuyển: ${transferredToday.toLocaleString()}\n`;
        msg += `💰 Còn lại: ${remaining.toLocaleString()}\n`;
        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `🎮 Games đã chơi: ${gamesPlayed} lần\n`;
        msg += `📈 Mỗi 5 games: +${bonusPerFiveGames.toLocaleString()}\n`;
        msg += `⏭️ Còn ${gamesUntilNextBonus} games nữa -> +${bonusPerFiveGames.toLocaleString()}\n`;

        if (hasVIP) {
          const vipExpire = new Date(userRows[0].vip_until);
          const daysLeft = Math.ceil((vipExpire - now) / (1000 * 60 * 60 * 24));
          msg += `━━━━━━━━━━━━━━━━━━\n`;
          msg += `👑 VIP: Đang hoạt động (${daysLeft} ngày)\n`;
          msg += `✨ Lợi ích: Gấp đôi hạn mức + 1.5x bonus\n`;
        } else {
          msg += `━━━━━━━━━━━━━━━━━━\n`;
          msg += `💡 Mua VIP để gấp đôi hạn mức!\n`;
        }
        msg += `\n📌 Chơi minigame (cược ≥50k) để tăng hạn mức`;

        return api.sendMessage(msg, threadID, messageID);
      }

      // XEM SỐ DƯ
      else {
        let viewID = senderID;
        let viewName = senderName;

        if (Object.keys(mentions).length > 0) {
          viewID = Object.keys(mentions)[0];
          viewName = await getName(viewID);
        } else if (type === "message_reply") {
          viewID = messageReply.senderID;
          viewName = await getName(viewID);
        }

        const [rows] = await connection.execute(
          "SELECT credits, name FROM messenger_users WHERE psid = ?",
          [viewID],
        );
        if (rows.length === 0)
          return api.sendMessage(
            `❌ ${viewName} chưa có tài khoản.`,
            threadID,
            messageID,
          );

        // Ưu tiên hiển thị tên vừa lấy được (viewName) cho chuẩn xác nhất
        const finalName =
          viewName !== "Thành viên mới" ? viewName : rows[0].name;

        return api.sendMessage(
          `💰 TÀI KHOẢN: ${finalName}\n💳 Số dư: ${parseInt(rows[0].credits).toLocaleString()} credits`,
          threadID,
          messageID,
        );
      }
    } catch (e) {
      console.error(e);
      return api.sendMessage("❌ Lỗi Database.", threadID);
    } finally {
      if (connection) connection.release();
    }
  },
};
