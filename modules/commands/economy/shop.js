const { execute } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");

module.exports = {
  name: "shop",
  description: "Xem danh sách vật phẩm có thể mua",
  usage: "\n!shop → Xem danh sách vật phẩm có thể mua\n━{13}\n🏪 Hiển thị tên, giá, mô tả từng item\n🛒 Mua: !buy [item-key] <số_lượng>",

  execute: async ({ api, event, config }) => {
    const { threadID, messageID, senderID } = event;

    // Cooldown 5s
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

    try {
      const items = await execute(
        "SELECT * FROM shop_items ORDER BY price ASC",
      );

      if (items.length === 0) {
        return api.sendMessage("❌ Shop hiện đang trống.", threadID, messageID);
      }

      let msg = "🏪 SHOP VẬT PHẨM\n━{13}\n\n";

      items.forEach((item, index) => {
        msg += `${index + 1}. ${item.name}\n`;
        msg += `   Key: ${item.item_key}\n`;
        msg += `   Giá: ${item.price.toLocaleString()} xu\n`;
        msg += `   Mô tả: ${item.description}\n\n`;
      });

      msg += "━{13}\n";
      msg += "👉 Mua: !buy [item-key]\n";
      msg += "Ví dụ: !buy shield";

      return api.sendMessage(msg, threadID, messageID);
    } catch (e) {
      console.error(e);
      return api.sendMessage(
        "❌ Lỗi khi tải danh sách shop.",
        threadID,
        messageID,
      );
    }
  },
};
