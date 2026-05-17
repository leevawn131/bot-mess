const fs = require("fs");
const path = require("path");
const { checkCooldown } = require("../../utils/cooldown");

const CHANGELOG_PATH = path.join(__dirname, "../../../changelog.json");

function loadEntries() {
  try {
    if (!fs.existsSync(CHANGELOG_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(CHANGELOG_PATH, "utf8"));
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

function chunkText(lines, maxChars = 3500) {
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const next = `${current}${line}\n`;
    if (next.length > maxChars) {
      chunks.push(current.trimEnd());
      current = "";
    }
    current += `${line}\n`;
  }

  if (current.trim()) chunks.push(current.trimEnd());
  return chunks;
}

function normalizeEntry(raw) {
  const version = String(raw?.version || "N/A").trim();
  const date = String(raw?.date || "N/A").trim();
  const title = String(raw?.title || "Không có tiêu đề").trim();
  const changes = Array.isArray(raw?.changes)
    ? raw.changes.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  return { version, date, title, changes };
}

module.exports = {
  name: "changelog",
  description: "Xem lịch sử cập nhật: all hoặc newest",
  usage: "\n!changelog → Xem bản cập nhật mới nhất\n!changelog all → Xem toàn bộ lịch sử cập nhật\n━━━━━━━━━━━━━━━━━━\n📝 Hiển thị phiên bản, ngày, và nội dung thay đổi",
  execute: async ({ api, event, args }) => {
    const { threadID, messageID, senderID } = event;

    const cooldown = checkCooldown({
      command: "changelog",
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

    const mode = String(args?.[0] || "newest").toLowerCase();
    const entries = loadEntries().map(normalizeEntry);

    if (entries.length === 0) {
      return api.sendMessage(
        "📭 Chưa có dữ liệu changelog. Hãy thêm vào changelog.json",
        threadID,
        messageID,
      );
    }

    if (mode === "newest") {
      const latest = entries[0];
      const lines = [
        "📌 CHANGELOG MỚI NHẤT",
        "━━━━━━━━━━━━━━━━━━",
        `• Version: ${latest.version}`,
        `• Date: ${latest.date}`,
        `• Title: ${latest.title}`,
      ];

      if (latest.changes.length > 0) {
        lines.push("", "Chi tiết:");
        latest.changes.forEach((item) => lines.push(`- ${item}`));
      }

      return api.sendMessage(lines.join("\n"), threadID, messageID);
    }

    if (mode !== "all") {
      return api.sendMessage(
        "⚠️ Dùng: changelog (xem bản mới nhất) hoặc changelog all (xem tất cả)",
        threadID,
        messageID,
      );
    }

    const lines = ["📚 CHANGELOG TẤT CẢ", "━━━━━━━━━━━━━━━━━━"];

    entries.forEach((entry, idx) => {
      lines.push(`${idx + 1}. ${entry.version} | ${entry.date}`);
      lines.push(`   ${entry.title}`);
      if (entry.changes.length > 0) {
        entry.changes.forEach((item) => lines.push(`   - ${item}`));
      }
      lines.push("━━━━━━━━━━━━━━━━━━");
    });

    const chunks = chunkText(lines);
    for (let i = 0; i < chunks.length; i++) {
      await api.sendMessage(
        chunks[i],
        threadID,
        i === chunks.length - 1 ? messageID : undefined,
      );
    }
  },
};
