const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pipeline } = require("@xenova/transformers");
const ffmpegPath = require("ffmpeg-static");
const { checkCooldown } = require("../../utils/cooldown");
const { consumeEnergy, getDBConfigFromRuntime } = require("../../utils/energySystem");
const { getConnection } = require("../../utils/database");

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DEFAULT_WHISPER_MODEL = "Xenova/whisper-small";
const DEFAULT_WHISPER_LANGUAGE = "vi";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";

let localWhisperPromise = null;
let localWhisperConfig = null;

function isHttpUrl(text) {
  try {
    const parsed = new URL(String(text || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getFileExtensionFromUrl(url, contentType = "") {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (ext) return ext;
  } catch {}

  const type = String(contentType || "").toLowerCase();
  if (type.includes("mpeg")) return ".mp3";
  if (type.includes("mp4")) return ".m4a";
  if (type.includes("wav")) return ".wav";
  if (type.includes("webm")) return ".webm";
  if (type.includes("ogg")) return ".ogg";
  return ".m4a";
}

function isAudioLikeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return false;

  const type = String(attachment.type || "").toLowerCase();
  if (["audio", "voice"].includes(type)) return true;

  const mimeType = String(attachment.mimeType || attachment.mimetype || "").toLowerCase();
  if (mimeType.startsWith("audio/")) return true;

  const url = String(attachment.url || "");
  const lowerUrl = url.toLowerCase();
  return /\.(m4a|mp3|mp4|wav|ogg|webm|aac|opus)(\?|#|$)/i.test(lowerUrl);
}

function getCandidateAudioSource(event, args) {
  const argText = args.join(" ").trim();
  if (isHttpUrl(argText)) {
    return { url: argText, label: "link" };
  }

  const replyAttachments = Array.isArray(event?.messageReply?.attachments)
    ? event.messageReply.attachments
    : [];
  const currentAttachments = Array.isArray(event?.attachments) ? event.attachments : [];
  const attachment = [...replyAttachments, ...currentAttachments].find(isAudioLikeAttachment);

  if (attachment?.url) {
    return { url: attachment.url, label: attachment.type || "audio" };
  }

  return null;
}

function getRemoteTranscriptionProvider() {
  const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (openaiKey) {
    return {
      name: "openai",
      apiKey: openaiKey,
      baseUrl: String(process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).trim(),
      model: String(process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1").trim(),
    };
  }

  const groqKey = String(process.env.GROQ_API_KEY || "").trim();
  if (groqKey) {
    return {
      name: "groq",
      apiKey: groqKey,
      baseUrl: String(process.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL).trim(),
      model: String(process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3").trim(),
    };
  }

  return null;
}

function getLocalWhisperSettings() {
  return {
    model: String(process.env.WHISPER_MODEL || DEFAULT_WHISPER_MODEL).trim(),
    language: String(process.env.WHISPER_LANGUAGE || DEFAULT_WHISPER_LANGUAGE).trim(),
    chunkLengthSeconds: Math.max(5, Number(process.env.WHISPER_CHUNK_LENGTH_S) || 30),
    strideLengthSeconds: Math.max(0, Number(process.env.WHISPER_STRIDE_LENGTH_S) || 5),
  };
}

async function downloadAudio(url, cacheDir) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
    maxContentLength: MAX_ATTACHMENT_BYTES,
    maxBodyLength: MAX_ATTACHMENT_BYTES,
  });

  const buffer = Buffer.from(response.data);
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error("File quá lớn để transcribe.");
  }

  const contentType = response.headers?.["content-type"] || "";
  const ext = getFileExtensionFromUrl(url, contentType);
  const filePath = path.join(cacheDir, `voice2text_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
  fs.writeFileSync(filePath, buffer);

  return { filePath, size: buffer.length };
}

function convertPcm16leToFloat32(buffer) {
  const samples = new Float32Array(buffer.length / 2);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = buffer.readInt16LE(i * 2);
    samples[i] = Math.max(-1, Math.min(1, sample / 32768));
  }
  return samples;
}

function runFfmpegDecode(filePath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("Không tìm thấy ffmpeg-static."));
      return;
    }

    const child = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "pipe:1",
    ]);

    const chunks = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

async function decodeAudioForWhisper(filePath) {
  const pcmBuffer = await runFfmpegDecode(filePath);
  if (!pcmBuffer.length) {
    throw new Error("Không thể giải mã audio.");
  }
  return convertPcm16leToFloat32(pcmBuffer);
}

async function getLocalWhisperPipeline() {
  const settings = getLocalWhisperSettings();
  const cacheKey = JSON.stringify(settings);

  if (localWhisperPromise && localWhisperConfig === cacheKey) {
    return localWhisperPromise;
  }

  localWhisperConfig = cacheKey;
  localWhisperPromise = pipeline("automatic-speech-recognition", settings.model, {
    dtype: "q8",
    quantized: true,
  });

  return localWhisperPromise;
}

async function transcribeLocally(filePath) {
  const settings = getLocalWhisperSettings();
  const transcriber = await getLocalWhisperPipeline();
  const audio = await decodeAudioForWhisper(filePath);

  const options = {
    task: "transcribe",
    chunk_length_s: settings.chunkLengthSeconds,
    stride_length_s: settings.strideLengthSeconds,
  };

  if (settings.language && settings.language !== "auto") {
    options.language = settings.language;
  }

  const result = await transcriber(audio, options);
  return String(result?.text || "").trim();
}

async function transcribeViaRemoteApi(filePath, provider) {
  const audioBuffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([audioBuffer]), path.basename(filePath));
  form.append("model", provider.model);

  const endpoint = new URL("audio/transcriptions", provider.baseUrl.endsWith("/") ? provider.baseUrl : `${provider.baseUrl}/`).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: form,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { error: { message: await response.text() } };

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || "Không thể transcribe audio.";
    throw new Error(message);
  }

  return String(payload?.text || "").trim();
}

async function transcribeAudioFile(filePath) {
  try {
    return await transcribeLocally(filePath);
  } catch (localError) {
    const provider = getRemoteTranscriptionProvider();
    if (!provider) {
      throw new Error(
        `Whisper local chưa sẵn sàng: ${localError.message || "lỗi không xác định"}`,
      );
    }

    return await transcribeViaRemoteApi(filePath, provider);
  }
}

module.exports = {
  name: "voice2text",
  description: "Chuyển audio/voice thành văn bản",
  usage:
    "\n!voice2text (reply voice/audio) → Chuyển file âm thanh được reply thành text\n!voice2text [link audio] → Chuyển audio từ link thành text\n━{13}\n🎙️ Hỗ trợ voice note, file audio, và link audio\n⚡ Tốn năng lượng mỗi lần dùng\n💡 Ví dụ: reply voice rồi gõ !voice2text",
  execute: async ({ api, event, args, config }) => {
    const threadID = String(event.threadID);
    const { messageID, senderID } = event;

    const cooldown = checkCooldown({
      command: "voice2text",
      key: "global",
      durationMs: 60000,
    });

    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    const source = getCandidateAudioSource(event, args);
    if (!source) {
      return api.sendMessage(
        "⚠️ Hãy reply vào voice/audio hoặc dán link audio để chuyển thành text.",
        threadID,
        messageID,
      );
    }

    const dbConfig = getDBConfigFromRuntime(config);
    if (!dbConfig) {
      return api.sendMessage("❌ Lỗi cấu hình Database.", threadID, messageID);
    }

    let energyConnection;
    try {
      energyConnection = await getConnection();
      const energyUse = await consumeEnergy(energyConnection, senderID, 20);
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
      console.error("Energy check error (voice2text):", error);
      return api.sendMessage("❌ Lỗi hệ thống thể lực.", threadID, messageID);
    } finally {
      if (energyConnection) energyConnection.release();
    }

    const cacheDir = path.resolve(__dirname, "../../../cache/voice2text");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    let audioPath = null;
    try {
      api.sendMessage(
        `⏳ Đang chuyển ${source.label === "link" ? "link audio" : "voice"} thành text...`,
        threadID,
        messageID,
      );

      const downloaded = await downloadAudio(source.url, cacheDir);
      audioPath = downloaded.filePath;

      const transcript = await transcribeAudioFile(audioPath);
      if (!transcript) {
        return api.sendMessage(
          "❌ Không nhận được nội dung từ audio này.",
          threadID,
          messageID,
        );
      }

      const text = transcript.length > 3500 ? `${transcript.slice(0, 3500)}...` : transcript;
      return api.sendMessage(
        `📝 Nội dung chuyển âm thành text:\n━{13}\n${text}`,
        threadID,
        messageID,
      );
    } catch (error) {
      console.error("Lỗi voice2text:", error);
      return api.sendMessage(
        `❌ Không thể chuyển audio thành text: ${error.message || "lỗi không xác định"}`,
        threadID,
        messageID,
      );
    } finally {
      if (audioPath) {
        try {
          if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        } catch (error) {
          console.error("Lỗi xóa file tạm voice2text:", error);
        }
      }
    }
  },
};