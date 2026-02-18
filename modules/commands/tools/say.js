const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "say",
    description: "Chuyển tin nhắn được reply thành voice (giọng nói)",
    usage: "Reply tin nhắn bất kỳ và gõ !say",
    execute: async ({ api, event }) => {
        const { messageID, messageReply, senderID } = event;
        const threadID = String(event.threadID); // Ép kiểu chuỗi

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "say", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            // Kiểm tra xem có reply tin nhắn không
            if (!messageReply || !messageReply.body) {
                return api.sendMessage("⚠️ Vui lòng reply tin nhắn cần chuyển thành giọng nói!", threadID, messageID);
            }

            const text = messageReply.body.trim();

            // Kiểm tra độ dài text
            if (!text || text.length === 0) {
                return api.sendMessage("⚠️ Tin nhắn được reply trống!", threadID, messageID);
            }

            if (text.length > 500) {
                return api.sendMessage("⚠️ Tin nhắn quá dài (tối đa 500 ký tự).", threadID, messageID);
            }

            // Gửi thông báo đang xử lý
            api.sendMessage("🎤 Đang chuyển text thành giọng nói...", threadID);

            // Tạo file audio tạm
            const audioPath = path.join(__dirname, '../../cache', `say_${Date.now()}.mp3`);

            // Đảm bảo thư mục cache tồn tại
            const cacheDir = path.dirname(audioPath);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }

            try {
                // Sử dụng Google Translate TTS API (miễn phí, không cần API key)
                // Language: vi = Vietnamese, en = English
                const encodedText = encodeURIComponent(text);
                const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=vi&client=tw-ob`;

                // Tải audio về
                const response = await axios.get(ttsUrl, {
                    responseType: 'arraybuffer',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                // Lưu file audio
                const audioPath = path.join(__dirname, '../../cache', `say_${Date.now()}.mp3`);
                fs.writeFileSync(audioPath, Buffer.from(response.data));

                // Gửi file audio như tat.js làm với GIF
                api.sendMessage({
                    body: `🎤 Voice của bạn đây`,
                    attachment: [fs.createReadStream(audioPath)]
                }, threadID);
                
                // Xóa file sau 15 giây
                setTimeout(() => {
                    try {
                        if (fs.existsSync(audioPath)) {
                            fs.unlinkSync(audioPath);
                        }
                    } catch (e) {
                        console.error("Lỗi xóa file tạm:", e);
                    }
                }, 15000);

            } catch (ttsError) {
                console.error("Lỗi TTS:", ttsError);
                api.sendMessage("❌ Không thể chuyển text thành giọng nói. Vui lòng thử lại sau!", threadID);
            }

        } catch (e) {
            console.error("Lỗi say command:", e);
            api.sendMessage("❌ Lỗi hệ thống khi xử lý lệnh say.", threadID);
        }
    }
};
