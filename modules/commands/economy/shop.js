const { execute, getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const prefix = process.env.BOT_PREFIX || "!";

async function sendShopPage(api, threadID, senderID, page, filterCategory = null) {
  try {
    let query = "SELECT * FROM shop_items";
    const params = [];

    if (filterCategory === "cauca") {
      query += " WHERE type IN ('fishing_rod', 'fishing_bait') ORDER BY price ASC";
    } else {
      query += " ORDER BY CASE WHEN type IN ('fishing_rod', 'fishing_bait') THEN 1 ELSE 0 END ASC, price ASC";
    }

    const items = await execute(query, params);

    if (items.length === 0) {
      return api.sendMessage("❌ Shop hiện đang trống.", threadID);
    }

    const itemsPerPage = 5;
    const totalPages = Math.ceil(items.length / itemsPerPage);

    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const startIndex = (page - 1) * itemsPerPage;
    const pageItems = items.slice(startIndex, startIndex + itemsPerPage);

    let title = filterCategory === "cauca" ? "🎣 SHOP VẬT PHẨM CÂU CÁ" : "🏪 SHOP VẬT PHẨM";
    let msg = `${title} [Trang ${page}/${totalPages}]\n━━━━━━━━━━━━━\n\n`;

    pageItems.forEach((item, index) => {
      const displayIndex = startIndex + index + 1;
      msg += `${displayIndex}. ${item.name}\n`;
      msg += `   Key: ${item.item_key}\n`;
      msg += `   Giá: ${item.price.toLocaleString('vi-VN')} xu\n`;
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
      page: page,
      filterCategory: filterCategory
    });
  } catch (err) {
    console.error("Lỗi khi tải hoặc hiển thị danh sách shop:", err);
    return api.sendMessage("❌ Lỗi khi hiển thị danh sách shop.", threadID);
  }
}

// Xử lý bán toàn bộ cá ở nhóm hiện tại
async function handleBanCa(api, threadID, messageID, senderID) {
  const stringThreadID = String(threadID);
  const stringSenderID = String(senderID);

  try {
    const fishList = await execute(
      "SELECT * FROM user_caught_fish WHERE thread_id = ? AND psid = ?",
      [stringThreadID, stringSenderID]
    );

    if (fishList.length === 0) {
      return api.sendMessage(
        "❌ Bạn chưa có con cá nào trong túi ở nhóm này để bán cả!\n👉 Hãy gõ !cauca để đi câu cá trước.",
        threadID,
        messageID
      );
    }

    let totalXu = 0;
    let kingCount = 0;

    fishList.forEach(fish => {
      totalXu += fish.price;
      if (fish.is_king) kingCount++;
    });

    // Xóa toàn bộ cá ở nhóm này
    await execute("DELETE FROM user_caught_fish WHERE thread_id = ? AND psid = ?", [stringThreadID, stringSenderID]);

    // Cộng xu trực tiếp cho user ở nhóm này
    const userExist = await execute("SELECT * FROM messenger_users WHERE thread_id = ? AND psid = ?", [stringThreadID, stringSenderID]);
    if (userExist.length > 0) {
      await execute(
        "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
        [totalXu, stringThreadID, stringSenderID]
      );
    } else {
      const userName = (global.data && global.data.userName && global.data.userName.get(stringSenderID)) || "Người dùng";
      await execute(
        "INSERT INTO messenger_users (thread_id, psid, name, credits) VALUES (?, ?, ?, ?)",
        [stringThreadID, stringSenderID, userName, 10000 + totalXu]
      );
    }

    const [user] = await execute("SELECT credits FROM messenger_users WHERE thread_id = ? AND psid = ?", [stringThreadID, stringSenderID]);
    const newBalance = user ? user.credits : 0;

    let msg = `💵 HÓA ĐƠN BÁN CÁ THÀNH CÔNG (THẾ GIỚI NÀY)!\n`;
    msg += `━━━━━━━━━━━━━\n`;
    msg += `🐟 Tổng số cá đã bán: ${fishList.length} con\n`;
    if (kingCount > 0) {
      msg += `👑 Cá Kỷ Lục (King Size): ${kingCount} con\n`;
    }
    msg += `💰 Tổng xu thu về: +${totalXu.toLocaleString('vi-VN')} xu!\n`;
    msg += `💳 Số dư hiện tại: ${newBalance.toLocaleString('vi-VN')} xu\n`;
    msg += `━━━━━━━━━━━━━\n`;
    msg += `✨ Cảm ơn bạn đã giao dịch tại Chợ Cá!`;

    return api.sendMessage(msg, threadID, messageID);
  } catch (err) {
    console.error("Lỗi khi thực hiện bán cá:", err);
    return api.sendMessage("❌ Lỗi khi thực hiện bán cá.", threadID, messageID);
  }
}

module.exports = {
  name: "shop",
  description: "Xem danh sách vật phẩm có thể mua, mua cần/mồi hoặc bán cá",
  usage: `\n${prefix}shop → Xem danh sách vật phẩm (mồi & cần xếp sau cùng)\n${prefix}shop cauca → Chỉ xem Cần câu & Mồi câu\n${prefix}shop banca → Bán toàn bộ cá đang có trong túi`,

  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;

    const subCommand = args[0]?.toLowerCase();

    if (subCommand === "banca") {
      return await handleBanCa(api, threadID, messageID, senderID);
    }

    const cooldown = checkCooldown({
      command: "shop",
      key: senderID,
      durationMs: 5000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi mở lại shop.`,
        threadID,
        messageID
      );
    }

    const filterCategory = subCommand === "cauca" ? "cauca" : null;
    await sendShopPage(api, threadID, senderID, 1, filterCategory);
  },

  handleReply: async ({ api, event }) => {
    const { threadID, messageID, senderID, body, messageReply } = event;
    if (!messageReply || !messageReply.messageID) return;

    const stringThreadID = String(threadID);
    const stringSenderID = String(senderID);

    const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
    const handleReply = list.find(h => String(h.messageID) === String(messageReply.messageID) && h.name === "shop");
    if (!handleReply) return;

    if (String(handleReply.author) !== stringSenderID) {
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
        let query = "SELECT * FROM shop_items";
        if (handleReply.filterCategory === "cauca") {
          query += " WHERE type IN ('fishing_rod', 'fishing_bait') ORDER BY price ASC";
        } else {
          query += " ORDER BY CASE WHEN type IN ('fishing_rod', 'fishing_bait') THEN 1 ELSE 0 END ASC, price ASC";
        }

        const items = await execute(query);
        const totalPages = Math.ceil(items.length / 5);

        if (targetPage < 1 || targetPage > totalPages) {
          return api.sendMessage(`❌ Trang không hợp lệ (Shop chỉ có từ 1 đến ${totalPages} trang).`, threadID, messageID);
        }

        try {
          await api.unsendMessage(handleReply.messageID);
        } catch (err) {}

        const list = global.client.handleReply || [];
        const idx = list.findIndex(h => h.messageID === handleReply.messageID);
        if (idx > -1) list.splice(idx, 1);

        await sendShopPage(api, threadID, senderID, targetPage, handleReply.filterCategory);
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
        let query = "SELECT * FROM shop_items";
        if (handleReply.filterCategory === "cauca") {
          query += " WHERE type IN ('fishing_rod', 'fishing_bait') ORDER BY price ASC";
        } else {
          query += " ORDER BY CASE WHEN type IN ('fishing_rod', 'fishing_bait') THEN 1 ELSE 0 END ASC, price ASC";
        }

        const items = await execute(query);
        if (orderNumber < 1 || orderNumber > items.length) {
          return api.sendMessage("❌ Số thứ tự vật phẩm không tồn tại trong shop.", threadID, messageID);
        }

        const item = items[orderNumber - 1];
        const itemKey = item.item_key;
        const totalPrice = item.price * quantity;

        connection = await getConnection();

        // Check tiền của người chơi ở nhóm này (thread_id, psid)
        let [users] = await connection.execute(
          "SELECT credits, name FROM messenger_users WHERE thread_id = ? AND psid = ?",
          [stringThreadID, stringSenderID]
        );

        if (users.length === 0) {
          const userName = (global.data && global.data.userName && global.data.userName.get(stringSenderID)) || "Người dùng";
          await connection.execute(
            "INSERT INTO messenger_users (thread_id, psid, name, credits) VALUES (?, ?, ?, 10000)",
            [stringThreadID, stringSenderID, userName]
          );
          [users] = await connection.execute(
            "SELECT credits, name FROM messenger_users WHERE thread_id = ? AND psid = ?",
            [stringThreadID, stringSenderID]
          );
        }

        const user = users[0];

        if (user.credits < totalPrice) {
          return api.sendMessage(
            `💸 Không đủ tiền ở nhóm này!\n` +
            `Vật phẩm: ${item.name} x${quantity}\n` +
            `Giá: ${totalPrice.toLocaleString('vi-VN')} xu\n` +
            `Bạn có: ${user.credits.toLocaleString('vi-VN')} xu`,
            threadID,
            messageID
          );
        }

        await connection.beginTransaction();

        try {
          // Xử lý VIP riêng theo từng nhóm
          if (item.type === "vip") {
            await connection.execute(
              "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
              [totalPrice, stringThreadID, stringSenderID]
            );

            const now = new Date();
            const [currentUser] = await connection.execute(
              "SELECT vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?",
              [stringThreadID, stringSenderID]
            );

            let vipUntil;
            if (
              currentUser[0].vip_until &&
              new Date(currentUser[0].vip_until) > now
            ) {
              vipUntil = new Date(currentUser[0].vip_until);
              vipUntil.setDate(vipUntil.getDate() + item.effect_value * quantity);
            } else {
              vipUntil = new Date();
              vipUntil.setDate(vipUntil.getDate() + item.effect_value * quantity);
            }

            await connection.execute(
              "UPDATE messenger_users SET vip_until = ? WHERE thread_id = ? AND psid = ?",
              [vipUntil, stringThreadID, stringSenderID]
            );

            await connection.commit();

            try {
              await api.unsendMessage(handleReply.messageID);
            } catch (err) {}

            const list = global.client.handleReply || [];
            const idx = list.findIndex(h => h.messageID === handleReply.messageID);
            if (idx > -1) list.splice(idx, 1);

            return api.sendMessage(
              `✅ MUA THÀNH CÔNG VIP (THẾ GIỚI NÀY)!\n` +
              `👑 ${item.name} x${quantity}\n` +
              `💰 Trừ: ${totalPrice.toLocaleString('vi-VN')} xu\n` +
              `👑 VIP đến: ${vipUntil.toLocaleString("vi-VN")}\n` +
              `💳 Số dư còn lại: ${(user.credits - totalPrice).toLocaleString('vi-VN')} xu`,
              threadID,
              messageID
            );
          }

          // Xử lý các item thường ở nhóm này
          if (item.stackable) {
            const [existing] = await connection.execute(
              "SELECT * FROM user_inventory WHERE thread_id = ? AND psid = ? AND item_key = ?",
              [stringThreadID, stringSenderID, itemKey]
            );

            const totalUses = item.uses * quantity;
            if (existing.length > 0) {
              await connection.execute(
                "UPDATE user_inventory SET uses_left = uses_left + ? WHERE thread_id = ? AND psid = ? AND item_key = ?",
                [totalUses, stringThreadID, stringSenderID, itemKey]
              );
            } else {
              await connection.execute(
                "INSERT INTO user_inventory (thread_id, psid, item_key, uses_left) VALUES (?, ?, ?, ?)",
                [stringThreadID, stringSenderID, itemKey, totalUses]
              );
            }
          } else {
            for (let i = 0; i < quantity; i++) {
              await connection.execute(
                "INSERT INTO user_inventory (thread_id, psid, item_key, uses_left) VALUES (?, ?, ?, ?)",
                [stringThreadID, stringSenderID, itemKey, item.uses]
              );
            }
          }

          // Trừ tiền ở nhóm này
          await connection.execute(
            "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
            [totalPrice, stringThreadID, stringSenderID]
          );

          await connection.commit();

          try {
            await api.unsendMessage(handleReply.messageID);
          } catch (err) {}

          const list = global.client.handleReply || [];
          const idx = list.findIndex(h => h.messageID === handleReply.messageID);
          if (idx > -1) list.splice(idx, 1);

          return api.sendMessage(
            `✅ MUA THÀNH CÔNG (THẾ GIỚI NÀY)!\n` +
            `📦 ${item.name} x${quantity}\n` +
            `💰 Trừ: ${totalPrice.toLocaleString('vi-VN')} xu\n` +
            `📦 Tổng lượt sử dụng nhận được: ${item.uses * quantity}\n` +
            `💳 Số dư còn lại: ${(user.credits - totalPrice).toLocaleString('vi-VN')} xu`,
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
