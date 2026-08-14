const { execute } = require('../../utils/database');
const { checkCooldown } = require('../../utils/cooldown');
const prefix = process.env.BOT_PREFIX || '!';

module.exports = {
  name: "inv",
  description: "Xem túi đồ vật phẩm và bể cá ở nhóm hiện tại",
  usage: `\n${prefix}inv → Xem túi đồ (vật phẩm & cá sở hữu)\n━━━━━━━━━━━━━\n📦 Hiển thị tên, mã, số lượt dùng còn lại\n🐟 Danh sách cá vừa câu được\n💡 Dùng vật phẩm: ${prefix}use [item-key]\n💡 Bán cá: ${prefix}shop banca`,

  execute: async ({ api, event }) => {
    const { threadID, messageID, senderID } = event;
    const stringThreadID = String(threadID);
    const stringSenderID = String(senderID);

    // Cooldown 5s
    const cooldown = checkCooldown({ command: "inv", key: senderID, durationMs: 5000 });
    if (!cooldown.allowed) {
      return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi xem lại túi đồ.`, threadID, messageID);
    }

    try {
      // 1. Lấy inventory vật phẩm ở nhóm hiện tại
      const items = await execute(
        `SELECT ui.item_key, ui.uses_left, si.name, si.description
         FROM user_inventory ui
         JOIN shop_items si ON ui.item_key = si.item_key
         WHERE ui.thread_id = ? AND ui.psid = ? AND ui.uses_left > 0`,
        [stringThreadID, stringSenderID]
      );

      // 2. Lấy danh sách cá ở nhóm hiện tại
      const fishList = await execute(
        `SELECT fish_name, rarity, size_cm, weight_kg, price, is_king 
         FROM user_caught_fish 
         WHERE thread_id = ? AND psid = ? 
         ORDER BY price DESC`,
        [stringThreadID, stringSenderID]
      );

      // Check VIP status ở nhóm hiện tại
      const user = await execute(
        'SELECT vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?',
        [stringThreadID, stringSenderID]
      );

      let msg = "🎒 TÚI ĐỒ (THẾ GIỚI NÀY)\n━━━━━━━━━━━━━\n\n";

      if (user.length > 0 && user[0].vip_until) {
        const vipUntil = new Date(user[0].vip_until);
        const now = new Date();

        if (vipUntil > now) {
          const daysLeft = Math.ceil((vipUntil - now) / (1000 * 60 * 60 * 24));
          msg += `👑 VIP (Nhóm này): Còn ${daysLeft} ngày\n\n`;
        }
      }

      if (items.length === 0 && fishList.length === 0) {
        msg += "📦 Túi đồ ở nhóm này hiện đang trống!\n";
        msg += `👉 Gõ ${prefix}shop hoặc ${prefix}shop cauca để mua sắm vật phẩm.`;
        return api.sendMessage(msg, threadID, messageID);
      }

      // Khối 1: Vật phẩm
      msg += `📦 VẬT PHẨM & CÔNG CỤ (${items.length}):\n`;
      if (items.length === 0) {
        msg += `(Không có vật phẩm nào)\n\n`;
      } else {
        items.forEach((item, index) => {
          msg += `${index + 1}. ${item.name} (${item.item_key})\n`;
          msg += `   Số lượt còn: ${item.uses_left}\n`;
        });
        msg += `\n`;
      }

      // Khối 2: Bể cá / Cá đã bắt
      msg += `🐟 BỂ CÁ / CÁ ĐÃ BẮT (${fishList.length} con):\n`;
      if (fishList.length === 0) {
        msg += `(Chưa có con cá nào - gõ ${prefix}cauca để đi câu!)\n\n`;
      } else {
        const displayFish = fishList.slice(0, 10);

        displayFish.forEach((fish, index) => {
          const kingPrefix = fish.is_king ? "👑 " : "";
          msg += `${index + 1}. ${kingPrefix}${fish.fish_name} (${fish.rarity})\n`;
          msg += `   📏 ${fish.size_cm}cm | ⚖️ ${fish.weight_kg}kg | 💰 ${fish.price.toLocaleString('vi-VN')} xu\n`;
        });

        if (fishList.length > 10) {
          const remainingCount = fishList.length - 10;
          msg += `... và ${remainingCount} con cá khác.\n`;
        }

        const totalAllValue = fishList.reduce((acc, f) => acc + f.price, 0);
        msg += `💰 Tổng giá trị bể cá: ${totalAllValue.toLocaleString('vi-VN')} xu\n\n`;
      }

      msg += "━━━━━━━━━━━━━\n";
      msg += `👉 Dùng vật phẩm: ${prefix}use [item-key]\n`;
      msg += `👉 Bán tất cả cá lấy xu: ${prefix}shop banca`;

      return api.sendMessage(msg, threadID, messageID);

    } catch (e) {
      console.error(e);
      return api.sendMessage("❌ Lỗi khi xem túi đồ.", threadID, messageID);
    }
  }
};
