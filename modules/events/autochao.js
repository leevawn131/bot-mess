const path = require("path");
const { isAutochaoEnabled } = require("../utils/autochaoSettings");

const GREETING_REGEX = /^(?:hi|hello|helo|hey|chào|xin\s+chào)(?:[!?.…]+)?$/i;
const GREETING_MESSAGES = [
  "Chào bạn!",
  "Hello bạn nhe!",
  "Hi hi, chúc bạn vui vẻ!",
  "Chào buổi đẹp trời!",
  "Xin chào, mình ở đây nhe!",
  "Hey! Chào bạn nha!",
  "Chào bạn, vào chơi vui nha!",
  "Hi! Chúc bạn một ngày tốt lành!",
  "Xin chào, có gì cần giúp khong?",
];

module.exports = {
  name: "greetingSticker",
  eventType: ["message"],

  run: async function(Obj) { return this.execute(Obj); },
    execute: async ({ api, event }) => {
    try {
      if (!event || !event.body) return;

      // Avoid reacting to bot's own messages
      const botId = String(api.getCurrentUserID && api.getCurrentUserID()).trim();
      if (String(event.senderID) === botId) return;

      const body = String(event.body || "").trim();
      if (!body) return;

      if (!isAutochaoEnabled(event.threadID)) return;

      // Only short messages (likely greetings)
      if (body.length > 40) return;

      if (!GREETING_REGEX.test(body)) return;

      // Rate limit per thread: at most one sticker per 5s
      global._greetingThrottle = global._greetingThrottle || {};
      const last = global._greetingThrottle[event.threadID] || 0;
      if (Date.now() - last < 5000) return;
      global._greetingThrottle[event.threadID] = Date.now();

      // Load sticker IDs from config (root config.json)
      let config = {};
      try {
        // module is at modules/events/ so go up two levels
        config = require(path.join(__dirname, "..", "..", "config.json"));
      } catch (e) {
        config = {};
      }

      const stickers = Array.isArray(config.greetingStickers) ? config.greetingStickers : [];
      if (!stickers || stickers.length === 0) {
        // No configured stickers — nothing to send
        return;
      }

      const pick = stickers[Math.floor(Math.random() * stickers.length)];

      // First send a short text greeting, then after a brief delay send the sticker
      const greeting =
        GREETING_MESSAGES[Math.floor(Math.random() * GREETING_MESSAGES.length)];
      try {
        await api.sendMessage(greeting, event.threadID);
      } catch (e) {}

      // small delay to avoid message merging
      await new Promise((r) => setTimeout(r, 700));

      // Send sticker. The fca/ws3-fca library accepts `{ sticker: stickerID }`.
      try {
        await api.sendMessage({ sticker: Number(pick) }, event.threadID);
      } catch (e) {}
    } catch (err) {
      // swallow errors to avoid crashing event loop
    }
  },
};
