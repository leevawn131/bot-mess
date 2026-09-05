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
  const messageID = messageResult?.messageID || messageResult?.id;
  if (!messageID) return;

  setTimeout(async () => {
    try {
      if (typeof api.unsendMessage === "function") {
        await api.unsendMessage(messageID).catch(() => {});
      }
    } catch (error) {}
  }, AUTO_UNSEND_MS);
}

function resolveCommand(commandName) {
  const key = String(commandName || "").trim().toLowerCase();
  const cmds = (global.commands instanceof Map) ? global.commands : (global.client?.commands instanceof Map ? global.client.commands : null);
  if (!key || !cmds) return null;

  const direct = cmds.get(commandName) || cmds.get(key);
  if (direct) return direct;

  for (const command of cmds.values()) {
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
  const cmds = (global.commands instanceof Map) ? global.commands : (global.client?.commands instanceof Map ? global.client.commands : null);
  if (cmds) {
    for (const [key, command] of cmds.entries()) {
      const name = command.name || command.config?.name || key;
      uniqueCommands.set(name, command);
    }
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

const COMMANDS_PER_PAGE = 10;

function buildCategoryPageMessage(selectedCategoryKey, page, categories) {
  const commandList = categories[selectedCategoryKey] || [];
  const totalPages = Math.ceil(commandList.length / COMMANDS_PER_PAGE) || 1;
  const currentPage = Math.max(1, Math.min(page, totalPages));

  const startIndex = (currentPage - 1) * COMMANDS_PER_PAGE;
  const endIndex = Math.min(startIndex + COMMANDS_PER_PAGE, commandList.length);
  const pageCommands = commandList.slice(startIndex, endIndex);

  const displayName = categoryNames[selectedCategoryKey] || `📂 ${selectedCategoryKey.toUpperCase()}`;

  let msg = `📂 DANH SÁCH LỆNH\n`;
  msg += `📌 Danh mục: ${displayName}\n`;
  msg += `📊 Trang: [${currentPage}/${totalPages}] (Tổng ${commandList.length} lệnh)\n`;
  msg += `━━━━━━━━━━━━━\n`;

  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  pageCommands.forEach((cmd, idx) => {
    const globalIdx = startIndex + idx + 1;
    msg += `[${pad(globalIdx)}] ${cmd.name} ➔ ${cmd.description || "Không có mô tả"}\n`;
  });
  msg += `━━━━━━━━━━━━━\n`;
  msg += `💬 Hướng dẫn:\n`;
  msg += `  • Reply số thứ tự lệnh (1-${commandList.length}) để xem chi tiết.\n`;
  if (totalPages > 1) {
    msg += `  • Reply "trang <số>" (hoặc "p <số>") để đổi trang (1-${totalPages}).\n`;
  }
  msg += `⏱️ Tự động ẩn menu sau 60s.`;

  return { msg, totalPages, currentPage, commandList };
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
      durationMs: 5000,
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
        msg += `━━━━━━━━━━━━━\n`;
        sortedKeys.forEach((key, index) => {
          const displayName = categoryNames[key] || `📂 ${key.toUpperCase()}`;
          const count = categories[key].length;
          msg += `[${index + 1}] ${displayName} ➔ ${count} lệnh\n`;
        });
        msg += `━━━━━━━━━━━━━\n`;
        msg += `💬 Hướng dẫn: Reply số thứ tự danh mục để xem danh sách lệnh.\n`;
        msg += `⏱️ Tự động ẩn menu sau 60s.`;

        const info = await api.sendMessage(msg, threadID);
        if (info && info.messageID) {
          if (!global.client) global.client = {};
          if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
          global.client.handleReply.push({
            name: "help",
            messageID: info.messageID,
            author: senderID,
            type: "select_category",
            categories: sortedKeys,
          });
          scheduleAutoUnsend(api, info);
        }
        return;
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
      detailMsg += `━━━━━━━━━━━━━\n`;
      detailMsg += `🛠️ HƯỚNG DẪN SỬ DỤNG:\n`;
      if (formattedUsage) {
        detailMsg += formattedUsage.trim();
      } else {
        detailMsg += `${cmdPrefix}${resolvedName}`;
      }
      detailMsg += `\n━━━━━━━━━━━━━\n`;
      detailMsg += `⏱️ Tự động ẩn hướng dẫn sau 60s.`;

      const info = await api.sendMessage(detailMsg, threadID);
      if (info) {
        scheduleAutoUnsend(api, info);
      }
      return;
    } catch (e) {
      console.error("Lỗi Help execute:", e);
    }
  },
  handleReply: async ({ api, event, config, handleReply }) => {
    const { threadID, senderID, messageID, body, messageReply } = event;
    const cmdPrefix = config?.prefix || prefix;
    if (!messageReply) return;

    const repliedText = String(messageReply.body || "");
    const isCategoryMenu = repliedText.includes("DANH MỤC LỆNH BOT");
    const isCommandList = repliedText.includes("DANH SÁCH LỆNH");

    if (!isCategoryMenu && !isCommandList && (!handleReply || handleReply.name !== "help")) {
      return;
    }

    const input = String(body || "").trim();

    try {
      const categories = getCategoriesMap();
      const sortedKeys = Object.keys(categories).sort((a, b) => {
        const indexA = categoryOrder.indexOf(a);
        const indexB = categoryOrder.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
      });

      // Bước 2: User chọn danh mục từ menu danh mục
      if (isCategoryMenu || (handleReply && handleReply.type === "select_category")) {
        const choice = parseInt(input, 10);
        if (isNaN(choice) || choice < 1 || choice > sortedKeys.length) {
          return api.sendMessage(`⚠️ Vui lòng reply số thứ tự hợp lệ từ 1 đến ${sortedKeys.length}.`, threadID, messageID);
        }

        const selectedCategoryKey = sortedKeys[choice - 1];
        const { msg, totalPages, currentPage, commandList } = buildCategoryPageMessage(selectedCategoryKey, 1, categories);

        // Gỡ tin nhắn menu cũ
        try {
          if (messageReply.messageID && typeof api.unsendMessage === "function") {
            await api.unsendMessage(messageReply.messageID).catch(() => {});
          }
        } catch (e) {}

        // Dọn dẹp context cũ trong global.client.handleReply nếu có
        if (global.client && Array.isArray(global.client.handleReply)) {
          const index = global.client.handleReply.findIndex(h => String(h.messageID) === String(messageReply.messageID));
          if (index > -1) global.client.handleReply.splice(index, 1);
        }

        // Gửi danh sách lệnh
        const sent = await api.sendMessage(msg, threadID);
        if (sent && sent.messageID) {
          if (!global.client) global.client = {};
          if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
          global.client.handleReply.push({
            name: "help",
            messageID: sent.messageID,
            author: senderID,
            type: "select_command",
            categoryKey: selectedCategoryKey,
            currentPage: currentPage,
            totalPages: totalPages,
            commands: commandList.map(cmd => cmd.name),
          });
          scheduleAutoUnsend(api, sent);
        }
        return;
      }

      // Bước 3: User chọn lệnh HOẶC đổi trang trong danh mục
      if (isCommandList || (handleReply && handleReply.type === "select_command")) {
        // Xác định categoryKey hiện tại
        let selectedCategoryKey = handleReply?.categoryKey;
        if (!selectedCategoryKey) {
          for (const key of sortedKeys) {
            const catName = categoryNames[key] || key;
            if (repliedText.includes(catName) || repliedText.toLowerCase().includes(key)) {
              selectedCategoryKey = key;
              break;
            }
          }
        }
        if (!selectedCategoryKey) selectedCategoryKey = "adminbot";

        const commandList = categories[selectedCategoryKey] || [];
        const totalPages = Math.ceil(commandList.length / COMMANDS_PER_PAGE) || 1;

        // Trích xuất trang hiện tại từ văn bản menu (Trang: [x/y])
        let currentPage = 1;
        const pageHeaderMatch = repliedText.match(/Trang:\s*\[(\d+)\/(\d+)\]/i);
        if (pageHeaderMatch) {
          currentPage = parseInt(pageHeaderMatch[1], 10);
        }

        // 3.1 Kiểm tra xem người dùng có muốn ĐỔI TRANG không
        const pageMatch = input.match(/^(?:trang|page|p|t)\s*(\d+)$/i);
        let targetPage = null;

        if (pageMatch) {
          targetPage = parseInt(pageMatch[1], 10);
        } else if (/^(?:next|sau|tiep|tiếp)$/i.test(input)) {
          targetPage = currentPage + 1;
        } else if (/^(?:prev|truoc|trước|back)$/i.test(input)) {
          targetPage = currentPage - 1;
        }

        if (targetPage !== null) {
          if (isNaN(targetPage) || targetPage < 1 || targetPage > totalPages) {
            return api.sendMessage(`⚠️ Số trang không hợp lệ. Danh mục này có từ trang 1 đến ${totalPages}.`, threadID, messageID);
          }

          const { msg, currentPage: newCurrentPage } = buildCategoryPageMessage(selectedCategoryKey, targetPage, categories);

          try {
            if (messageReply.messageID && typeof api.unsendMessage === "function") {
              await api.unsendMessage(messageReply.messageID).catch(() => {});
            }
          } catch (e) {}

          if (global.client && Array.isArray(global.client.handleReply)) {
            const index = global.client.handleReply.findIndex(h => String(h.messageID) === String(messageReply.messageID));
            if (index > -1) global.client.handleReply.splice(index, 1);
          }

          const sent = await api.sendMessage(msg, threadID);
          if (sent && sent.messageID) {
            if (!global.client) global.client = {};
            if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
            global.client.handleReply.push({
              name: "help",
              messageID: sent.messageID,
              author: senderID,
              type: "select_command",
              categoryKey: selectedCategoryKey,
              currentPage: newCurrentPage,
              totalPages: totalPages,
              commands: commandList.map(c => c.name),
            });
            scheduleAutoUnsend(api, sent);
          }
          return;
        }

        // 3.2 Người dùng chọn SỐ THỨ TỰ LỆNH
        const choice = parseInt(input, 10);
        if (isNaN(choice) || choice < 1 || choice > commandList.length) {
          let warnMsg = `⚠️ Vui lòng reply số thứ tự lệnh từ 1 đến ${commandList.length}`;
          if (totalPages > 1) {
            warnMsg += ` hoặc "trang <số>" để chuyển trang.`;
          } else {
            warnMsg += `.`;
          }
          return api.sendMessage(warnMsg, threadID, messageID);
        }

        const selectedCommandObj = commandList[choice - 1];
        const selectedCommandName = selectedCommandObj?.name;
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
        detailMsg += `━━━━━━━━━━━━━\n`;
        detailMsg += `🛠️ HƯỚNG DẪN SỬ DỤNG:\n`;
        if (formattedUsage) {
          detailMsg += formattedUsage.trim();
        } else {
          detailMsg += `${cmdPrefix}${resolvedName}`;
        }
        detailMsg += `\n━━━━━━━━━━━━━\n`;
        detailMsg += `⏱️ Tự động ẩn hướng dẫn sau 60s.`;

        try {
          if (messageReply.messageID && typeof api.unsendMessage === "function") {
            await api.unsendMessage(messageReply.messageID).catch(() => {});
          }
        } catch (e) {}

        if (global.client && Array.isArray(global.client.handleReply)) {
          const index = global.client.handleReply.findIndex(h => String(h.messageID) === String(messageReply.messageID));
          if (index > -1) global.client.handleReply.splice(index, 1);
        }

        const sent = await api.sendMessage(detailMsg, threadID);
        if (sent && sent.messageID) {
          scheduleAutoUnsend(api, sent);
        }
        return;
      }
    } catch (e) {
      console.error("Lỗi handleReply Help:", e);
    }
  }
};
