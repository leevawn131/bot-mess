const axios = require("axios");
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "dich",
    description: "Dịch mọi ngôn ngữ sang tiếng Việt",
    usage: "\n!dich [đoạn cần dịch] → Dịch văn bản sang tiếng Việt\n!dich (reply) → Dịch nội dung tin nhắn được reply\n━{13}\n🌐 Tự động nhận diện ngôn ngữ gốc\n💡 Ví dụ: !dich Hello, how are you?",
    execute: async ({ api, event, args }) => {
        const { messageID, messageReply, senderID } = event;
        const threadID = String(event.threadID);

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "dich", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        let text = args.join(" ").trim();
        if (!text && messageReply && messageReply.body) {
            text = String(messageReply.body).trim();
        }

        if (!text) {
            return api.sendMessage("⚠️ Hãy nhập đoạn cần dịch hoặc reply tin nhắn cần dịch.", threadID, messageID);
        }

        if (text.length > 4000) {
            return api.sendMessage("⚠️ Đoạn cần dịch quá dài (tối đa 4000 ký tự).", threadID, messageID);
        }

        try {
            const encodedText = encodeURIComponent(text);
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodedText}`;

            const response = await axios.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0"
                }
            });

            const data = response.data;
            const translated = Array.isArray(data?.[0])
                ? data[0].map((item) => item[0]).join("")
                : "";

            if (!translated) {
                return api.sendMessage("❌ Không thể dịch lúc này. Hãy thử lại sau.", threadID, messageID);
            }

            const sourceLang = data?.[2] || "auto";
            const msg = `🌐 Dịch (${sourceLang} -> vi):\n${translated}`;
            return api.sendMessage(msg, threadID, messageID);
        } catch (e) {
            console.error("Lỗi dịch:", e);
            return api.sendMessage("❌ Lỗi khi dịch. Vui lòng thử lại sau.", threadID, messageID);
        }
    }
};
