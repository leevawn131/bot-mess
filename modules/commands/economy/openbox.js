const { execute, getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");

const ITEM_NAMES = {
  lucky: "Bùa may",
  khien: "Khiên chống cướp",
  "30eng": "Nước tăng lực nhỏ",
  gangtay: "Găng tay",
  bh: "Bảo hiểm"
};

// Helper để random phần thưởng cho 1 hộp bí ẩn
function generateReward() {
  const rand = Math.random();

  if (rand < 0.80) {
    // 80%: Xu thường (7,000 - 15,000 xu)
    const val = Math.floor(Math.random() * (15000 - 7000 + 1)) + 7000;
    return { type: "credits", value: val, msg: `💰 +${val.toLocaleString('vi-VN')} xu` };
  } else if (rand < 0.94) {
    // 14%: Xu vừa (20,000 - 45,000 xu)
    const val = Math.floor(Math.random() * (45000 - 20000 + 1)) + 20000;
    return { type: "credits", value: val, msg: `💰 +${val.toLocaleString('vi-VN')} xu` };
  } else if (rand < 0.98) {
    // 4%: Xu lớn (50,000 - 100,000 xu)
    const val = Math.floor(Math.random() * (100000 - 50000 + 1)) + 50000;
    return { type: "credits", value: val, msg: `🎁 +${val.toLocaleString('vi-VN')} xu` };
  } else if (rand < 0.995) {
    // 1.5%: Vật phẩm ngẫu nhiên
    const itemRand = Math.random();
    let itemKey = "lucky";
    let uses = 1;
    if (itemRand < 0.4) {
      itemKey = "lucky";
    } else if (itemRand < 0.7) {
      itemKey = "khien";
    } else {
      itemKey = "30eng";
    }
    const itemName = ITEM_NAMES[itemKey] || itemKey;
    return { type: "item", itemKey, uses, msg: `🧰 1x ${itemName}` };
  } else {
    // 0.5%: Hũ xu thần tài (200,000 - 350,000 xu)
    const val = Math.floor(Math.random() * (350000 - 200000 + 1)) + 200000;
    return { type: "credits", value: val, msg: `🎉 NỔ HŨ +${val.toLocaleString('vi-VN')} xu` };
  }
}

module.exports = {
  name: "openbox",
  description: "Mở hộp bí ẩn mở ra xu và vật phẩm hiếm",
  usage: `\n!openbox → Mở 1 hộp bí ẩn\n!openbox [số_lượng] → Mở nhiều hộp cùng lúc\n!openbox all → Mở toàn bộ hộp đang có`,

  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;
    const prefix = config?.prefix || "!";

    // Check cooldown (3s)
    const cooldown = checkCooldown({
      command: "openbox",
      key: senderID,
      durationMs: 3000
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi mở lại hộp bí ẩn!`,
        threadID,
        messageID
      );
    }

    let connection;
    try {
      connection = await getConnection();

      // Lấy danh sách hộp bí ẩn còn lại của người dùng
      const [boxes] = await connection.execute(
        `SELECT id, uses_left FROM user_inventory WHERE thread_id = ? AND psid = ? AND item_key = 'box' AND uses_left > 0 ORDER BY id ASC`,
        [String(threadID), senderID]
      );

      const totalAvailable = boxes.reduce((acc, b) => acc + Number(b.uses_left || 0), 0);

      if (totalAvailable === 0) {
        return api.sendMessage(
          `❌ Bạn không có hộp bí ẩn nào trong túi đồ!\n👉 Dùng lệnh ${prefix}shop để mua (20,000 xu/hộp).`,
          threadID,
          messageID
        );
      }

      let countToOpen = 1;

      if (args[0]) {
        const arg = String(args[0]).toLowerCase();
        if (arg === "all") {
          countToOpen = totalAvailable;
        } else {
          const num = parseInt(arg, 10);
          if (isNaN(num) || num <= 0) {
            return api.sendMessage(
              `⚠️ Số lượng mở không hợp lệ!\nCách dùng: ${prefix}openbox [số] hoặc ${prefix}openbox all`,
              threadID,
              messageID
            );
          }
          if (num > totalAvailable) {
            return api.sendMessage(
              `❌ Bạn chỉ đang có ${totalAvailable} hộp bí ẩn. Không đủ để mở ${num} hộp!`,
              threadID,
              messageID
            );
          }
          countToOpen = num;
        }
      }

      await connection.beginTransaction();

      try {
        // Trừ bớt số lượng hộp trong user_inventory
        let remainingDeduct = countToOpen;
        for (const boxRow of boxes) {
          if (remainingDeduct <= 0) break;

          const rowUses = Number(boxRow.uses_left || 0);
          if (rowUses <= remainingDeduct) {
            await connection.execute(`DELETE FROM user_inventory WHERE id = ?`, [boxRow.id]);
            remainingDeduct -= rowUses;
          } else {
            const newUses = rowUses - remainingDeduct;
            await connection.execute(`UPDATE user_inventory SET uses_left = ? WHERE id = ?`, [newUses, boxRow.id]);
            remainingDeduct = 0;
          }
        }

        // Random phần thưởng cho từng hộp
        let totalCredits = 0;
        const itemRewards = {};
        const rewardDetails = [];

        for (let i = 0; i < countToOpen; i++) {
          const reward = generateReward();
          rewardDetails.push(reward.msg);

          if (reward.type === "credits") {
            totalCredits += reward.value;
          } else if (reward.type === "item") {
            itemRewards[reward.itemKey] = (itemRewards[reward.itemKey] || 0) + (reward.uses || 1);
          }
        }

        // Cập nhật xu cho người dùng
        if (totalCredits > 0) {
          const [userExist] = await connection.execute(
            `SELECT credits FROM messenger_users WHERE thread_id = ? AND psid = ?`,
            [String(threadID), senderID]
          );

          if (userExist.length > 0) {
            await connection.execute(
              `UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?`,
              [totalCredits, String(threadID), senderID]
            );
          } else {
            const userName = (global.data && global.data.userName && global.data.userName.get(senderID)) || "Người dùng";
            await connection.execute(
              `INSERT INTO messenger_users (thread_id, psid, name, credits) VALUES (?, ?, ?, ?)`,
              [String(threadID), senderID, userName, 10000 + totalCredits]
            );
          }
        }

        // Cập nhật vật phẩm trúng thưởng vào user_inventory
        for (const [itemKey, addUses] of Object.entries(itemRewards)) {
          const [existing] = await connection.execute(
            `SELECT id FROM user_inventory WHERE thread_id = ? AND psid = ? AND item_key = ?`,
            [String(threadID), senderID, itemKey]
          );

          if (existing.length > 0) {
            await connection.execute(
              `UPDATE user_inventory SET uses_left = uses_left + ? WHERE thread_id = ? AND psid = ? AND item_key = ?`,
              [addUses, String(threadID), senderID, itemKey]
            );
          } else {
            await connection.execute(
              `INSERT INTO user_inventory (thread_id, psid, item_key, uses_left) VALUES (?, ?, ?, ?)`,
              [String(threadID), senderID, itemKey, addUses]
            );
          }
        }

        await connection.commit();

        // Chuẩn bị tin nhắn báo kết quả
        let msg = `📦 MỞ THÀNH CÔNG ${countToOpen} HỘP BÍ ẨN\n━━━━━━━━━━━━━\n`;

        if (countToOpen === 1) {
          msg += `\n✨ Phần thưởng bạn nhận được:\n${rewardDetails[0]}\n`;
        } else {
          msg += `\n💰 Tổng xu nhận được: +${totalCredits.toLocaleString('vi-VN')} xu\n`;
          if (Object.keys(itemRewards).length > 0) {
            msg += `🧰 Vật phẩm trúng thưởng:\n`;
            for (const [k, v] of Object.entries(itemRewards)) {
              msg += `  • ${ITEM_NAMES[k] || k}: x${v}\n`;
            }
          }
          msg += `\n📜 Chi tiết 10 hộp đầu tiên:\n`;
          msg += rewardDetails.slice(0, 10).map((r, idx) => `${idx + 1}. ${r}`).join("\n");
          if (rewardDetails.length > 10) {
            msg += `\n... và ${rewardDetails.length - 10} phần thưởng khác`;
          }
        }

        msg += `\n\n🎊 Chúc mừng bạn! Dùng ${prefix}inv để xem túi đồ.`;

        return api.sendMessage(msg, threadID, messageID);
      } catch (err) {
        await connection.rollback();
        throw err;
      }
    } catch (e) {
      console.error("❌ Lỗi openbox:", e);
      return api.sendMessage("❌ Có lỗi xảy ra khi mở hộp bí ẩn. Vui lòng thử lại sau!", threadID, messageID);
    } finally {
      if (connection) connection.release();
    }
  }
};
