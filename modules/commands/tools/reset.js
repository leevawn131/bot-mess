const fs = require("fs");
const path = require("path");
const { checkCooldown } = require("../../utils/cooldown");

function detectRuntime() {
  const isPm2 =
    typeof process.env.pm_id !== "undefined" || !!process.env.PM2_HOME;
  const isNodemon =
    process.env.NODEMON === "true" ||
    (process.env.npm_lifecycle_script || "").includes("nodemon");
  return { isPm2, isNodemon };
}

function triggerFileRestart() {
  const indexPath = path.join(__dirname, "../../../index.js");
  const now = new Date();

  // Ưu tiên chạm mtime file chính để nodemon chắc chắn bắt được thay đổi.
  fs.utimesSync(indexPath, now, now);
}

module.exports = {
  name: "reset",
  description: "Khởi động lại Bot và thông báo khi thành công",
  execute: async ({ api, event, args, config }) => {
    const { threadID, senderID, messageID } = event;
    const adminIDs = config.adminIDs || [];

    // Cooldown 5s
    const cooldown = checkCooldown({
      command: "reset",
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

    if (!adminIDs.map((id) => String(id)).includes(String(senderID))) {
      return api.sendMessage("⚠️ Chỉ Chủ bot mới được reset bot.", threadID);
    }

    try {
      // Lưu ID nhóm vào file tạm trước khi thoát
      const resetPath = path.join(__dirname, "../../../reset_data.json");
      fs.writeFileSync(
        resetPath,
        JSON.stringify({
          threadID: threadID,
          time: Date.now(),
        }),
      );

      const { isPm2, isNodemon } = detectRuntime();
      const runtimeName = isPm2
        ? "PM2"
        : isNodemon
          ? "nodemon"
          : "nodemon/local";
      api.sendMessage(
        `🔄 Đang khởi động lại hệ thống (${runtimeName})... Vui lòng chờ.`,
        threadID,
      );

      setTimeout(() => {
        // PM2: exit để PM2 tự spawn process mới.
        if (isPm2) {
          process.exit(0);
          return;
        }

        // nodemon/local: chạm file index.js để watcher tự restart (không làm app crash).
        try {
          triggerFileRestart();
        } catch (_) {
          process.exit(1);
        }
      }, 2000);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  },
};
