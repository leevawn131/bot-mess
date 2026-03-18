const axios = require('axios');
const { usage } = require('../group/kick');
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "ai",
    description: "Chat AI",
    usage : "\nCó 5 model, gpt, gemini, claude, mistral,llama (mặc định là GPT) \n!ai [lệnh] dể dùng.\n!ai [tên model] [lệnh] để dùng 4 model còn lại.",
    execute: async ({ api, event, args }) => {
        const threadID = String(event.threadID); // Ép kiểu chuỗi để tránh lỗi
        const { senderID, messageID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "ai", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }
        let query = args.join(" ");

        if (!query) return api.sendMessage("🤖 Nhập câu hỏi đi bạn.\nVD: !ai Kể chuyện ma", threadID);

        // --- XỬ LÝ CHỌN MODEL ---
        let model = 'openai'; 
        let displayModel = 'GPT-4o';

        const firstWord = args[0].toLowerCase();
        if (["gemini", "claude", "mistral", "llama"].includes(firstWord)) {
            model = firstWord;
            displayModel = firstWord.toUpperCase();
            query = args.slice(1).join(" "); 
        }

        if (!query) return api.sendMessage(`🤖 Bạn muốn hỏi ${displayModel} gì?`, threadID);

        // 1. Gửi tin nhắn "Đang nghĩ" (Không dùng callback để tránh lỗi)
        api.sendMessage(`🔍 ${displayModel} đang suy nghĩ...`, threadID);

        // 2. Gọi API
        try {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://text.pollinations.ai/${encodedQuery}?model=${model}`;

            const res = await axios.get(url);
            const answer = res.data;

            // 3. Gửi câu trả lời (Gửi tin mới, không reply tin cũ để tránh lỗi 1545012)
            api.sendMessage(`🤖 [${displayModel}]:\n━━━━━━━━━━━━━━━━━━\n${answer}`, threadID);

        } catch (e) {
            console.error(e);
            api.sendMessage("❌ AI đang quá tải hoặc lỗi mạng.", threadID);
        }
    }
};