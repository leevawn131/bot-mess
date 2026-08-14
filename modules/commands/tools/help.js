const { checkCooldown } = require("../../utils/cooldown");
const config = require("../../../config.json");
const path = require("path");

const AUTO_UNSEND_MS = 60000;
const prefix = config?.prefix || "!";
const commandsDir = path.resolve(__dirname, "..");

const categoryNames = {
  "adminbot": "👑 ADMIN BOT",
  "economy": "💰 KINH TẾ",
  "group": "👥 NHÓM THƯỜNG",
  "qtv": "🛡️ QUẢN TRỊ VIÊN",
  "minigame": "🎮 TRÒ CHƠI",
  "tools": "🛠️ CÔNG CỤ",
  ".": "📦 KHÁC",
};

const categoryOrder = ["adminbot", "qtv", "group", "economy", "minigame", "tools", "."];

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

function getCategoriesMap() {
  const uniqueCommands = new Map();
  for (const [key, command] of global.commands.entries()) {
    const name = command.name || command.config?.name || key;
    uniqueCommands.set(name, command);
  }

  const categories = {};
  for (const command of uniqueCommands.values()) {
    let folder = ".";
    if (command.__filePath) {
      const relativePath = path.relative(commandsDir, command.__filePath);
      folder = path.dirname(relativePath);
    }
    const categoryKey = folder === "." ? "." : folder.toLowerCase();
    if (!categories[categoryKey]) {
      categories[categoryKey] = [];
    }
    categories[categoryKey].push(command);
  }

  // Sort commands within each category by name
  for (const key of Object.keys(categories)) {
    categories[key].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  return categories;
}

module.exports = {
  name: "help",
  description: "Xem danh sách lệnh theo nhóm (Hỗ trợ menu tương tác bằng cách reply)",
  usage: `\n${prefix}help → Xem danh mục lệnh của bot\n${prefix}help [tên_lệnh] → Xem hướng dẫn chi tiết của 1 lệnh\n━━━━━━━━━━━━━\n💡 Ví dụ: ${prefix}help taixiu`,
  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;
    const cmdPrefix = config?.prefix || prefix;

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
      const categories = getCategoriesMap();

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

      // 1. Nếu không truyền đối số -> hiển thị danh sách danh mục
      if (!args[0]) {
        let msg = `📜 DANH MỤC LỆNH BOT\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        sortedKeys.forEach((key, index) => {
          const displayName = categoryNames[key] || `📂 ${key.toUpperCase()}`;
          const count = categories[key].length;
          msg += `[${index + 1}] ${displayName} ➔ ${count} lệnh\n`;
        });
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `💬 Hướng dẫn: Reply số thứ tự danh mục để xem danh sách lệnh.\n`;
        msg += `⏱️ Tự động ẩn menu sau 60s.`;

        const sentMessage = await api.sendMessage(msg, threadID, messageID);

        if (!global.client) global.client = {};
        if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
        global.client.handleReply.push({
          name: "help",
          messageID: sentMessage.messageID,
          author: senderID,
          type: "select_category",
          categories: sortedKeys,
        });

        scheduleAutoUnsend(api, sentMessage);
        return sentMessage;
      }

      // 2. Nếu truyền đối số -> Tra cứu trực tiếp lệnh
      const commandName = args[0].toLowerCase();
      const command = resolveCommand(commandName);

      if (!command) {
        return api.sendMessage(
          `❌ Lệnh "${commandName}" không tồn tại.`,
          threadID,
          messageID,
        );
      }

      const resolvedName = command.name || command.config?.name || commandName;
      const formattedUsage = command.usage
        ? command.usage.replace(/!([a-zA-Z0-9_\u00C0-\u1EF9]+)/g, `${cmdPrefix}$1`)
        : "";

      let detailMsg = `ℹ️ CHI TIẾT LỆNH: ${resolvedName.toUpperCase()}\n`;
      detailMsg += `📝 Mô tả: ${command.description || "Chưa có mô tả chi tiết."}\n`;
      detailMsg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      detailMsg += `🛠️ HƯỚNG DẪN SỬ DỤNG:\n`;
      if (formattedUsage) {
        detailMsg += formattedUsage.trim();
      } else {
        detailMsg += `${cmdPrefix}${resolvedName}`;
      }
      detailMsg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
      detailMsg += `⏱️ Tự động ẩn hướng dẫn sau 60s.`;

      const sentMessage = await api.sendMessage(detailMsg, threadID, messageID);
      scheduleAutoUnsend(api, sentMessage);
      return sentMessage;
    } catch (e) {
      console.error("Lỗi Help execute:", e);
    }
  },
  handleReply: async ({ api, event, config }) => {
    const { threadID, senderID, messageID, body, messageReply } = event;
    const cmdPrefix = config?.prefix || prefix;
    if (!messageReply) return;

    const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
    const handleReplyContext = list.find(h => String(h.messageID) === String(messageReply.messageID) && h.name === "help");
    if (!handleReplyContext) return;

    const input = String(body || "").trim();
    const choice = parseInt(input);

    try {
      const categories = getCategoriesMap();

      // Bước 2: User chọn danh mục -> Hiển thị danh sách các lệnh trong danh mục
      if (handleReplyContext.type === "select_category") {
        if (isNaN(choice) || choice < 1 || choice > handleReplyContext.categories.length) {
          return api.sendMessage(`⚠️ Vui lòng reply số thứ tự hợp lệ từ 1 đến ${handleReplyContext.categories.length}.`, threadID, messageID);
        }

        const selectedCategoryKey = handleReplyContext.categories[choice - 1];
        const commandList = categories[selectedCategoryKey] || [];
        const displayName = categoryNames[selectedCategoryKey] || `📂 ${selectedCategoryKey.toUpperCase()}`;

        let msg = `📂 DANH SÁCH LỆNH\n`;
        msg += `📌 Danh mục: ${displayName}\n`;
        msg += `📊 Số lượng: ${commandList.length} lệnh\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

        const pad = (n) => (n < 10 ? `0${n}` : n);
        commandList.forEach((cmd, idx) => {
          msg += `[${pad(idx + 1)}] ${cmd.name} ➔ ${cmd.description || "Không có mô tả"}\n`;
        });
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `💬 Hướng dẫn: Reply số thứ tự lệnh để xem chi tiết cách dùng.\n`;
        msg += `⏱️ Tự động ẩn menu sau 60s.`;

        const sent = await api.sendMessage(msg, threadID, messageID);

        // Gỡ tin nhắn cũ của bước 1
        try {
          await api.unsendMessage(messageReply.messageID);
        } catch (e) { }

        // Dọn dẹp context handleReply cũ
        const index = list.findIndex(h => h.messageID === messageReply.messageID);
        if (index > -1) list.splice(index, 1);

        // Đẩy context mới cho bước tiếp theo
        global.client.handleReply.push({
          name: "help",
          messageID: sent.messageID,
          author: senderID,
          type: "select_command",
          commands: commandList.map(cmd => cmd.name),
        });

        scheduleAutoUnsend(api, sent);
        return;
      }

      // Bước 3: User chọn lệnh trong danh mục -> Hiển thị hướng dẫn sử dụng chi tiết
      if (handleReplyContext.type === "select_command") {
        if (isNaN(choice) || choice < 1 || choice > handleReplyContext.commands.length) {
          return api.sendMessage(`⚠️ Vui lòng reply số thứ tự hợp lệ từ 1 đến ${handleReplyContext.commands.length}.`, threadID, messageID);
        }

        const selectedCommandName = handleReplyContext.commands[choice - 1];
        const command = resolveCommand(selectedCommandName);

        if (!command) {
          return api.sendMessage(`❌ Lệnh "${selectedCommandName}" không tồn tại hoặc đã bị gỡ.`, threadID, messageID);
        }

        const resolvedName = command.name || command.config?.name || selectedCommandName;
        const formattedUsage = command.usage
          ? command.usage.replace(/!([a-zA-Z0-9_\u00C0-\u1EF9]+)/g, `${cmdPrefix}$1`)
          : "";

        let detailMsg = `ℹ️ CHI TIẾT LỆNH: ${resolvedName.toUpperCase()}\n`;
        detailMsg += `📝 Mô tả: ${command.description || "Chưa có mô tả chi tiết."}\n`;
        detailMsg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        detailMsg += `🛠️ HƯỚNG DẪN SỬ DỤNG:\n`;
        if (formattedUsage) {
          detailMsg += formattedUsage.trim();
        } else {
          detailMsg += `${cmdPrefix}${resolvedName}`;
        }
        detailMsg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        detailMsg += `⏱️ Tự động ẩn hướng dẫn sau 60s.`;

        const sent = await api.sendMessage(detailMsg, threadID, messageID);

        // Gỡ tin nhắn danh sách lệnh cũ của bước 2
        try {
          await api.unsendMessage(messageReply.messageID);
        } catch (e) { }

        // Dọn dẹp context handleReply cũ
        const index = list.findIndex(h => h.messageID === messageReply.messageID);
        if (index > -1) list.splice(index, 1);

        scheduleAutoUnsend(api, sent);
        return;
      }
    } catch (e) {
      console.error("Lỗi handleReply Help:", e);
    }
  }
};
