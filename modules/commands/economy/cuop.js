const { execute, getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const { syncBankPool } = require("../../utils/bankPool");
const { consumeEnergy } = require("../../utils/energySystem");
const { ensureMentionsFromHistory } = require("../../utils/mentionResolver");
const prefix = process.env.BOT_PREFIX;

const ROB_TAX_RATE = 0.08;

// ID CỦA BOSS (Hưởng lợi từ tiền phạt)
const BOSS_ID = "100037351338722";

module.exports = {
  name: "cuop",
  description: "Cướp tiền người khác hoặc ngân hàng",
  usage: `\n${prefix}cuop @tag → Cướp tiền người được tag\n${prefix}cuop (reply) → Cướp tiền người được reply\n${prefix}cuop nganhang → Cướp ngân hàng (rủi ro cao)\n━━━━━━━━━━━━━━━━━━\n⚠️ Thất bại sẽ bị phạt tiền + có thể vào tù\n💰 Thuế cướp: 8%\n⚡ Tốn 20 thể lực mỗi lần dùng`,

  execute: async ({ api, event, config, args }) => {
    await ensureMentionsFromHistory(api, event);
    const { threadID, senderID, mentions, messageID, messageReply, body } =
      event;

    const rawArgs =
      Array.isArray(args) && args.length
        ? args
        : body
          ? body.trim().split(/\s+/).slice(1)
          : [];
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
        return api.sendMessage(
          "❌ Bạn muốn cướp ai? Hãy Tag hoặc Reply tin nhắn người đó!",
          threadID,
          messageID,
        );
      }

      if (targetID === senderID)
        return api.sendMessage(
          "❌ Bị điên à mà tự cướp chính mình?",
          threadID,
          messageID,
        );
    }

    // 2. CHECK COOLDOWN (180s = 3 phút)
    const cooldown = checkCooldown({
      command: "cuop",
      key: senderID,
      durationMs: 180000,
    });
    if (!cooldown.allowed) {
      const minutes = Math.ceil(cooldown.timeLeft / 60);
      return api.sendMessage(
        `👮 Đang bị truy nã! Hãy trốn kỹ ${cooldown.timeLeft} giây nữa (khoảng ${minutes} phút) mới được đi cướp tiếp.`,
        threadID,
        messageID,
      );
    }

    let connection;
    try {
      connection = await getConnection();

      const energyUse = await consumeEnergy(connection, String(threadID), senderID, 20);
      if (!energyUse.ok) {
        if (energyUse.reason === "not_enough") {
          return api.sendMessage(energyUse.message, threadID, messageID);
        }
        return api.sendMessage(
          "❌ Không thể kiểm tra thể lực lúc này.",
          threadID,
          messageID,
        );
      }

      // Check tù
      const jailRows = await execute(
        "SELECT jail_until, reason FROM user_jail WHERE thread_id = ? AND psid = ? AND jail_until > datetime('now', 'localtime')",
        [String(threadID), senderID],
      );

      if (jailRows.length > 0) {
        const remainingMs = new Date(jailRows[0].jail_until) - new Date();
        const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
        return api.sendMessage(
          `🔒 BẠN ĐANG TRONG TÙ!\n━━━━━━━━━━━━━━━━━━\n⏰ Còn lại: ${remainingHours} giờ\n⚠️ Lý do: ${jailRows[0].reason}\n❌ Không thể cướp`,
          threadID,
          messageID,
        );
      }

      // --- CƯỚP NGÂN HÀNG ---
      if (isBankRob) {
        const [senderRows] = await connection.execute(
          "SELECT credits, name FROM messenger_users WHERE thread_id = ? AND psid = ?",
          [String(threadID), senderID],
        );
        if (senderRows.length === 0) {
          return api.sendMessage(
            "❌ Bạn chưa có tài khoản.",
            threadID,
            messageID,
          );
        }

        const senderName = senderRows[0].name || "Thành viên";
        const senderCredits = parseInt(senderRows[0].credits) || 0;

        // Kiểm tra credits tối thiểu để cướp ngân hàng
        if (senderCredits < 10000) {
          return api.sendMessage(
            "❌ Bạn cần ít nhất 10,000 credits để cướp ngân hàng!",
            threadID,
            messageID,
          );
        }

        await syncBankPool(connection);

        const poolRows = await execute(
          "SELECT total_balance FROM bank_pool WHERE id = 1",
        );
        const poolBalance = parseInt(poolRows[0]?.total_balance) || 0;

        if (poolBalance <= 0) {
          return api.sendMessage(
            "🏦 Ngân hàng đang trống. Không thể cướp!",
            threadID,
            messageID,
          );
        }

        let winRate = 0.19;
        if (senderID === BOSS_ID) winRate = 1.0;

        const isSuccess = Math.random() < winRate;
        const now = new Date();

        if (isSuccess) {
          const percent = Math.floor(Math.random() * 11) + 5; // 5-15%
          const stealAmount = Math.min(
            Math.floor((poolBalance * percent) / 100),
            poolBalance,
          );
          let totalStolen = 0;

          // Lấy danh sách tất cả users có tài khoản ngân hàng
          const [bankUsers] = await connection.execute(
            "SELECT psid, balance FROM bank_accounts WHERE thread_id = ? AND balance > 0",
            [String(threadID)]
          );

          await connection.beginTransaction();
          try {
            // Chia đều số tiền bị cướp cho tất cả users có tiền trong ngân hàng
            if (bankUsers.length > 0) {
              const sharePerUser = Math.floor(stealAmount / bankUsers.length);

              for (const user of bankUsers) {
                const deductAmount = Math.min(sharePerUser, user.balance);
                await connection.execute(
                  "UPDATE bank_accounts SET balance = balance - ? WHERE thread_id = ? AND psid = ?",
                  [deductAmount, String(threadID), user.psid],
                );
                totalStolen += deductAmount; // Cộng dồn số tiền thực tế bị trừ
              }
            }

            // Đồng bộ pool theo tổng thực tế
            await syncBankPool(connection);

            const taxAmount = Math.floor(totalStolen * ROB_TAX_RATE);
            const finalGain = Math.max(0, totalStolen - taxAmount);

            // Thêm tiền cho kẻ cướp với số tiền THỰC TẾ
            await connection.execute(
              "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
              [finalGain, String(threadID), senderID],
            );

            if (taxAmount > 0 && senderID !== BOSS_ID) {
              await connection.execute(
                "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
                [taxAmount, String(threadID), BOSS_ID],
              );
            }

            await connection.commit();
          } catch (err) {
            await connection.rollback();
            throw err;
          }

          const taxAmount = Math.floor(totalStolen * ROB_TAX_RATE);
          const finalGain = Math.max(0, totalStolen - taxAmount);

          api.sendMessage(
            `🏦 **CƯỚP NGÂN HÀNG THÀNH CÔNG!**\n👤 ${senderName}\n💰 Lấy được: ${totalStolen.toLocaleString('vi-VN')}\n🧾 Thuế cướp (8%): ${taxAmount.toLocaleString('vi-VN')}\n✅ Thực nhận: ${finalGain.toLocaleString('vi-VN')}\n⚡ Thể lực: ${energyUse.energy}/${energyUse.maxEnergy} (trừ 20)\n🔥 Thoát khỏi truy nã... tạm thời!`,
            threadID,
            messageID,
          );
        } else {
          const fine = 100000; // 100k fixed penalty
          const jailUntil = new Date(now.getTime() + 1 * 60 * 60 * 1000);

          await execute(
            "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
            [fine, String(threadID), senderID],
          );
          await execute(
            "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
            [fine, String(threadID), BOSS_ID],
          );

          await execute(
            "INSERT INTO user_jail (thread_id, psid, jail_until, reason) VALUES (?, ?, ?, ?) ON CONFLICT(thread_id, psid) DO UPDATE SET jail_until = excluded.jail_until, reason = excluded.reason",
            [
              String(threadID),
              senderID,
              jailUntil,
              "Cướp ngân hàng",
            ],
          );

          api.sendMessage(
            `🚔 **CƯỚP NGÂN HÀNG THẤT BẠI!**\n👮 Bạn bị bắt và vào tù 1h.\n💸 Tiền phạt: 100,000 credits\n⚡ Thể lực: ${energyUse.energy}/${energyUse.maxEnergy} (trừ 20)`,
            threadID,
            messageID,
          );
        }

        return;
      }

      // 3. Lấy thông tin tài chính + Tên của 2 người + VIP status
      const [rows] = await connection.execute(
        "SELECT psid, credits, name, vip_until FROM messenger_users WHERE thread_id = ? AND psid IN (?, ?)",
        [String(threadID), senderID, targetID],
      );

      const senderData = rows.find((r) => r.psid == senderID);
      const targetData = rows.find((r) => r.psid == targetID);

      // Check VIP cua nguoi bi cuop
      const now = new Date();
      const targetHasVIP =
        targetData?.vip_until && new Date(targetData.vip_until) > now;

      // Check shield protection cho nguoi bi cuop
      const shieldCheck = await execute(
        'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "protect_rob" AND uses_left > 0',
        [targetID],
      );
      const hasShield = shieldCheck.length > 0;

      // Xử lý tên nạn nhân
      let targetName = targetData ? targetData.name : "Nạn nhân";
      if (!targetData) {
        if (global.data?.userName?.has(String(targetID))) {
          targetName = global.data.userName.get(String(targetID));
        } else {
          try {
            const rows = await execute("SELECT name FROM messenger_users WHERE psid = ? AND name != 'Người dùng' AND name != '' LIMIT 1", [String(targetID)]);
            if (rows && rows[0] && rows[0].name) {
              targetName = rows[0].name;
              if (global.data?.userName) global.data.userName.set(String(targetID), targetName);
            } else {
              const userInfo = await api.getUserInfo(targetID);
              if (userInfo && userInfo[targetID]?.name) {
                targetName = userInfo[targetID].name;
                if (global.data?.userName) global.data.userName.set(String(targetID), targetName);
              }
            }
          } catch (e) { }
        }
      }

      // Kiểm tra điều kiện cướp
      if (!senderData || senderData.credits < 1000) {
        return api.sendMessage(
          "❌ Bạn cần ít nhất 1,000 credits để làm vốn mua súng đi cướp!",
          threadID,
          messageID,
        );
      }
      if (!targetData || targetData.credits < 1000) {
        return api.sendMessage(
          `❌ ${targetName} quá nghèo (dưới 1k), cướp không bõ công!`,
          threadID,
          messageID,
        );
      }

      const isBossRobber = String(senderID) === String(BOSS_ID);

      // 4. TÍNH TOÁN TỈ LỆ
      let winRate = 0.3; // Mặc định 30% thắng
      let fine = 0; // Tiền phạt nếu thua
      let stealAmount = 0;

      // --- ĐẶC QUYỀN BOSS ---
      // Nếu Boss đi cướp: Tỉ lệ thắng 100%
      if (isBossRobber) winRate = 1.0;

      // Nếu ai đó cướp Boss: Tỉ lệ thắng 0% (Luôn thua)
      if (targetID === BOSS_ID && !isBossRobber) winRate = 0;

      // --- SHIELD EFFECT ---
      // Giam ti le thanh cong khi cuop nguoi co shield
      if (hasShield && !isBossRobber) {
        const shieldPower = shieldCheck[0].effect_value / 100; // VD: 50 -> 0.5
        winRate = winRate * (1 - shieldPower);
      }

      // --- QUAY SỐ ---
      const isSuccess = isBossRobber ? true : Math.random() < winRate;

      if (isSuccess) {
        // CƯỚP THÀNH CÔNG (Lấy 10% - 20% tiền nạn nhân)
        const percent = Math.floor(Math.random() * 11) + 10; // 10-20%
        stealAmount = Math.floor((targetData.credits * percent) / 100);

        // VIP giam 5% tien bi cuop (boss bo qua VIP)
        if (targetHasVIP && !isBossRobber) {
          stealAmount = Math.floor(stealAmount * 0.95);
        }

        const taxAmount = Math.floor(stealAmount * ROB_TAX_RATE);
        const finalGain = Math.max(0, stealAmount - taxAmount);

        await connection.execute(
          "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
          [finalGain, String(threadID), senderID],
        );
        await connection.execute(
          "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
          [stealAmount, String(threadID), targetID],
        );

        if (taxAmount > 0 && senderID !== BOSS_ID) {
          await connection.execute(
            "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
            [taxAmount, String(threadID), BOSS_ID],
          );
        }

        // Tru luot dung shield neu co (boss bo qua shield)
        if (hasShield && !isBossRobber) {
          await connection.execute(
            'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "protect_rob"',
            [targetID],
          );
          await connection.execute(
            "DELETE FROM active_effects WHERE uses_left <= 0",
          );
        }

        let msg = `🔫 **CƯỚP THÀNH CÔNG!**\nBạn đã trấn lột ${stealAmount.toLocaleString('vi-VN')} credits từ ${targetName}.\n🧾 Thuế cướp (8%): ${taxAmount.toLocaleString('vi-VN')}\n✅ Thực nhận: ${finalGain.toLocaleString('vi-VN')}\n⚡ Thể lực: ${energyUse.energy}/${energyUse.maxEnergy} (trừ 20)\n(Nạn nhân khóc thét 😭)`;
        if (hasShield && !isBossRobber)
          msg += `\n🛡️ Khien bao ve da giam sat thuong!`;
        if (targetHasVIP && !isBossRobber)
          msg += `\n👑 VIP da giam 5% tien mat!`;

        api.sendMessage(msg, threadID, messageID);
      } else {
        // CƯỚP THẤT BẠI (Bị phạt tiền -> Chuyển về BOSS)
        fine = 2000; // Phạt mặc định
        if (targetID === BOSS_ID) fine = 10000; // Cướp Boss phạt nặng hơn

        // Trừ tiền thằng đi cướp
        await execute(
          "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
          [fine, String(threadID), senderID],
        );

        // Cộng tiền phạt vào ví BOSS (Nếu Boss không phải là người đi cướp)
        if (senderID !== BOSS_ID) {
          await execute(
            "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
            [fine, String(threadID), BOSS_ID],
          );
        }

        // Vào tù 3 phút
        const jailUntil = new Date(Date.now() + 3 * 60 * 1000);
        await execute(
          "INSERT INTO user_jail (thread_id, psid, jail_until, reason) VALUES (?, ?, ?, ?) ON CONFLICT(thread_id, psid) DO UPDATE SET jail_until = excluded.jail_until, reason = excluded.reason",
          [String(threadID), senderID, jailUntil, "Cướp fail"],
        );

        api.sendMessage(
          `👮 **BỊ BẮT RỒI CON ƠI!**\nCướp ${targetName} bất thành, bạn bị Công An phạt ${fine.toLocaleString('vi-VN')} credits.\n⚡ Thể lực: ${energyUse.energy}/${energyUse.maxEnergy} (trừ 20)\n🔒 Bạn bị giam 3 phút.\n(Tiền phạt đã được nộp vào kho bạc của Boss 🐧)`,
          threadID,
          messageID,
        );
      }
    } catch (e) {
      console.error(e);
      api.sendMessage(`❌ Mày chưa có tài khoản mà đòi cướp à.\nDùng /tien mà tạo tài khoản.`, threadID, messageID);
    } finally {
      if (connection) connection.release();
    }
  },
};
