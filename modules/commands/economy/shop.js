const { execute, getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const prefix = process.env.BOT_PREFIX;

async function sendShopPage(api, threadID, senderID, page) {
  try {
    const items = await execute("SELECT * FROM shop_items ORDER BY price ASC");

    if (items.length === 0) {
      return api.sendMessage("❌ Shop hiện đang trống.", threadID);
    }

    const itemsPerPage = 5;
    const totalPages = Math.ceil(items.length / itemsPerPage);

    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const startIndex = (page - 1) * itemsPerPage;
    const pageItems = items.slice(startIndex, startIndex + itemsPerPage);

    let msg = `🏪 SHOP VẬT PHẨM [Trang ${page}/${totalPages}]\n━━━━━━━━━━━━━\n\n`;

    pageItems.forEach((item, index) => {
      const displayIndex = startIndex + index + 1;
      msg += `${displayIndex}. ${item.name}\n`;
      msg += `   Key: ${item.item_key}\n`;
      msg += `   Giá: ${item.price.toLocaleString()} xu\n`;
      msg += `   Mô tả: ${item.description}\n\n`;
    });

    msg += "━━━━━━━━━━━━━\n";
    msg += `👉 Phản hồi (reply) tin nhắn này kèm:\n`;
    msg += `• <Số thứ tự> <Số lượng> để mua (Ví dụ: 1 hoặc 1 2)\n`;
    msg += `• page <Số trang> để chuyển trang (Ví dụ: page 2)\n`;
    msg += `⚠️ Tin nhắn này sẽ tự động gỡ sau khi mua hoặc sang trang khác.`;

    const info = await api.sendMessage(msg, threadID);
    if (!global.client) global.client = {};
    if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
    
    // Xóa các handleReply cũ cùng lệnh shop của thread này để tránh bị rác
    const list = global.client.handleReply;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].name === "shop" && String(list[i].threadID) === String(threadID)) {
        list.splice(i, 1);
      }
    }

    global.client.handleReply.push({
      name: "shop",
      author: senderID,
      messageID: info.messageID,
      threadID: threadID,
      page: page
    });
  } catch (err) {
    console.error("Lỗi khi tải hoặc hiển thị danh sách shop:", err);
    return api.sendMessage("❌ Lỗi khi hiển thị danh sách shop.", threadID);
  }
}

