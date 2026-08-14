const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const LanguageDetect = require("languagedetect");
const lngDetector = new LanguageDetect();
const fs = require("fs");
const path = require("path");
const { execute, getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const {
  consumeEnergy,
  getDBConfigFromRuntime,
} = require("../../utils/energySystem");

const MAX_INPUT_CHARS = 10000;

const VOICE_MAP = {
  vietnamese: { voice: "vi-VN-HoaiMyNeural", name: "Tiếng Việt (Hoài My)" },
  english: { voice: "en-US-AvaNeural", name: "Tiếng Anh (Ava)" },
  japanese: { voice: "ja-JP-NanamiNeural", name: "Tiếng Nhật (Nanami)" },
  korean: { voice: "ko-KR-SunHiNeural", name: "Tiếng Hàn (Sun-Hi)" },
  chinese: { voice: "zh-CN-XiaoxiaoNeural", name: "Tiếng Trung (Xiaoxiao)" },
  french: { voice: "fr-FR-DeniseNeural", name: "Tiếng Pháp (Denise)" },
  german: { voice: "de-DE-KatjaNeural", name: "Tiếng Đức (Katja)" },
  spanish: { voice: "es-ES-ElviraNeural", name: "Tiếng Tây Ban Nha (Elvira)" },
  thai: { voice: "th-TH-PremwadeeNeural", name: "Tiếng Thái (Premwadee)" },
  russian: { voice: "ru-RU-SvetlanaNeural", name: "Tiếng Nga (Svetlana)" },
};

function detectVoiceInfo(text) {
  if (!text) return VOICE_MAP.vietnamese;

  // 1. Kiểm tra Unicode đặc thù cho các ngôn ngữ hệ chữ riêng
  if (/[\u3040-\u30ff]/.test(text)) return VOICE_MAP.japanese;
  if (/[\uac00-\ud7af]/.test(text)) return VOICE_MAP.korean;
  if (/[\u4e00-\u9faf]/.test(text)) return VOICE_MAP.chinese;
  if (/[\u0e00-\u0e7f]/.test(text)) return VOICE_MAP.thai;
  if (/[\u0400-\u04ff]/.test(text)) return VOICE_MAP.russian;

  // 2. Kiểm tra dấu thanh tiếng Việt
  const viRegex = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
  if (viRegex.test(text)) return VOICE_MAP.vietnamese;

  // 3. Phân tích ngữ cảnh bộ chữ Latin
  try {
    const detected = lngDetector.detect(text, 3);
    if (Array.isArray(detected) && detected.length > 0) {
      for (const [langName] of detected) {
        const lower = langName.toLowerCase();
        if (lower.includes("english")) return VOICE_MAP.english;
        if (lower.includes("french")) return VOICE_MAP.french;
        if (lower.includes("german")) return VOICE_MAP.german;
        if (lower.includes("spanish")) return VOICE_MAP.spanish;
      }
    }
  } catch (e) {
    // Thư viện phát hiện lỗi -> bỏ qua
  }

  // 4. Kiểm tra từ tiếng Anh thông dụng
  if (/\b(hello|hi|hey|thanks|thank you|welcome|good morning|good night|bot|please|yes|no)\b/i.test(text)) {
    return VOICE_MAP.english;
  }

  // Mặc định là Tiếng Việt
  return VOICE_MAP.vietnamese;
}

module.exports = {
  name: "say",
  description: "Chuyển tin nhắn được reply thành voice (giọng nói) chất lượng cao Microsoft Edge TTS & Tự động nhận diện ngôn ngữ",
  usage: "\n!say (reply tin nhắn) → Chuyển nội dung reply thành giọng nói Neural\n━━━━━━━━━━━━━\n🎙️ Reply tin nhắn bất kỳ rồi gõ !say\n⚡ Tốn 20 năng lượng mỗi lần dùng\n🌐 Tự động nhận diện ngôn ngữ (Việt, Anh, Nhật, Hàn, Trung, Pháp, Đức...)",
  execute: async ({ api, event, config }) => {
    const { messageID, messageReply, senderID } = event;
    const threadID = String(event.threadID);

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
      // Kiểm tra reply tin nhắn
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
        energyUse = await consumeEnergy(connection, String(threadID), senderID, 20);
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

      if (!text || text.length === 0) {
        return api.sendMessage(
          "⚠️ Tin nhắn được reply trống!",
          threadID,
          messageID,
        );
      }

      if (text.length > MAX_INPUT_CHARS) {
        return api.sendMessage(
          `⚠️ Tin nhắn quá dài (tối đa ${MAX_INPUT_CHARS.toLocaleString("vi-VN")} ký tự).`,
          threadID,
          messageID,
        );
      }

      // Phát hiện ngôn ngữ và chọn giọng phù hợp
      const voiceInfo = detectVoiceInfo(text);

      // Đảm bảo thư mục cache tồn tại
      const cacheDir = path.join(__dirname, "../../cache");
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      const audioPath = path.join(cacheDir, `say_${Date.now()}_${senderID}.mp3`);

      try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(voiceInfo.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

        const { audioStream } = tts.toStream(text);
        const writeStream = fs.createWriteStream(audioPath);

        audioStream.pipe(writeStream);

        await new Promise((resolve, reject) => {
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
          audioStream.on("error", reject);
        });

        await api.sendMessage(
          {
            body: `🎤 Voice (${voiceInfo.name})\n⚡ Thể lực: -20 (${energyUse.energy}/${energyUse.maxEnergy})`,
            attachment: [fs.createReadStream(audioPath)],
          },
          threadID,
          messageID,
        );
      } catch (ttsError) {
        console.error("Lỗi Edge TTS:", ttsError);
        api.sendMessage(
          "❌ Không thể tạo giọng nói từ Microsoft Edge TTS. Vui lòng thử lại sau!",
          threadID,
          messageID,
        );
      } finally {
        // Xóa file tạm sau 15 giây
        setTimeout(() => {
          try {
            if (fs.existsSync(audioPath)) {
              fs.unlinkSync(audioPath);
            }
          } catch (e) {
            console.error("Lỗi xóa file tạm say:", e);
          }
        }, 15000);
      }
    } catch (e) {
      console.error("Lỗi say command:", e);
      api.sendMessage("❌ Lỗi hệ thống khi xử lý lệnh say.", threadID, messageID);
    }
  },
};


