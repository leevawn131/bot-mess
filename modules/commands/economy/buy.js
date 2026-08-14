const { execute, getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const prefix = process.env.BOT_PREFIX;

module.exports = {
  name: "buy",
  description: "Mua vật phẩm từ shop",
  usage: `\n${prefix}buy [item-key] <số_lượng> → Mua vật phẩm từ shop\n━━━━━━━━━━━━━\n📌 [item-key]: Mã vật phẩm (xem bằng ${prefix}shop)\n📌 <số_lượng>: Số lượng muốn mua (mặc định: 1)\n💡 Ví dụ: ${prefix}buy shield 2`,

  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;
    const prefix = config?.prefix || "!";
    const itemKey = args[0]?.toLowerCase();
    const quantityStr = args[1];

    if (!itemKey) {
      return api.sendMessage(
        `⚠️ Hãy nhập item key và số lượng.\nVí dụ: ${prefix}buy shield 2`,
        threadID,
        messageID,
      );
    }

    // Check cooldown (10s)
    const cooldown = checkCooldown({
      command: "buy",
      key: senderID,
      durationMs: 10000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi mua lại!`,
        threadID,
        messageID,
      );
    }

    let quantity = 1;
    if (quantityStr) {
      quantity = parseInt(quantityStr);
      if (isNaN(quantity) || quantity <= 0) {
        return api.sendMessage(
          "⚠️ Số lượng không hợp lệ!",
          threadID,
          messageID,
        );
      }
    }

    let connection;
    try {
      connection = await getConnection();

      // Check item tồn tại trong shop
      const [items] = await connection.execute(
        "SELECT * FROM shop_items WHERE item_key = ?",
        [itemKey],
      );

      if (items.length === 0) {
        return api.sendMessage(
          `❌ Item không tồn tại trong shop. Gọi ${prefix}shop để xem danh sách.`,
          threadID,
          messageID,
        );
      }

      const item = items[0];
      const totalPrice = item.price * quantity;

      // Check tiền của người chơi
      const [users] = await connection.execute(
        "SELECT credits, name FROM messenger_users WHERE thread_id = ? AND psid = ?",
        [String(threadID), senderID],
      );

      if (users.length === 0) {
        return api.sendMessage(
          `❌ Bạn chưa có tài khoản. Gọi ${prefix}diemdanh để tạo tài khoản.`,
          threadID,
          messageID,
        );
      }

      const user = users[0];

      if (user.credits < totalPrice) {
        return api.sendMessage(
          `💸 Không đủ tiền!\nGiá: ${totalPrice.toLocaleString('vi-VN')} xu\nBạn có: ${user.credits.toLocaleString('vi-VN')} xu`,
          threadID,
          messageID,
        );
      }

      await connection.beginTransaction();

      try {
        // Xử lý VIP riêng
        if (item.type === "vip") {
          // Trừ tiền
          await connection.execute(
            "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
            [totalPrice, String(threadID), senderID],
          );

          // Tính thời gian VIP
          const now = new Date();
          const [currentUser] = await connection.execute(
            "SELECT vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?",
            [String(threadID), senderID],
          );

          let vipUntil;
          if (
            currentUser[0].vip_until &&
            new Date(currentUser[0].vip_until) > now
          ) {
            // Nếu đang có VIP, cộng thêm
            vipUntil = new Date(currentUser[0].vip_until);
            vipUntil.setDate(vipUntil.getDate() + item.effect_value * quantity);
          } else {
            // Nếu hết VIP hoặc chưa có, tính từ bây giờ
            vipUntil = new Date();
            vipUntil.setDate(vipUntil.getDate() + item.effect_value * quantity);
          }

          await connection.execute(
            "UPDATE messenger_users SET vip_until = ? WHERE thread_id = ? AND psid = ?",
            [vipUntil, String(threadID), senderID],
          );

          await connection.commit();

          return api.sendMessage(
            `✅ MUA THÀNH CÔNG!\n${item.name} x${quantity}\n💰 Trừ: ${totalPrice.toLocaleString('vi-VN')} xu\n👑 VIP đến: ${vipUntil.toLocaleString("vi-VN")}\n💳 Còn lại: ${(user.credits - totalPrice).toLocaleString('vi-VN')} xu`,
            threadID,
            messageID,
          );
        }

        // Xử lý các item khác
        // Check item đã có trong inventory chưa (nếu stackable thì tăng uses_left)
        if (item.stackable) {
          const [existing] = await connection.execute(
            "SELECT * FROM user_inventory WHERE thread_id = ? AND psid = ? AND item_key = ?",
            [String(threadID), senderID, itemKey],
          );

          const totalUses = item.uses * quantity;
          if (existing.length > 0) {
            // Tăng uses_left
            await connection.execute(
              "UPDATE user_inventory SET uses_left = uses_left + ? WHERE thread_id = ? AND psid = ? AND item_key = ?",
              [totalUses, String(threadID), senderID, itemKey],
            );
          } else {
            // Thêm mới
            await connection.execute(
              "INSERT INTO user_inventory (thread_id, psid, item_key, uses_left) VALUES (?, ?, ?, ?)",
              [String(threadID), senderID, itemKey, totalUses],
            );
          }
        } else {
          // Không stackable, thêm mới từng cái
          for (let i = 0; i < quantity; i++) {
            await connection.execute(
              "INSERT INTO user_inventory (thread_id, psid, item_key, uses_left) VALUES (?, ?, ?, ?)",
              [String(threadID), senderID, itemKey, item.uses],
            );
          }
        }

        // Trừ tiền
        await connection.execute(
          "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
          [totalPrice, String(threadID), senderID],
        );

        await connection.commit();

        return api.sendMessage(
          `✅ MUA THÀNH CÔNG!\n${item.name} x${quantity}\n💰 Trừ: ${totalPrice.toLocaleString('vi-VN')} xu\n📦 Tổng lượng: ${item.uses * quantity}\n💳 Còn lại: ${(user.credits - totalPrice).toLocaleString('vi-VN')} xu\nDùng ${prefix}inv để kiểm tra.`,
          threadID,
          messageID,
        );
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      }
    } catch (e) {
      console.error(e);
      return api.sendMessage("❌ Lỗi khi mua item.", threadID, messageID);
    } finally {
      if (connection) connection.release();
    }
  },
};