module.exports = {
  name: "shop",
  description: "Xem danh sách vật phẩm có thể mua và tương tác trực tiếp",
  usage: `\n${prefix}shop → Xem danh sách vật phẩm có thể mua\n━━━━━━━━━━━━━\n🏪 Hiển thị tên, giá, mô tả từng item\n🛒 Phản hồi tin nhắn shop để mua hàng hoặc chuyển trang`,

  execute: async ({ api, event, config }) => {
    const { threadID, messageID, senderID } = event;

    // Cooldown 10s
    const cooldown = checkCooldown({
      command: "shop",
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

    await sendShopPage(api, threadID, senderID, 1);
  },

  handleReply: async ({ api, event }) => {
    const { threadID, messageID, senderID, body, messageReply } = event;
    if (!messageReply || !messageReply.messageID) return;

    const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
    const handleReply = list.find(h => String(h.messageID) === String(messageReply.messageID) && h.name === "shop");
    if (!handleReply) return;

    if (String(handleReply.author) !== String(senderID)) {
      return api.sendMessage("⚠️ Chỉ người gọi lệnh mới có thể tương tác với menu shop này.", threadID, messageID);
    }

    const trimmed = String(body || "").trim();
    const buyMatch = trimmed.match(/^(\d+)(?:\s+(\d+))?$/);
    const pageMatch = trimmed.match(/^page\s+(\d+)$/i);

    if (!buyMatch && !pageMatch) {
      return api.sendMessage(
        "⚠️ Cú pháp phản hồi không hợp lệ!\n" +
        "👉 Phản hồi số thứ tự để mua (Ví dụ: 1 hoặc 1 2)\n" +
        "👉 Phản hồi 'page <số trang>' để sang trang (Ví dụ: page 2)",
        threadID,
        messageID
      );
    }

    // 1. XỬ LÝ SANG TRANG
    if (pageMatch) {
      const targetPage = parseInt(pageMatch[1]);
      try {
        const items = await execute("SELECT * FROM shop_items ORDER BY price ASC");
        const totalPages = Math.ceil(items.length / 5);

        if (targetPage < 1 || targetPage > totalPages) {
          return api.sendMessage(`❌ Trang không hợp lệ (Shop chỉ có từ 1 đến ${totalPages} trang).`, threadID, messageID);
        }

        // Gỡ tin nhắn shop cũ
        try {
          await api.unsendMessage(handleReply.messageID);
        } catch (err) {
          console.error("Không thể gỡ tin nhắn shop cũ:", err);
        }

        // Xóa handleReply cũ
        const list = global.client.handleReply || [];
        const idx = list.findIndex(h => h.messageID === handleReply.messageID);
        if (idx > -1) list.splice(idx, 1);

        // Hiển thị trang mới
        await sendShopPage(api, threadID, senderID, targetPage);
      } catch (err) {
        console.error(err);
        return api.sendMessage("❌ Có lỗi xảy ra khi chuyển trang.", threadID, messageID);
      }
      return;
    }

    // 2. XỬ LÝ MUA VẬT PHẨM
    if (buyMatch) {
      const orderNumber = parseInt(buyMatch[1]);
      const quantity = buyMatch[2] ? parseInt(buyMatch[2]) : 1;

      if (quantity <= 0) {
        return api.sendMessage("⚠️ Số lượng mua phải lớn hơn 0!", threadID, messageID);
      }

      let connection;
      try {
        const items = await execute("SELECT * FROM shop_items ORDER BY price ASC");
        if (orderNumber < 1 || orderNumber > items.length) {
          return api.sendMessage("❌ Số thứ tự vật phẩm không tồn tại trong shop.", threadID, messageID);
        }

        const item = items[orderNumber - 1];
        const itemKey = item.item_key;
        const totalPrice = item.price * quantity;

        connection = await getConnection();

        // Check tiền của người chơi
        const [users] = await connection.execute(
          "SELECT credits, name FROM messenger_users WHERE psid = ?",
          [senderID]
        );

        if (users.length === 0) {
          return api.sendMessage(
            "❌ Bạn chưa có tài khoản. Gọi lệnh diemdanh để tạo tài khoản.",
            threadID,
            messageID
          );
        }

        const user = users[0];

        if (user.credits < totalPrice) {
          return api.sendMessage(
            `💸 Không đủ tiền!\n` +
            `Vật phẩm: ${item.name} x${quantity}\n` +
            `Giá: ${totalPrice.toLocaleString()} xu\n` +
            `Bạn có: ${user.credits.toLocaleString()} xu`,
            threadID,
            messageID
          );
        }

        await connection.beginTransaction();

        try {
          // Xử lý VIP riêng
          if (item.type === "vip") {
            // Trừ tiền
            await connection.execute(
              "UPDATE messenger_users SET credits = credits - ? WHERE psid = ?",
              [totalPrice, senderID]
            );

            // Tính thời gian VIP
            const now = new Date();
            const [currentUser] = await connection.execute(
              "SELECT vip_until FROM messenger_users WHERE psid = ?",
              [senderID]
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
              "UPDATE messenger_users SET vip_until = ? WHERE psid = ?",
              [vipUntil, senderID]
            );

            await connection.commit();

            // Gỡ tin nhắn shop cũ
            try {
              await api.unsendMessage(handleReply.messageID);
            } catch (err) {
              console.error(err);
            }

            // Xóa handleReply cũ khỏi danh sách
            const list = global.client.handleReply || [];
            const idx = list.findIndex(h => h.messageID === handleReply.messageID);
            if (idx > -1) list.splice(idx, 1);

            return api.sendMessage(
              `✅ MUA THÀNH CÔNG!\n` +
              `👑 ${item.name} x${quantity}\n` +
              `💰 Trừ: ${totalPrice.toLocaleString()} xu\n` +
              `👑 VIP đến: ${vipUntil.toLocaleString("vi-VN")}\n` +
              `💳 Còn lại: ${(user.credits - totalPrice).toLocaleString()} xu`,
              threadID,
              messageID
            );
          }

          // Xử lý các item khác
          if (item.stackable) {
            const [existing] = await connection.execute(
              "SELECT * FROM user_inventory WHERE psid = ? AND item_key = ?",
              [senderID, itemKey]
            );

            const totalUses = item.uses * quantity;
            if (existing.length > 0) {
              await connection.execute(
                "UPDATE user_inventory SET uses_left = uses_left + ? WHERE psid = ? AND item_key = ?",
                [totalUses, senderID, itemKey]
              );
            } else {
              await connection.execute(
                "INSERT INTO user_inventory (psid, item_key, uses_left) VALUES (?, ?, ?)",
                [senderID, itemKey, totalUses]
              );
            }
          } else {
            for (let i = 0; i < quantity; i++) {
              await connection.execute(
                "INSERT INTO user_inventory (psid, item_key, uses_left) VALUES (?, ?, ?)",
                [senderID, itemKey, item.uses]
              );
            }
          }

          // Trừ tiền
          await connection.execute(
            "UPDATE messenger_users SET credits = credits - ? WHERE psid = ?",
            [totalPrice, senderID]
          );

          await connection.commit();

          // Gỡ tin nhắn shop cũ
          try {
            await api.unsendMessage(handleReply.messageID);
          } catch (err) {
            console.error(err);
          }

          // Xóa handleReply cũ khỏi danh sách
          const list = global.client.handleReply || [];
          const idx = list.findIndex(h => h.messageID === handleReply.messageID);
          if (idx > -1) list.splice(idx, 1);

          return api.sendMessage(
            `✅ MUA THÀNH CÔNG!\n` +
            `📦 ${item.name} x${quantity}\n` +
            `💰 Trừ: ${totalPrice.toLocaleString()} xu\n` +
            `📦 Tổng số lượt sử dụng nhận được: ${item.uses * quantity}\n` +
            `💳 Còn lại: ${(user.credits - totalPrice).toLocaleString()} xu`,
            threadID,
            messageID
          );
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      } catch (e) {
        console.error(e);
        return api.sendMessage("❌ Lỗi khi thực hiện giao dịch mua hàng.", threadID, messageID);
      } finally {
        if (connection) connection.release();
      }
    }
  }
};
