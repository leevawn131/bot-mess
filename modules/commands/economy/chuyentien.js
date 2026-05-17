const { checkCooldown } = require("../../utils/cooldown");
const tienCommand = require("./tien");

module.exports = {
  name: "chuyentien",
  description: "Chuyển tiền cho người khác",
  usage: "\n!chuyentien [số_tiền] @tag → Chuyển cho người được tag\n!chuyentien [số_tiền] (reply) → Chuyển cho người được reply\n━━━━━━━━━━━━━━━━━━\n📌 Phí chuyển: 2%\n💡 Ví dụ: !chuyentien 50000 @Minh",
  execute: async (ctx) => {
    const { api, event } = ctx;
    const { threadID, messageID, senderID } = event;

    const cooldown = checkCooldown({
      command: "chuyentien",
      key: senderID,
      durationMs: 10000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui long cho ${cooldown.timeLeft}s truoc khi dung lai lenh nay.`,
        threadID,
        messageID,
      );
    }

    const rawArgs = Array.isArray(ctx.args) ? ctx.args : [];
    if (rawArgs.length === 0) {
      return api.sendMessage(
        "⚠️ Dung: !chuyentien <so_tien> (tag/reply/ID)",
        threadID,
        messageID,
      );
    }

    return tienCommand.execute({
      ...ctx,
      args: ["chuyen", ...rawArgs],
      transferMode: true,
    });
  },
};
