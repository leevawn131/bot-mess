const { execute, getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const { restoreEnergy } = require("../../utils/energySystem");
const prefix = process.env.BOT_PREFIX;

const LEGACY_ENERGY_TYPES = new Set([
  "energy_restore",
  "restore_energy",
  "energy",
  "stamina_restore",
  "energy_boost",
]);


function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isEnergyRestoreItem(item) {
  const type = normalizeText(item?.type);
  if (LEGACY_ENERGY_TYPES.has(type)) return true;

  const itemKey = normalizeText(item?.item_key);
  if (itemKey.includes("energy") || itemKey.includes("stamina")) return true;

  const name = normalizeText(item?.name);
  const description = normalizeText(item?.description);

  if (name.includes("the luc") || name.includes("nang luong")) return true;
  if (
    description.includes("hoi") &&
    (description.includes("the luc") || description.includes("nang luong"))
  ) {
    return true;
  }

  return false;
}

module.exports = {
  name: "use",
  description: "Sử dụng vật phẩm trong túi đồ",
  usage: `\n${prefix}use [item-key] → Sử dụng vật phẩm trong túi đồ\n━━━━━━━━━━━━━\n📌 [item-key]: Mã vật phẩm (xem bằng ${prefix}inv)\n⚡ Vật phẩm năng lượng sẽ hồi phục stamina\n💡 Ví dụ: ${prefix}use shield`,

  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;

    // Cooldown 5s
    const cooldown = checkCooldown({
      command: "use",
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
    const itemKey = args[0]?.toLowerCase();

    if (!itemKey) {
      return api.sendMessage(
        `⚠️ Hãy nhập item key.\nVí dụ: ${prefix}use shield`,
        threadID,
        messageID,
      );
    }

    try {
      // Check item trong inventory
      const invItems = await execute(
        `SELECT ui.*, si.type, si.effect_value, si.uses, si.name, si.description
                FROM user_inventory ui
                JOIN shop_items si ON ui.item_key = si.item_key
                WHERE ui.thread_id = ? AND ui.psid = ? AND ui.item_key = ? AND ui.uses_left > 0`,
        [String(threadID), senderID, itemKey],
      );

      if (invItems.length === 0) {
        return api.sendMessage(
          `❌ Bạn không có item này trong túi.\nGọi ${prefix}inv để xem túi đồ.`,
          threadID,
          messageID,
        );
      }

      const invItem = invItems[0];

      // Kiểm tra item type (chỉ dùng được một số loại)
      if (invItem.type === "lootbox") {
        return api.sendMessage(
          `❌ Hộp bí ẩn cần dùng lệnh ${prefix}openbox`,
          threadID,
          messageID,
        );
      }

      if (invItem.type === "vip") {
        let connection;
        try {
          connection = await getConnection();
          await connection.beginTransaction();

          // Lấy thông tin user
          const [userRows] = await connection.execute(
            "SELECT name, vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?",
            [String(threadID), senderID]
          );

          if (userRows.length === 0) {
            return api.sendMessage(
              "❌ Bạn chưa có tài khoản trong thế giới này.",
              threadID,
              messageID
            );
          }

          const now = new Date();
          let vipUntil;
          if (userRows[0].vip_until && new Date(userRows[0].vip_until) > now) {
            vipUntil = new Date(userRows[0].vip_until);
            vipUntil.setDate(vipUntil.getDate() + (Number(invItem.effect_value) || 0));
          } else {
            vipUntil = new Date();
            vipUntil.setDate(vipUntil.getDate() + (Number(invItem.effect_value) || 0));
          }

          // Cập nhật VIP
          await connection.execute(
            "UPDATE messenger_users SET vip_until = ? WHERE thread_id = ? AND psid = ?",
            [vipUntil, String(threadID), senderID]
          );

          // Trừ vật phẩm
          if (invItem.uses_left <= 1) {
            await connection.execute(
              "DELETE FROM user_inventory WHERE id = ?",
              [invItem.id]
            );
          } else {
            await connection.execute(
              "UPDATE user_inventory SET uses_left = uses_left - 1 WHERE id = ?",
              [invItem.id]
            );
          }

          await connection.commit();

          return api.sendMessage(
            `👑 KÍCH HOẠT VIP THÀNH CÔNG!\n━━━━━━━━━━━━━\n👤 Người dùng: ${userRows[0].name || "Bạn"}\n✨ Vật phẩm sử dụng: ${invItem.name}\n👑 VIP đến ngày: ${vipUntil.toLocaleString("vi-VN")}`,
            threadID,
            messageID
          );
        } catch (err) {
          if (connection) await connection.rollback();
          console.error("Lỗi sử dụng VIP:", err);
          return api.sendMessage("❌ Lỗi kích hoạt VIP.", threadID, messageID);
        } finally {
          if (connection) connection.release();
        }
      }

      if (isEnergyRestoreItem(invItem)) {
        const restoreAmount = Math.max(
          0,
          Math.floor(Number(invItem.effect_value) || 0),
        );
        if (restoreAmount <= 0) {
          return api.sendMessage(
            "❌ Bình năng lượng này đang bị lỗi dữ liệu (thiếu chỉ số hồi).",
            threadID,
            messageID,
          );
        }

        let connection;
        let restored;
        try {
          connection = await getConnection();
          restored = await restoreEnergy(
            connection,
            String(threadID),
            senderID,
            restoreAmount,
          );
        } finally {
          if (connection) connection.release();
        }
        if (!restored.ok) {
          return api.sendMessage(
            "❌ Không thể hồi thể lực lúc này.",
            threadID,
            messageID,
          );
        }

        if (invItem.uses_left <= 1) {
          await execute(
            "DELETE FROM user_inventory WHERE id = ?",
            [invItem.id],
          );
        } else {
          await execute(
            "UPDATE user_inventory SET uses_left = uses_left - 1 WHERE id = ?",
            [invItem.id],
          );
        }

        return api.sendMessage(
          `🧪 DÙNG BÌNH HỒI THỂ LỰC THÀNH CÔNG!\n⚡ Hồi ngay: +${restored.restored}/${restoreAmount}\n📊 Thể lực: ${restored.after}/${restored.maxEnergy}`,
          threadID,
          messageID,
        );
      }

      // Kích hoạt effect vào active_effects
      // Check xem đã có effect này chưa
      const existingEffects = await execute(
        "SELECT * FROM active_effects WHERE psid = ? AND effect_type = ?",
        [senderID, invItem.type],
      );

      if (existingEffects.length > 0) {
        // Tăng uses_left
        await execute(
          "UPDATE active_effects SET uses_left = uses_left + ?, effect_value = ? WHERE psid = ? AND effect_type = ?",
          [invItem.uses, invItem.effect_value, senderID, invItem.type],
        );
      } else {
        // Thêm mới
        await execute(
          "INSERT INTO active_effects (psid, effect_type, effect_value, uses_left) VALUES (?, ?, ?, ?)",
          [senderID, invItem.type, invItem.effect_value, invItem.uses],
        );
      }

      // Trừ uses_left trong inventory
      if (invItem.uses_left <= 1) {
        // Xóa item khỏi inventory nếu hết
        await execute("DELETE FROM user_inventory WHERE id = ?", [
          invItem.id,
        ]);
      } else {
        await execute(
          "UPDATE user_inventory SET uses_left = uses_left - 1 WHERE id = ?",
          [invItem.id],
        );
      }

      return api.sendMessage(
        `✅ ĐÃ KÍCH HOẠT!\n${invItem.name}\n🔥 Hiệu ứng: ${invItem.type}\n📊 Giá trị: ${invItem.effect_value}%\n🎯 Còn ${invItem.uses} lượt sử dụng`,
        threadID,
        messageID,
      );
    } catch (e) {
      console.error(e);
      return api.sendMessage("❌ Lỗi khi sử dụng item.", threadID, messageID);
    }
  },
};
