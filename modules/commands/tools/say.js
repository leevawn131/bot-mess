const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execute, getConnection } = require("../../utils/database");
let googleTTS = null;
try {
  const loaded = require("google-tts-api");
  googleTTS = loaded?.default || loaded;
} catch (e) {
  // Keep command alive and show a clear runtime message instead of crashing on require.
  googleTTS = null;
}
const { checkCooldown } = require("../../utils/cooldown");
const {
  consumeEnergy,
  getDBConfigFromRuntime,
} = require("../../utils/energySystem");

const MAX_INPUT_CHARS = 20000;
const MAX_TTS_CHARS_PER_CHUNK = 420;

function splitTextIntoChunks(text, maxLen = MAX_TTS_CHARS_PER_CHUNK) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chunks = [];
  let remaining = normalized;

  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf(". ", maxLen);
    if (cut < Math.floor(maxLen * 0.5))
      cut = remaining.lastIndexOf(", ", maxLen);
    if (cut < Math.floor(maxLen * 0.5))
      cut = remaining.lastIndexOf(" ", maxLen);
    if (cut < Math.floor(maxLen * 0.5)) cut = maxLen;

    const part = remaining.slice(0, cut).trim();
    if (part) chunks.push(part);
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

module.exports = {
  name: "say",
  description: "Chuyển tin nhắn được reply thành voice (giọng nói)",
  usage: "\n!say (reply tin nhắn) → Chuyển nội dung được reply thành giọng nói\n━━━━━━━━━━━━━━━━━━\n🎙️ Reply tin nhắn bất kỳ rồi gõ !say\n⚡ Tốn năng lượng mỗi lần dùng\n📌 Hỗ trợ tiếng Việt, tối đa 20,000 ký tự",
  execute: async ({ api, event, config }) => {
    const { messageID, messageReply, senderID } = event;
    const threadID = String(event.threadID); // Ép kiểu chuỗi

    // Cooldown 20s
    const cooldown = checkCooldown({
      command: "say",
      key: senderID,
      durationMs: 20000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    try {
      if (!googleTTS || typeof googleTTS.getAudioUrl !== "function") {
        return api.sendMessage(
          "❌ Thiếu thư viện google-tts-api. Hãy cài: npm install google-tts-api",
          threadID,
          messageID,
        );
      }

      // Kiểm tra xem có reply tin nhắn không
      if (!messageReply || !messageReply.body) {
        return api.sendMessage(
          "⚠️ Vui lòng reply tin nhắn cần chuyển thành giọng nói!",
          threadID,
          messageID,
        );
      }

      const dbConfig = getDBConfigFromRuntime(config);
      if (!dbConfig) {
        return api.sendMessage(
          "❌ Lỗi cấu hình Database.",
          threadID,
          messageID,
        );
      }

      let energyUse;
      let connection;
      try {
        connection = await getConnection();
        energyUse = await consumeEnergy(connection, senderID, 20);
        if (!energyUse.ok) {
          if (energyUse.reason === "not_enough") {
            return api.sendMessage(energyUse.message, threadID, messageID);
          }
          return api.sendMessage(
            "❌ Không thể kiểm tra thể lực lúc này.",
            threadID,
            messageID,
          );
        }
      } catch (error) {
        console.error("Energy check error (say):", error);
        return api.sendMessage("❌ Lỗi hệ thống thể lực.", threadID, messageID);
      } finally {
        if (connection) connection.release();
      }

      const text = messageReply.body.trim();

      // Kiểm tra độ dài text
      if (!text || text.length === 0) {
        return api.sendMessage(
          "⚠️ Tin nhắn được reply trống!",
          threadID,
          messageID,
        );
      }

      if (text.length > MAX_INPUT_CHARS) {
        return api.sendMessage(
          `⚠️ Tin nhắn quá dài (tối đa ${MAX_INPUT_CHARS.toLocaleString()} ký tự).`,
          threadID,
          messageID,
        );
      }

      // Tách đoạn dài hơn mặc định để giảm số phần voice
      const ttsParts = splitTextIntoChunks(text);

      if (!Array.isArray(ttsParts) || ttsParts.length === 0) {
        return api.sendMessage(
          "❌ Không thể tạo voice từ nội dung này.",
          threadID,
          messageID,
        );
      }

      // Giới hạn số phần gửi để tránh spam quá mức
      if (ttsParts.length > 60) {
        return api.sendMessage(
          "⚠️ Nội dung quá dài để gửi voice. Hãy rút gọn bớt nhé.",
          threadID,
          messageID,
        );
      }

      // Gửi thông báo đang xử lý
      api.sendMessage(
        `🎤 Đang chuyển text thành giọng nói (ít nhất ${ttsParts.length} phần)...\n⚡ Thể lực: -20 (${energyUse.energy}/${energyUse.maxEnergy})`,
        threadID,
      );

      // Đảm bảo thư mục cache tồn tại
      const cacheDir = path.join(__dirname, "../../cache");
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      try {
        const queue = [...ttsParts];
        const sentParts = [];

        while (queue.length > 0) {
          const partText = queue.shift();

          let ttsUrl;
          try {
            ttsUrl = googleTTS.getAudioUrl(partText, {
              lang: "vi",
              slow: false,
              host: "https://translate.google.com",
            });
          } catch (buildErr) {
            // Nếu đoạn quá dài gây lỗi, tự chia nhỏ thêm
            if (partText.length > 100) {
              const mid = Math.floor(partText.length / 2);
              const splitAt =
                partText.lastIndexOf(" ", mid) > 0
                  ? partText.lastIndexOf(" ", mid)
                  : mid;
              const left = partText.slice(0, splitAt).trim();
              const right = partText.slice(splitAt).trim();
              if (right) queue.unshift(right);
              if (left) queue.unshift(left);
              continue;
            }
            throw buildErr;
          }

          const response = await axios.get(ttsUrl, {
            responseType: "arraybuffer",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          const index = sentParts.length;
          const audioPath = path.join(
            cacheDir,
            `say_${Date.now()}_${index}.mp3`,
          );
          fs.writeFileSync(audioPath, Buffer.from(response.data));

          sentParts.push(audioPath);

          await api.sendMessage(
            {
              body: `🎤 Voice của bạn (phần ${index + 1})`,
              attachment: [fs.createReadStream(audioPath)],
            },
            threadID,
          );

          setTimeout(() => {
            try {
              if (fs.existsSync(audioPath)) {
                fs.unlinkSync(audioPath);
              }
            } catch (e) {
              console.error("Lỗi xóa file tạm:", e);
            }
          }, 15000);
        }
      } catch (ttsError) {
        console.error("Lỗi TTS:", ttsError);
        api.sendMessage(
          "❌ Không thể chuyển text thành giọng nói. Vui lòng thử lại sau!",
          threadID,
        );
      }
    } catch (e) {
      console.error("Lỗi say command:", e);
      api.sendMessage("❌ Lỗi hệ thống khi xử lý lệnh say.", threadID);
    }
  },
};
