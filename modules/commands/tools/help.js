const { checkCooldown } = require("../../utils/cooldown");

const AUTO_UNSEND_MS = 30000;

function scheduleAutoUnsend(api, messageResult) {
  const messageID = messageResult?.messageID;
  if (!messageID) return;

  setTimeout(() => {
    try {
      api.unsendMessage(messageID);
    } catch (error) {
      console.error("Lỗi tự gỡ tin nhắn help:", error);
    }
  }, AUTO_UNSEND_MS);
}

function resolveCommand(commandName) {
  const key = String(commandName || "").trim().toLowerCase();
  if (!key || !global.commands || !(global.commands instanceof Map)) return null;

  const direct = global.commands.get(commandName) || global.commands.get(key);
  if (direct) return direct;

  for (const command of global.commands.values()) {
    const names = [command?.name, command?.config?.name]
      .concat(command?.aliases || [])
      .concat(command?.config?.aliases || [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);

    if (names.includes(key)) {
      return command;
    }
  }

  return null;
}

module.exports = {
  name: "help",
  description: "Xem danh sách lệnh theo nhóm",
  usage: "\n!help → Xem danh sách tất cả lệnh theo nhóm\n!help [tên_lệnh] → Xem hướng dẫn chi tiết của 1 lệnh\n━{13}\n💡 Ví dụ: !help taixiu",
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
      const commandList = Array.from(global.commands.keys()).sort();
      const commandSet = new Set(commandList);

      const sections = [
        {
          title: "👑 ADMIN-BOT (Quản lý Bot)",
          commands: ["reset", "go", "ping", "mode", "setthue", "cmd"],
        },
        {
          title: "🛡️ QTV NHÓM (Quản lý Box)",
          commands: [
            "go", "kick", "anti", "setwelcome", "luatnhom", "checkbd", "setbd",
            "checkout"
          ],
        },
        {
          title: "👤 THƯỜNG DÂN",
          commands: [
            "thuebot", "help", "ai", "gỡ",
            "tien", "chuyentien", "bank", "lamviec", "diemdanh", "vay", "shop", "buy", "inv", "use", "openbox", "cuop", "daigia", "quest", // Kinh tế
            "taixiu", "baucua", "lode", "duoihinhbatchu", "tu", // Game
            "add", "grinfo", "checktt", "ghepdoi", "qtv", "adminbot", // Tiện ích nhóm
            "huongdan", "changelog", "dich", "say", "voice2text", "music", "vidgai", "đấm", "kiss", "uid" // Công cụ
          ],
        }
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
        let msg = `📜 DANH SÁCH LỆNH (${commandList.length})\n━━━━━━━━━━━━━\n\n`;

        grouped.forEach((section) => {
          msg += `[ ${section.title} ]\n👉 ${section.commands.join(", ")}\n\n`;
        });

        if (others.length > 0) {
          msg += `[ 📦 KHÁC ]\n👉 ${others.join(", ")}\n\n`;
        }

        msg += "━━━━━━━━━━━━━\n";
        msg += `📌 Xem chi tiết: ${prefix}help [tên lệnh]`;

        const sentMessage = await api.sendMessage(msg, threadID);
        scheduleAutoUnsend(api, sentMessage);
        return sentMessage;
      }

      // 2. Chi tiết từng lệnh
      const commandName = args[0].toLowerCase();
      const command = resolveCommand(commandName);

      if (!command) {
        return api.sendMessage(
          `❌ Lệnh "${commandName}" không tồn tại.`,
          threadID,
        );
      }

      const resolvedName = command.name || command.config?.name || commandName;
      const detailMsg =
        `ℹ️ LỆNH: ${resolvedName.toUpperCase()}\n` +
        `📝 Mô tả: ${command.description || "Chưa có"}\n` +
        `🛠️ Cách dùng: ${prefix}${resolvedName}${command.usage ? ` ${command.usage}` : ""}`;

      const sentMessage = await api.sendMessage(detailMsg, threadID);
      scheduleAutoUnsend(api, sentMessage);
      return sentMessage;
    } catch (e) {
      console.error("Lỗi Help:", e);
    }
  },
};
