const { getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const { recordAction } = require("../../utils/questSystem");
const { getBotConfig } = require("../../utils/envConfig");
const { info, warn, error } = require("../../utils/logger");
const { ensureMentionsFromHistory } = require("../../utils/mentionResolver");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const { parseMoneyAmount } = require("../../utils/parseMoney");
const prefix = process.env.BOT_PREFIX || '!';

const TRANSFER_TAX_RATE = 0.02;

// ID CỦA BOSS (Không giới hạn hạn mức)
function getBossID() {
  const config = getBotConfig();
  return config.adminIDs?.[0] || "100037351338722";
}

module.exports = {
  name: "tien",
  description: "Xem tiền & chuyển tiền",
  usage: `\n${prefix}tien → Xem số dư & hạn mức chuyển tiền\n${prefix}tien chuyen [số_tiền] @tag → Chuyển tiền cho người được tag\n${prefix}tien chuyen [số_tiền] (reply) → Chuyển cho người được reply\n━━━━━━━━━━━━━━━━━━\n📌 Phí chuyển: 2% | Hạn mức/ngày có giới hạn (Hỗ trợ k, tr, m)\n💡 Hoặc dùng tắt: ${prefix}chuyentien [số_tiền] @tag`,
  execute: async ({ api, event, args, config, transferMode = false }) => {
    await ensureMentionsFromHistory(api, event);
    const { threadID, messageID, senderID, mentions, type, messageReply } = event;
    const stringThreadID = String(threadID);
    const stringSenderID = String(senderID);

    // Cooldown 5s
    const cooldown = checkCooldown({
      command: "tien",
      key: senderID,
      durationMs: 5000,
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
        if (mentions[uid]) return mentions[uid].replace("@", "");

        const apiName = await new Promise((resolve) => {
          api.getUserInfo(uid, (err, info) => {
            if (err || !info || !info[uid]) return resolve(null);
            resolve(info[uid].name);
          });
        });
        if (apiName) return apiName;

        try {
          const threadInfo = await getThreadInfoCached(api, threadID);
          const mem = threadInfo.userInfo.find((u) => u.id == uid);
          if (mem && mem.name) return mem.name;
        } catch (e) { }

        try {
          const [rows] = await connection.execute(
            "SELECT name FROM messenger_users WHERE thread_id = ? AND psid = ?",
            [stringThreadID, String(uid)],
          );
          if (
            rows.length > 0 &&
            rows[0].name &&
            rows[0].name !== "Thành viên mới"
          )
            return rows[0].name;
        } catch (e) { }

        return "Thành viên mới";
      };

      let senderName = await getName(senderID);

      // 3. CHECK & UPDATE DATABASE Cô lập theo Nhóm (thread_id, psid)
      const [userRows] = await connection.execute(
        "SELECT * FROM messenger_users WHERE thread_id = ? AND psid = ?",
        [stringThreadID, stringSenderID],
      );

      if (userRows.length === 0) {
        // Người mới ở Thế giới này -> Khởi tạo 10.000 xu
        await connection.execute(
          "INSERT INTO messenger_users (thread_id, psid, name, credits) VALUES (?, ?, ?, ?)",
          [stringThreadID, stringSenderID, senderName, 10000],
        );
        api.sendMessage(
          `🎉 Chào mừng ${senderName} đến với Thế Giới Nhóm!\n🎁 Khởi tạo: +10,000 xu.`,
          threadID,
        );
      } else {
        const dbName = userRows[0].name;
        if (
          senderName !== "Thành viên mới" &&
          (dbName === "Thành viên mới" || dbName !== senderName)
        ) {
          await connection.execute(
            "UPDATE messenger_users SET name = ? WHERE thread_id = ? AND psid = ?",
            [senderName, stringThreadID, stringSenderID],
          );
        } else if (
          senderName === "Thành viên mới" &&
          dbName !== "Thành viên mới"
        ) {
          senderName = dbName;
        }
      }

      // --- XỬ LÝ LỆNH ---
      const command = args[0]?.toLowerCase();

      // CHUYỂN TIỀN
      if (["chuyen", "pay", "give"].includes(command)) {
        const prefixStr = config?.prefix || "!";
        if (!transferMode) {
          return api.sendMessage(
            `⚠️ Lệnh chuyển tiền đã tách riêng. Dùng: ${prefixStr}chuyentien <số_tiền> (tag/reply/ID).`,
            threadID,
            messageID,
          );
        }

        let targetID = null;
        if (Object.keys(mentions).length > 0)
          targetID = Object.keys(mentions)[0];
        else if (type === "message_reply") targetID = messageReply.senderID;
        else if (args[2] && !isNaN(args[2])) targetID = args[2];

        if (!targetID)
          return api.sendMessage(
            "⚠️ Tag/Reply/ID người nhận.",
            threadID,
            messageID,
          );
        if (String(targetID) === stringSenderID)
          return api.sendMessage(
            "❌ Tự chuyển cho mình à?",
            threadID,
            messageID,
          );

        const stringTargetID = String(targetID);

        let amount = 0;
        for (let arg of args) {
          if (arg === targetID) continue;
          const parsed = parseMoneyAmount(arg);
          if (!isNaN(parsed) && parsed > 0) {
            amount = parsed;
            break;
          }
        }
        if (amount <= 0)
          return api.sendMessage("⚠️ Số tiền sai.", threadID, messageID);

        // Chặn chuyển tiền nếu đang trong tù ở nhóm này
        const [jailRows] = await connection.execute(
          "SELECT jail_until, reason FROM user_jail WHERE thread_id = ? AND psid = ? AND jail_until > datetime('now', 'localtime')",
          [stringThreadID, stringSenderID],
        );
        if (jailRows.length > 0) {
          return api.sendMessage(
            `🔒 Bạn đang trong tù, không thể chuyển tiền.\n⚠️ Lý do: ${jailRows[0].reason}`,
            threadID,
            messageID,
          );
        }

        // Chặn chuyển tiền nếu người nhận nợ quá hạn ở nhóm này
        const [targetLoanRows] = await connection.execute(
          "SELECT principal, taken_at, due_days FROM bank_loans WHERE thread_id = ? AND psid = ?",
          [stringThreadID, stringTargetID],
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
            return api.sendMessage(
              `❌ NGƯỜI NHẬN ĐANG NỢ TIỀN!\n━━━━━━━━━━━━━━━━━━\n👤 ${await getName(stringTargetID)}\n⚠️ Nợ quá hạn: ${daysOverdue} ngày\n🚫 Không thể chuyển tiền cho người đang nợ!`,
              threadID,
              messageID,
            );
          }
        }

        const targetName = await getName(stringTargetID);

        await connection.beginTransaction();
        try {
          const [sRows] = await connection.execute(
            "SELECT credits, games_played, vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?",
            [stringThreadID, stringSenderID],
          );
          const sBalance = parseInt(sRows[0]?.credits || 0);
          const taxAmount = Math.floor(amount * TRANSFER_TAX_RATE);
          const totalDebit = amount + taxAmount;
          if (sBalance < totalDebit) {
            await connection.rollback();
            return api.sendMessage(
              `💸 Thiếu tiền! Có: ${sBalance.toLocaleString('vi-VN')} | Cần: ${totalDebit.toLocaleString('vi-VN')} (gồm thuế 2%)`,
              threadID,
              messageID,
            );
          }

          let transferredToday = 0;
          let dailyLimit = 0;

          if (stringSenderID !== bossID) {
            const now = new Date();
            const hasVIP =
              sRows[0].vip_until && new Date(sRows[0].vip_until) > now;
            const gamesPlayed = parseInt(sRows[0]?.games_played || 0);

            const baseLimit = hasVIP ? 100000 : 50000;
            const bonusPerFiveGames = hasVIP ? 75000 : 50000;
            dailyLimit =
              baseLimit + Math.floor(gamesPlayed / 5) * bonusPerFiveGames;

            const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
            const todayStr = vnTime.toISOString().split("T")[0];

            const [limitRows] = await connection.execute(
              "SELECT * FROM transfer_limits WHERE psid = ?",
              [stringSenderID],
            );

            if (limitRows.length > 0) {
              const lastReset = new Date(limitRows[0].last_reset);
              const lastResetVN = new Date(
                lastReset.getTime() + 7 * 60 * 60 * 1000,
              );
              const lastResetStr = lastResetVN.toISOString().split("T")[0];

              if (lastResetStr === todayStr) {
                transferredToday = parseInt(
                  limitRows[0].transferred_today || 0,
                );
              } else {
                transferredToday = 0;
                await connection.execute(
                  "UPDATE transfer_limits SET transferred_today = 0, last_reset = ? WHERE psid = ?",
                  [now, stringSenderID],
                );
              }
            } else {
              await connection.execute(
                "INSERT INTO transfer_limits (psid, transferred_today, last_reset) VALUES (?, 0, ?)",
                [stringSenderID, now],
              );
            }

            if (transferredToday + amount > dailyLimit) {
              await connection.rollback();
              const remaining = dailyLimit - transferredToday;
              let msg = `⚠️ VƯỢT HẠN MỨC CHUYỂN TIỀN!\n`;
              msg += `💳 Hạn mức hôm nay: ${dailyLimit.toLocaleString('vi-VN')}\n`;
              msg += `📤 Đã chuyển: ${transferredToday.toLocaleString('vi-VN')}\n`;
              msg += `💰 Còn lại: ${remaining.toLocaleString('vi-VN')}\n\n`;
              msg += `💡 Chơi minigame (cược ≥50k) để tăng hạn mức!\n`;
              msg += `📊 Đã chơi: ${gamesPlayed} lần`;
              if (!hasVIP)
                msg += `\n👑 VIP: Gấp đôi hạn mức gốc + 1.5x tiền tăng!`;
              return api.sendMessage(msg, threadID, messageID);
            }
          }

          // Kiểm tra người nhận có TK ở nhóm này chưa
          let [tRows] = await connection.execute(
            "SELECT * FROM messenger_users WHERE thread_id = ? AND psid = ?",
            [stringThreadID, stringTargetID],
          );
          if (tRows.length === 0) {
            await connection.execute(
              "INSERT INTO messenger_users (thread_id, psid, name, credits) VALUES (?, ?, ?, 10000)",
              [stringThreadID, stringTargetID, targetName, 10000],
            );
          }

          await connection.execute(
            "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
            [totalDebit, stringThreadID, stringSenderID],
          );
          await connection.execute(
            "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
            [amount, stringThreadID, stringTargetID],
          );
          if (taxAmount > 0) {
            await connection.execute(
              "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
              [taxAmount, stringThreadID, bossID],
            );
          }

          if (stringSenderID !== bossID) {
            await connection.execute(
              "UPDATE transfer_limits SET transferred_today = transferred_today + ? WHERE psid = ?",
              [amount, stringSenderID],
            );
          }

          await connection.commit();

          try {
            recordAction(stringSenderID, "transfer", 1);
            recordAction(stringSenderID, "transfer_amount", amount);
          } catch (_) { }

          if (stringSenderID === bossID) {
            return api.sendMessage(
              `✅ GIAO DỊCH THÀNH CÔNG!\n📤 Gửi: ${senderName} 👑\n📥 Nhận: ${targetName}\n💰 Tiền chuyển: ${amount.toLocaleString('vi-VN')}\n🧾 Thuế chuyển (2%): ${taxAmount.toLocaleString('vi-VN')}\n💸 Tổng trừ: ${totalDebit.toLocaleString('vi-VN')}\n━━━━━━━━━━━━━━━━━━\n🔓 Không giới hạn (Boss)`,
              threadID,
              messageID,
            );
          } else {
            const newTransferred = transferredToday + amount;
            const remaining = dailyLimit - newTransferred;
            return api.sendMessage(
              `✅ GIAO DỊCH THÀNH CÔNG!\n📤 Gửi: ${senderName}\n📥 Nhận: ${targetName}\n💰 Tiền chuyển: ${amount.toLocaleString('vi-VN')}\n🧾 Thuế chuyển (2%): ${taxAmount.toLocaleString('vi-VN')}\n💸 Tổng trừ: ${totalDebit.toLocaleString('vi-VN')}\n━━━━━━━━━━━━━━━━━━\n💳 Hạn mức còn lại: ${remaining.toLocaleString('vi-VN')}/${dailyLimit.toLocaleString('vi-VN')}`,
              threadID,
              messageID,
            );
          }
        } catch (err) {
          console.error("❌ Lỗi trong transaction chuyen tien:", err);
          try {
            await connection.rollback();
          } catch (_) { }
          throw err;
        }
      }

      // KIỂM TRA HẠN MỨC
      else if (["hanmuc", "limit", "hm"].includes(command)) {
        if (stringSenderID === bossID) {
          return api.sendMessage(
            `👑 HẠN MỨC BOSS\n━━━━━━━━━━━━━━━━━━\n🔓 KHÔNG GIỚI HẠN\n━━━━━━━━━━━━━━━━━━\n💎 Boss có đặc quyền chuyển tiền không giới hạn`,
            threadID,
            messageID,
          );
        }

        const [userRows] = await connection.execute(
          "SELECT games_played, vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?",
          [stringThreadID, stringSenderID],
        );
        if (userRows.length === 0)
          return api.sendMessage(
            `❌ Bạn chưa có tài khoản ở nhóm này.\nDùng ${prefix}tien để đăng ký tài khoản.`,
            threadID,
            messageID,
          );

        const now = new Date();
        const hasVIP =
          userRows[0].vip_until && new Date(userRows[0].vip_until) > now;
        const gamesPlayed = parseInt(userRows[0].games_played || 0);

        const baseLimit = hasVIP ? 100000 : 50000;
        const bonusPerFiveGames = hasVIP ? 75000 : 50000;
        const dailyLimit =
          baseLimit + Math.floor(gamesPlayed / 5) * bonusPerFiveGames;

        const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
        const todayStr = vnTime.toISOString().split("T")[0];

        const [limitRows] = await connection.execute(
          "SELECT * FROM transfer_limits WHERE psid = ?",
          [stringSenderID],
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

        let msg = `💳 HẠN MỨC CHUYỂN TIỀN (THẾ GIỚI NÀY)\n`;
        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `📊 Hạn mức hôm nay: ${dailyLimit.toLocaleString('vi-VN')}\n`;
        msg += `📤 Đã chuyển: ${transferredToday.toLocaleString('vi-VN')}\n`;
        msg += `💰 Còn lại: ${remaining.toLocaleString('vi-VN')}\n`;
        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `🎮 Games đã chơi: ${gamesPlayed} lần\n`;
        msg += `📈 Mỗi 5 games: +${bonusPerFiveGames.toLocaleString('vi-VN')}\n`;
        msg += `⏭️ Còn ${gamesUntilNextBonus} games nữa -> +${bonusPerFiveGames.toLocaleString('vi-VN')}\n`;

        if (hasVIP) {
          const vipExpire = new Date(userRows[0].vip_until);
          const daysLeft = Math.ceil((vipExpire - now) / (1000 * 60 * 60 * 24));
          msg += `━━━━━━━━━━━━━━━━━━\n`;
          msg += `👑 VIP (Nhóm này): Đang hoạt động (${daysLeft} ngày)\n`;
        } else {
          msg += `━━━━━━━━━━━━━━━━━━\n`;
          msg += `💡 Mua VIP ở nhóm này để gấp đôi hạn mức!\n`;
        }

        return api.sendMessage(msg, threadID, messageID);
      }

      // XEM SỐ DƯ
      else {
        let viewID = stringSenderID;
        let viewName = senderName;

        if (Object.keys(mentions).length > 0) {
          viewID = String(Object.keys(mentions)[0]);
          viewName = await getName(viewID);
        } else if (type === "message_reply") {
          viewID = String(messageReply.senderID);
          viewName = await getName(viewID);
        }

        let [rows] = await connection.execute(
          "SELECT credits, name, vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?",
          [stringThreadID, viewID],
        );
        if (rows.length === 0) {
          if (viewID === stringSenderID) {
            await connection.execute(
              "INSERT INTO messenger_users (thread_id, psid, name, credits) VALUES (?, ?, ?, 10000)",
              [stringThreadID, stringSenderID, senderName],
            );
            [rows] = await connection.execute(
              "SELECT credits, name, vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?",
              [stringThreadID, stringSenderID],
            );
          } else {
            return api.sendMessage(
              `❌ ${viewName} chưa có tài khoản ở nhóm này.`,
              threadID,
              messageID,
            );
          }
        }

        const finalName =
          viewName !== "Thành viên mới" ? viewName : rows[0].name;

        let msg = `💰 TÀI KHOẢN (THẾ GIỚI NÀY): ${finalName}\n💳 Số dư: ${parseInt(rows[0].credits).toLocaleString('vi-VN')} xu`;
        if (rows[0].vip_until && new Date(rows[0].vip_until) > new Date()) {
          msg += `\n👑 Cấp độ: VIP (Nhóm này)`;
        }

        return api.sendMessage(msg, threadID, messageID);
      }
    } catch (e) {
      console.error("❌ Lỗi Database trong tien.js:", e);
      return api.sendMessage("❌ Lỗi Database.", threadID, messageID);
    } finally {
      if (connection) connection.release();
    }
  },
};
