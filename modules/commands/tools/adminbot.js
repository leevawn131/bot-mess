const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { execute } = require("../../utils/database");
const prefix = process.env.BOT_PREFIX;

async function resolveUserName(api, uid) {
  const id = String(uid || "").trim();
  if (!id) return null;

  if (global.data?.userName?.has(id)) {
    return global.data.userName.get(id);
  }

  try {
    const rows = await execute("SELECT name FROM messenger_users WHERE psid = ? AND name != 'Người dùng' AND name != '' LIMIT 1", [id]);
    if (rows && rows[0] && rows[0].name) {
      if (global.data?.userName) global.data.userName.set(id, rows[0].name);
      return rows[0].name;
    }
  } catch { }

  try {
    const info = await api.getUserInfo(id);
    if (!info) return null;

    let foundName = null;
    if (info[id] && typeof info[id].name === 'string' && info[id].name.trim()) {
      foundName = info[id].name.trim();
    } else if (typeof info.name === 'string' && info.name.trim()) {
      foundName = info.name.trim();
    } else if (Array.isArray(info) && info.length > 0) {
      const first = info[0];
      if (first && typeof first === 'object') {
        if (first[id] && typeof first[id].name === 'string') foundName = first[id].name.trim();
        else if (typeof first.name === 'string') foundName = first.name.trim();
      }
    }

    if (foundName) {
      if (global.data?.userName) global.data.userName.set(id, foundName);
      return foundName;
    }
  } catch { }

  return null;
}

module.exports = {
  name: "adminbot",
  description: "Hiển thị danh sách admin bot",
  usage: `\n${prefix}adminbot → Xem danh sách admin của bot\n━━━━━━━━━━━━━\n👑 Hiển thị tên và link Facebook của từng admin`,

  execute: async ({ api, event }) => {
    const { threadID, messageID, senderID } = event;

    const cooldown = checkCooldown({
      command: "adminbot",
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

    const adminBotUIDs = getAdminBotUIDs(api);
    const adminIds = Array.from(
      new Set(
        (Array.isArray(adminBotUIDs) ? adminBotUIDs : []).map((id) => String(id).trim()).filter(Boolean),
      ),
    );

    if (adminIds.length === 0) {
      return api.sendMessage(
        "⚠️ Chưa cấu hình admin bot nào.",
        threadID,
        messageID,
      );
    }

    try {
      const names = await Promise.all(
        adminIds.map((id) => resolveUserName(api, id)),
      );

      if (typeof api.shareContact === "function") {
        for (let i = 0; i < adminIds.length; i++) {
          const id = adminIds[i];
          const name = names[i] || "Admin";
          const cardText = `👑 [ THÔNG TIN ADMIN BOT ] 👑\n━━━━━━━━━━━━━━━━━━\n👤 Tên: ${name}\n🆔 UID: ${id}\n━━━━━━━━━━━━━━━━━━\n👉 Bấm vào thẻ bên dưới để xem Profile hoặc nhắn tin trực tiếp!`;

          try {
            await new Promise((resolve, reject) => {
              api.shareContact(cardText, id, threadID, (err, data) => {
                if (err) return reject(err);
                resolve(data);
              });
            });
          } catch (shareErr) {
            console.warn(`[adminbot] Lỗi gửi shareContact cho ${id}, chuyển sang gửi tin nhắn thường:`, shareErr.message || shareErr);
            await api.sendMessage(cardText, threadID, messageID);
          }
        }
        return;
      }

      // Fallback nếu api.shareContact không khả dụng
      let msg = `👑 DANH SÁCH ADMIN BOT (${adminIds.length})\n━━━━━━━━━━━━━━━━━━\n`;
      adminIds.forEach((id, index) => {
        const name = names[index] || "Không lấy được tên";
        const profileLink = `https://www.messenger.com/e2ee/t/${id}`;
        msg += `${index + 1}. ${name}\n🔗 ${profileLink}\n`;
      });
      return api.sendMessage(msg.trim(), threadID, messageID);
    } catch (e) {
      console.error("Lỗi adminbot:", e);
      return api.sendMessage(
        "❌ Không thể lấy danh sách admin bot lúc này.",
        threadID,
        messageID,
      );
    }
  },
};
