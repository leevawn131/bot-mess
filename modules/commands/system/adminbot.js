const { checkCooldown } = require("../../utils/cooldown");
const { ADMIN_BOT_UIDS } = require("../../utils/checkPermission");

async function resolveUserName(api, uid) {
  const id = String(uid || "").trim();
  if (!id) return null;

  try {
    const info = await api.getUserInfo(id, false);

    if (info && typeof info === "object") {
      if (typeof info.name === "string" && info.name.trim()) {
        return info.name.trim();
      }

      const keyed = info[id];
      if (keyed && typeof keyed.name === "string" && keyed.name.trim()) {
        return keyed.name.trim();
      }
    }
  } catch {}

  return null;
}

module.exports = {
  name: "adminbot",
  description: "Hiển thị danh sách admin bot",
  usage: "",

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

    const adminIds = Array.from(
      new Set(
        (ADMIN_BOT_UIDS || []).map((id) => String(id).trim()).filter(Boolean),
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

      let msg = `👑 DANH SÁCH ADMIN BOT (${adminIds.length})\n━━━━━━━━━━━━━━━━━━\n`;

      adminIds.forEach((id, index) => {
        const name = names[index] || "Không lấy được tên";
        const profileLink = `https://www.facebook.com/${id}`;
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
