const { checkCooldown } = require("../../utils/cooldown");

module.exports = {
  name: "help",
  description: "Xem danh sách lệnh theo nhóm",
  usage: "[tên lệnh]",
  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;
    const prefix = config?.prefix || "!";

    // Cooldown 5s
    const cooldown = checkCooldown({
      command: "help",
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
      // 1. Lấy danh sách lệnh từ Map global
      const commandList = Array.from(global.commands.keys()).sort();
      const commandSet = new Set(commandList);

      const sections = [
        {
          title: "💰 Kinh tế",
          commands: [
            "tien",
            "chuyentien",
            "bank",
            "lamviec",
            "diemdanh",
            "vay",
            "shop",
            "buy",
            "inv",
            "use",
            "openbox",
            "cuop",
            "daigia",
            "quest",
          ],
        },
        {
          title: "🎮 Minigame",
          commands: ["taixiu", "baucua", "lode", "duoihinhbatchu"],
        },
        {
          title: "👥 Nhóm",
          commands: [
            "admingr",
            "add",
            "kick",
            "grinfo",
            "checkout",
            "antiout",
            "checktt",
            "checkbd",
            "ghepdoi",
            "setbd",
          ],
        },
        {
          title: "🛠️ Công cụ",
          commands: [
            "help",
            "huongdan",
            "changelog",
            "ai",
            "dich",
            "say",
            "mp3",
            "vidgai",
            "đấm",
            "reset",
          ],
        },
        { title: "⚙️ Hệ thống", commands: ["ping", "uid", "tu", "go", "mode"] },
      ];

      const grouped = sections
        .map((section) => {
          const available = section.commands.filter((name) =>
            commandSet.has(name),
          );
          return { title: section.title, commands: available };
        })
        .filter((section) => section.commands.length > 0);

      const groupedNames = new Set(
        grouped.flatMap((section) => section.commands),
      );
      const others = commandList.filter((name) => !groupedNames.has(name));

      if (!args[0]) {
        let msg = `📜 DANH SÁCH LỆNH (${commandList.length})\n━━━━━━━━━━━━━\n`;

        grouped.forEach((section) => {
          msg += `${section.title}: ${section.commands.join(", ")}\n`;
        });

        if (others.length > 0) {
          msg += `📦 Khác: ${others.join(", ")}\n`;
        }

        msg += "━━━━━━━━━━━━━\n";
        msg += `👉 Chi tiết: ${prefix}help [tên lệnh]`;

        return api.sendMessage(msg, threadID);
      }

      // 2. Chi tiết từng lệnh
      const commandName = args[0].toLowerCase();
      const command = global.commands.get(commandName);

      if (!command) {
        return api.sendMessage(
          `❌ Lệnh "${commandName}" không tồn tại.`,
          threadID,
        );
      }

      const detailMsg =
        `ℹ️ LỆNH: ${commandName.toUpperCase()}\n` +
        `📝 Mô tả: ${command.description || "Chưa có"}\n` +
        `🛠️ Cách dùng: ${prefix}${commandName}${command.usage ? ` ${command.usage}` : ""}`;

      return api.sendMessage(detailMsg, threadID);
    } catch (e) {
      console.error("Lỗi Help:", e);
    }
  },
};
