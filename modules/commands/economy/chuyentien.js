const { checkCooldown } = require("../../utils/cooldown");
const tienCommand = require("./tien");
const prefix = process.env.BOT_PREFIX;

module.exports = {
  name: "chuyentien",
  description: "Chuyển tiền cho người khác",
  usage: `\n${prefix}chuyentien [số_tiền] @tag → Chuyển cho người được tag\n${prefix}chuyentien [số_tiền] (reply) → Chuyển cho người được reply\n━━━━━━━━━━━━━\n📌 Phí chuyển: 2% (Hỗ trợ viết tắt k, tr, m)\n💡 Ví dụ: ${prefix}chuyentien 50k @Minh hoặc 2.5tr @Minh`,
  execute: async (ctx) => {
    const { api, event } = ctx;
    const { threadID, messageID, senderID } = event;

    try {
      const cooldown = checkCooldown({
        command: "chuyentien",
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

      const rawArgs = Array.isArray(ctx.args) ? ctx.args : [];
      if (rawArgs.length === 0) {
        const prefix = ctx.config?.prefix || "!";
        return api.sendMessage(
          `⚠️ Cú pháp: ${prefix}chuyentien <số_tiền> (@tag / reply / UID)`,
          threadID,
          messageID,
        );
      }

      return await tienCommand.execute({
        ...ctx,
        args: ["chuyen", ...rawArgs],
        transferMode: true,
      });
    } catch (e) {
      console.error("Lỗi chuyentien:", e);
      return api.sendMessage("❌ Có lỗi xảy ra khi thực hiện chuyển tiền.", threadID, messageID);
    }
  },
};
