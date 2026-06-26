const { execute, executeTransaction, getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const { recordAction } = require("../../utils/questSystem");
const { consumeEnergy } = require("../../utils/energySystem");
const prefix = process.env.BOT_PREFIX;

module.exports = {
  name: "lamviec",
  description: "Làm việc kiếm tiền",
  usage: `\n${prefix}lamviec → Làm việc kiếm xu (nghề ngẫu nhiên)\n━━━━━━━━━━━━━\n💼 Mỗi lần làm nhận xu ngẫu nhiên theo nghề\n⚡ Tốn năng lượng mỗi lần làm\n🎰 Có cơ hội thưởng tăng ca x2\n⏳ Cooldown: 60 giây`,
  execute: async ({ api, event, config }) => {
    const { threadID, messageID, senderID } = event;

    // 1. CHECK COOLDOWN (60 giây)
    const cooldown = checkCooldown({
      command: "lamviec",
      key: senderID,
      durationMs: 60000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Nghỉ mệt đi đại ca! Chờ ${cooldown.timeLeft}s nữa hãy làm tiếp.`,
        threadID,
        messageID,
      );
    }

    try {
      // Check tài khoản
      const rows = await execute(
        "SELECT credits, vip_until FROM messenger_users WHERE psid = ?",
        [senderID],
      );
      if (rows.length === 0) {
        const prefix = config?.prefix || "!";
        return api.sendMessage(
          `❌ Bạn chưa có tài khoản.\nGõ ${prefix}tien tạo trước đã.`,
          threadID,
          messageID,
        );
      }

      let connection;
      let energyUse;
      try {
        connection = await getConnection();
        energyUse = await consumeEnergy(connection, senderID, 15);
      } catch (err) {
        console.error(err);
        return api.sendMessage("❌ Không thể kiểm tra thể lực lúc này.", threadID, messageID);
      } finally {
        if (connection) connection.release();
      }

      if (!energyUse.ok) {
        if (energyUse.reason === "not_enough") {
          return api.sendMessage(energyUse.message, threadID, messageID);
        }
        return api.sendMessage(
          "❌ Không thể trừ thể lực lúc này.",
          threadID,
          messageID,
        );
      }

      const currentBalance = parseInt(rows[0].credits);

      // Check VIP status
      const now = new Date();
      const hasVIP = rows[0].vip_until && new Date(rows[0].vip_until) > now;

      // Check work_glove effect
      const workGlove = await execute(
        'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "work_bonus" AND uses_left > 0',
        [senderID],
      );
      const hasWorkGlove = workGlove.length > 0;

      // 3. TÍNH TOÁN (LÀM ĐƯỢC HAY FAIL)
      // Tỷ lệ fail: 20% (Random < 0.2)
      let failRate = 0.2;

      // VIP giảm 10% xui (20% -> 10%)
      if (hasVIP) {
        failRate = 0.1;
      }

      const isFail = Math.random() < failRate;

      if (isFail) {
        // --- TRƯỜNG HỢP FAIL (MẤT TIỀN) ---
        const fines = [
          "đi bán vé số bị giật mất tập vé",
          "làm bồi bàn lỡ tay làm vỡ chồng bát đĩa",
          "đi chạy Grab vượt đèn đỏ bị công an bắt",
          "làm bảo vệ ngủ gật bị trộm dắt mất chiếc xe đạp",
          "đi ship hàng bị khách bom hàng",
          "ngồi code thuê lỡ tay xóa nhầm database khách hàng",
          "đi phụ hồ làm rơi viên gạch trúng chân cai thầu",
          "đi phát tờ rơi xả rác bừa bãi bị dân phòng phạt",
          "đang đi làm thì bị người yêu cũ trấn lột",
          "đi giao trà sữa bị đổ nguyên đơn, phải đền cả bill",
          "đi phụ bếp cắt nhầm bao tay của bếp trưởng nên bị phạt",
          "đi trực kho ngủ quên để chuột cắn rách thùng hàng",
          "đi chạy bàn bưng nhầm món cho bàn VIP bị bắt đền",
          "đi cài Win dạo quên backup, khách bắt bồi thường",
          "đi phát livestream bán hàng lỡ mồm nói sai giá rồi phải bù",
          "đi làm bảo trì quên khóa van nước làm ngập sàn",
          "đi sửa điện thoại lỡ tay làm nứt màn hình khách",
          "đi trông xe sơ suất để mất vé giữ xe của khách",
          "đi dọn kho lỡ làm rơi thùng hàng mới nhập",
        ];
        const reason = fines[Math.floor(Math.random() * fines.length)];
        // Phạt từ 10k đến 50k
        const rawLostMoney =
          Math.floor(Math.random() * (50000 - 10000 + 1)) + 10000;
        // Tránh âm tiền khi người chơi đang ít vốn
        const lostMoney = Math.min(rawLostMoney, currentBalance);

        // Trừ tiền
        await execute(
          "UPDATE messenger_users SET credits = credits - ? WHERE psid = ?",
          [lostMoney, senderID],
        );

        try {
          recordAction(senderID, "work", 1);
        } catch (_) {}

        return api.sendMessage(
          `⚠️ XUI XẺO!\nBạn ${reason}.\n💸 Bị trừ: -${lostMoney.toLocaleString()} credits.\n⚡ Thể lực: -15 (${energyUse.energy}/${energyUse.maxEnergy})\n😭 Số dư còn: ${(currentBalance - lostMoney).toLocaleString()}`,
          threadID,
          messageID,
        );
      } else {
        // --- TRƯỜNG HỢP THÀNH CÔNG (NHẬN TIỀN) ---
        const jobs = [
          "đi bán vé số dạo",
          "làm phụ hồ",
          "chạy GrabBike",
          "đi bưng bê",
          "ngồi code dạo",
          "nhặt ve chai",
          "trông xe",
          "phát tờ rơi",
          "bán trà đá",
          "đi đòi nợ thuê",
          "làm shipper",
          "cọ toilet",
          "hát rong",
          "bán kem trộn",
          "cài Win dạo",
          "thông cống",
          "làm nhân viên kho",
          "phụ quán cà phê",
          "giao nước bình",
          "đứng quầy tiện lợi",
          "chạy bàn quán lẩu",
          "đóng gói hàng online",
        ];
        const jobName = jobs[Math.floor(Math.random() * jobs.length)];

        // Lương: 10k -> 100k
        let salary = Math.floor(Math.random() * (100000 - 10000 + 1)) + 10000;

        // Work glove bonus +50%
        if (hasWorkGlove) {
          const bonusPercent = workGlove[0].effect_value / 100;
          salary = Math.floor(salary * (1 + bonusPercent));
        }

        // VIP bonus +50%
        if (hasVIP) {
          salary = Math.floor(salary * 1.5);
        }

        // Thưởng tăng ca nhỏ: 12% nhận thêm 20%~50% lương
        let overtimeBonus = 0;
        const gotOvertime = Math.random() < 0.12;
        if (gotOvertime) {
          const overtimeRate = Math.random() * (0.5 - 0.2) + 0.2;
          overtimeBonus = Math.floor(salary * overtimeRate);
          salary += overtimeBonus;
        }

        // Build transaction queries
        const queries = [];
        if (hasWorkGlove) {
          queries.push({
            query: 'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "work_bonus"',
            params: [senderID],
          });
          queries.push({
            query: "DELETE FROM active_effects WHERE uses_left <= 0",
            params: [],
          });
        }

        // Cộng tiền
        queries.push({
          query: "UPDATE messenger_users SET credits = credits + ? WHERE psid = ?",
          params: [salary, senderID],
        });

        await executeTransaction(queries);

        try {
          recordAction(senderID, "work", 1);
          recordAction(senderID, "work_earn", salary);
        } catch (_) {}

        let msg = `🛠️ THÀNH CÔNG!\nBạn đã ${jobName} chăm chỉ.\n💰 Nhận lương: +${salary.toLocaleString()} credits\n`;
        if (hasWorkGlove)
          msg += `🧤 Găng tay: +${workGlove[0].effect_value}%!\n`;
        if (hasVIP) msg += `👑 VIP: +50%!\n`;
        if (overtimeBonus > 0)
          msg += `🔥 Tăng ca: +${overtimeBonus.toLocaleString()} credits!\n`;
        msg += `⚡ Thể lực: -15 (${energyUse.energy}/${energyUse.maxEnergy})\n`;
        msg += `💳 Số dư mới: ${(currentBalance + salary).toLocaleString()}`;

        return api.sendMessage(msg, threadID, messageID);
      }
    } catch (e) {
      console.error(e);
      return api.sendMessage("❌ Lỗi Database.", threadID, messageID);
    }
  },
};
