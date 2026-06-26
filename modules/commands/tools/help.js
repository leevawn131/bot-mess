const { checkCooldown } = require("../../utils/cooldown");
const config = require("../../../config.json");

const AUTO_UNSEND_MS = 60000;
const prefix = config?.prefix || "!";

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
  usage: `\n${prefix}help → Xem danh sách tất cả lệnh theo nhóm\n${prefix}help [tên_lệnh] → Xem hướng dẫn chi tiết của 1 lệnh\n━━━━━━━━━━━━━\n💡 Ví dụ: ${prefix}help taixiu`,
  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;

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
      const path = require("path");
      const commandsDir = path.resolve(__dirname, "..");

      const categoryNames = {
        "economy": "💰 KINH TẾ",
        "group": "🛡️ NHÓM",
        "minigame": "🎮 TRÒ CHƠI",
        "system": "👑 HỆ THỐNG",
        "tools": "🛠️ CÔNG CỤ",
        ".": "📦 KHÁC",
      };

      const categories = {};

      for (const [name, command] of global.commands.entries()) {
        let folder = ".";
        if (command.__filePath) {
          const relativePath = path.relative(commandsDir, command.__filePath);
          folder = path.dirname(relativePath);
        }
        const categoryKey = folder === "." ? "." : folder.toLowerCase();
        if (!categories[categoryKey]) {
          categories[categoryKey] = [];
        }
        categories[categoryKey].push(name);
      }

      const categoryOrder = ["system", "group", "economy", "minigame", "tools", "."];
      const sortedKeys = Object.keys(categories).sort((a, b) => {
        const indexA = categoryOrder.indexOf(a);
        const indexB = categoryOrder.indexOf(b);
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB;
        }
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
      });

      for (const key of sortedKeys) {
        categories[key].sort();
      }

      if (!args[0]) {
        let msg = `📜 DANH SÁCH LỆNH (${global.commands.size})\n━━━━━━━━━━━━━\n\n`;

        for (const key of sortedKeys) {
          const displayName = categoryNames[key] || `📂 ${key.toUpperCase()}`;
          const commandList = categories[key];
          if (commandList.length > 0) {
            msg += `[ ${displayName} ]\n👉 ${commandList.join(", ")}\n\n`;
          }
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
      const formattedUsage = command.usage
        ? command.usage.replace(/!([a-zA-Z0-9_\u00C0-\u1EF9]+)/g, `${prefix}$1`)
        : "";
      const detailMsg =
        `ℹ️ LỆNH: ${resolvedName.toUpperCase()}\n` +
        `📝 Mô tả: ${command.description || "Chưa có"}\n` +
        `🛠️ Cách dùng: ${prefix}${resolvedName}${formattedUsage ? ` ${formattedUsage}` : ""}`;

      const sentMessage = await api.sendMessage(detailMsg, threadID);
      scheduleAutoUnsend(api, sentMessage);
      return sentMessage;
    } catch (e) {
      console.error("Lỗi Help:", e);
    }
  },
};
