const { exec, execSync } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { getConnection } = require("../../utils/database");
const {
  consumeEnergy,
  readAndSyncEnergy,
} = require("../../utils/energySystem");

const SEARCH_CACHE_TTL = 5 * 60 * 1000;

// ==========================================
// 🛠️ YT-DLP CLI HELPERS
// ==========================================

function getYtDlpBaseCommand() {
  const envBin = String(process.env.YTDLP_BIN || "").trim();
  if (envBin) return `"${envBin}"`;
  const venvPython = path.resolve(__dirname, "../../../.venv/bin/python");
  if (fs.existsSync(venvPython)) return `"${venvPython}" -m yt_dlp`;
  return "yt-dlp";
}

function getYtDlpCookieArg() {
  const candidates = [
    process.env.YTDLP_COOKIES_FILE,
    path.resolve(__dirname, "../../../youtube_cookies.txt"),
    path.resolve(__dirname, "../../../cache/youtube_cookies.txt"),
    path.resolve(process.cwd(), "youtube_cookies.txt"),
    path.resolve(process.cwd(), "cache/youtube_cookies.txt"),
    path.resolve(process.env.HOME || "", ".config/yt-dlp/cookies.txt"),
  ].filter(Boolean);

  for (const cookieFile of candidates) {
    try {
      if (fs.existsSync(cookieFile) && fs.statSync(cookieFile).size > 0) {
        return `--cookies "${cookieFile}"`;
      }
    } catch (_) {}
  }
  return "";
}

function getYtDlpJsRuntimeArg() {
  const envNode = String(process.env.YTDLP_NODE_BIN || "").trim();
  if (envNode && fs.existsSync(envNode)) return `--js-runtimes "node:${envNode}"`;
  const execPath = String(process.execPath || "").trim();
  if (execPath && fs.existsSync(execPath)) return `--js-runtimes "node:${execPath}"`;
  return `--js-runtimes node`;
}

function buildYtDlpCommand(mainArgs, cacheDir) {
  const defaultCacheDir = path.resolve(__dirname, "../../../cache/music");
  const targetDir = cacheDir || defaultCacheDir;
  if (!fs.existsSync(targetDir)) {
    try { fs.mkdirSync(targetDir, { recursive: true }); } catch (_) {}
  }
  const cookie = getYtDlpCookieArg();
  const jsRuntime = getYtDlpJsRuntimeArg();
  const extra = [
    cookie,
    jsRuntime,
    `--paths "${targetDir}"`,
    "--no-simulate",
    "--ignore-config",
    "--no-download-archive",
    "--force-overwrites",
  ]
    .filter(Boolean)
    .join(" ");
  return `${getYtDlpBaseCommand()} ${extra} ${mainArgs}`.trim();
}

async function execYtDlpCommand(command, options = {}) {
  try {
    const { stdout } = await execPromise(command, {
      stdio: "pipe",
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
      ...options,
    });
    return stdout;
  } catch (error) {
    const msg = String(error.message || "");
    if ((msg.includes("403") || msg.includes("Forbidden") || msg.includes("Sign in")) && command.includes("--cookies")) {
      const commandNoCookies = command.replace(/--cookies\s+"[^"]+"/g, "").replace(/--cookies\s+\S+/g, "");
      const { stdout } = await execPromise(commandNoCookies, {
        stdio: "pipe",
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
        ...options,
      });
      return stdout;
    }
    throw error;
  }
}

function extractPrintedTitle(output) {
  const text = String(output || "");
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("title:")) {
      return line.trim().slice("title:".length).trim();
    }
  }
  return null;
}

function findFirstExistingAudio(outputBase) {
  const extensions = ["mp3", "m4a", "opus", "webm", "ogg"];
  for (const ext of extensions) {
    const filePath = `${outputBase}.${ext}`;
    if (fs.existsSync(filePath)) return filePath;
  }
  try {
    const dir = path.dirname(outputBase);
    const base = path.basename(outputBase);
    if (!fs.existsSync(dir)) return null;

    const files = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(`${base}.`) && !n.endsWith(".part") && !n.endsWith(".ytdl"))
      .map((n) => ({ path: path.join(dir, n), stat: fs.statSync(path.join(dir, n)) }))
      .filter((i) => i.stat.isFile() && i.stat.size > 0)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    if (files.length > 0) return files[0].path;
  } catch (_) {}
  return null;
}

async function ensureMp3Format(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return filePath;
  if (filePath.toLowerCase().endsWith(".mp3")) return filePath;

  const mp3Path = filePath.replace(/\.[^.]+$/, ".mp3");
  if (fs.existsSync(mp3Path)) {
    try { if (filePath !== mp3Path) fs.unlinkSync(filePath); } catch (_) {}
    return mp3Path;
  }

  try {
    await execPromise(`ffmpeg -y -i "${filePath}" -q:a 2 "${mp3Path}"`, { timeout: 30000 });
    if (fs.existsSync(mp3Path)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      return mp3Path;
    }
  } catch (e) {
    console.error("⚠️ Failed to convert audio to MP3:", e.message);
  }
  return filePath;
}

// ==========================================
// 🎵 AUDIO DOWNLOAD & TITLE FUNCTIONS
// ==========================================

async function getYouTubeTitle(url) {
  try {
    const cmd = buildYtDlpCommand(`-j "${url}"`);
    const out = await execYtDlpCommand(cmd, { timeout: 8000 });
    const info = JSON.parse(out);
    if (info?.title) return info.title;
  } catch (_) {}
  try {
    const res = await axios.get("https://www.youtube.com/oembed", {
      params: { url, format: "json" },
      timeout: 5000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (res?.data?.title) return String(res.data.title).trim();
  } catch (_) {}
  return null;
}

async function downloadYouTubeTomusic(url, cacheDir) {
  const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  const videoId = videoIdMatch ? videoIdMatch[1] : `yt_${Date.now()}`;
  const mp3Path = path.join(cacheDir, `${videoId}.mp3`);
  const m4aPath = path.join(cacheDir, `${videoId}.m4a`);
  const outputBase = path.join(cacheDir, videoId);

  const existing = findFirstExistingAudio(outputBase);
  if (existing) {
    const finalMp3 = await ensureMp3Format(existing);
    const title = await getYouTubeTitle(url);
    return { audioPath: finalMp3, title };
  }

  console.log("📥 Tải audio từ YouTube (MP3 format):", videoId);

  // 1. Tải MP3 trực tiếp (FFmpeg extract)
  try {
    const cmd = buildYtDlpCommand(
      `-x --audio-format mp3 --audio-quality 128K --print "title:%(title)s" -o "${videoId}.%(ext)s" "${url}"`,
      cacheDir
    );
    const out = await execYtDlpCommand(cmd);
    const title = extractPrintedTitle(out) || (await getYouTubeTitle(url));
    let audioPath = fs.existsSync(mp3Path) ? mp3Path : findFirstExistingAudio(outputBase);
    if (audioPath) {
      audioPath = await ensureMp3Format(audioPath);
      return { audioPath, title };
    }
  } catch (e) {
    console.log("⚠️ Direct MP3 download failed, trying M4A fallback:", e.message);
  }

  // 2. Fallback: Fast M4A download rồi tự convert sang MP3
  try {
    const cmd = buildYtDlpCommand(
      `-f "bestaudio[ext=m4a]/bestaudio" --print "title:%(title)s" -o "${videoId}.%(ext)s" "${url}"`,
      cacheDir
    );
    const out = await execYtDlpCommand(cmd);
    const title = extractPrintedTitle(out) || (await getYouTubeTitle(url));
    let audioPath = fs.existsSync(m4aPath) ? m4aPath : findFirstExistingAudio(outputBase);
    if (audioPath) {
      audioPath = await ensureMp3Format(audioPath);
      return { audioPath, title };
    }
  } catch (e) {
    console.error("❌ M4A fallback failed:", e.message);
  }

  throw new Error("Không thể tải nhạc từ YouTube");
}

async function getSoundCloudTitle(url) {
  try {
    const cmd = buildYtDlpCommand(`-j "${url}"`);
    const out = await execYtDlpCommand(cmd, { timeout: 8000 });
    const info = JSON.parse(out);
    if (info?.title) return info.title;
  } catch (_) {}
  return null;
}

async function downloadSoundCloudTomusic(url, cacheDir) {
  const safeId = Buffer.from(url).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  const filenameBase = `sc_${safeId}`;
  const outputBase = path.join(cacheDir, filenameBase);

  const cached = findFirstExistingAudio(outputBase);
  if (cached) {
    const finalMp3 = await ensureMp3Format(cached);
    const title = await getSoundCloudTitle(url);
    return { audioPath: finalMp3, title };
  }

  console.log("📥 Tải audio từ SoundCloud...");
  const cmd = buildYtDlpCommand(
    `-f "http_mp3/hls_mp3/bestaudio[ext=mp3]/bestaudio" -x --audio-format mp3 --print "title:%(title)s" -o "${filenameBase}.%(ext)s" "${url}"`,
    cacheDir
  );
  const out = await execYtDlpCommand(cmd);
  const title = extractPrintedTitle(out) || (await getSoundCloudTitle(url));
  let audioPath = findFirstExistingAudio(outputBase);

  if (audioPath) {
    audioPath = await ensureMp3Format(audioPath);
    return { audioPath, title };
  }

  throw new Error("Không thể tải nhạc từ SoundCloud");
}

// ==========================================
// 🔍 SEARCH FUNCTIONS & PARSERS
// ==========================================

function formatDuration(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds) || seconds <= 0) return "??:??";
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function normalizeDurationValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) return Math.floor(num);
    const parts = trimmed.split(":").map((p) => Number(p));
    if (!parts.some(Number.isNaN)) {
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }
  return null;
}

function parseYouTubeSearchResults(html, limit = 5) {
  try {
    const match = String(html || "").match(/var ytInitialData\s*=\s*(\{.+?\})\s*;/s);
    if (!match || !match[1]) return [];
    const data = JSON.parse(match[1]);

    const renderers = [];
    const collect = (node) => {
      if (!node || typeof node !== "object" || renderers.length >= 20) return;
      if (Array.isArray(node)) {
        for (const item of node) collect(item);
        return;
      }
      if (node.videoRenderer) renderers.push(node.videoRenderer);
      for (const val of Object.values(node)) {
        if (val && typeof val === "object") collect(val);
      }
    };
    collect(data);

    const results = [];
    for (const r of renderers) {
      if (results.length >= limit) break;
      const videoId = r.videoId;
      if (!videoId) continue;
      const titleRuns = r.title && Array.isArray(r.title.runs) ? r.title.runs : [];
      const title = titleRuns.map((run) => run.text).filter(Boolean).join("").trim() || null;
      const durationText =
        r.lengthText &&
        (r.lengthText.simpleText ||
          (Array.isArray(r.lengthText.runs) ? r.lengthText.runs.map((run) => run.text).join("") : null));
      const duration = normalizeDurationValue(durationText) || normalizeDurationValue(r.lengthSeconds);

      results.push({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title,
        duration,
      });
    }
    return results;
  } catch (_) {
    return [];
  }
}

async function searchYouTubeList(query, limit = 5) {
  global.musicSearchCache = global.musicSearchCache || {};
  const cacheKey = `v3:${query}::${limit}`;
  const cached = global.musicSearchCache[cacheKey];
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL && cached.results?.length > 0) {
    return cached.results;
  }

  // 1. Scraping trực tiếp trang kết quả tìm kiếm YouTube (siêu nhanh)
  try {
    const res = await axios.get("https://www.youtube.com/results", {
      params: { search_query: query },
      timeout: 6000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    const parsed = parseYouTubeSearchResults(res.data, limit);
    if (parsed.length > 0) {
      global.musicSearchCache[cacheKey] = { ts: Date.now(), results: parsed };
      return parsed;
    }
  } catch (e) {
    console.log("⚠️ Search page scrape failed:", e.message);
  }

  // 2. Fallback: yt-dlp search CLI
  try {
    const cmd = buildYtDlpCommand(`"ytsearch${limit}:${query}" --dump-json -j`);
    const raw = await execYtDlpCommand(cmd, { timeout: 10000 });
    const results = [];
    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const info = JSON.parse(line);
        if (info) {
          results.push({
            url: info.webpage_url || info.url || `https://www.youtube.com/watch?v=${info.id}`,
            title: info.title || null,
            duration: normalizeDurationValue(info.duration),
          });
        }
      } catch (_) {}
    }
    if (results.length > 0) {
      const slice = results.slice(0, limit);
      global.musicSearchCache[cacheKey] = { ts: Date.now(), results: slice };
      return slice;
    }
  } catch (e) {
    console.log("⚠️ yt-dlp search CLI failed:", e.message);
  }

  return [];
}

// ==========================================
// 🔋 HELPER TIỆN ÍCH HỆ THỐNG
// ==========================================

async function consumeUserEnergy(threadID, senderID, amount = 25) {
  let conn;
  try {
    conn = await getConnection();
    return await consumeEnergy(conn, String(threadID), senderID, amount);
  } catch (e) {
    console.error("Energy check error:", e);
    return { ok: false, message: "❌ Lỗi hệ thống thể lực." };
  } finally {
    if (conn) conn.release();
  }
}

async function sendAudioResult({ api, threadID, messageID, result, energyUse }) {
  if (result && result.audioPath) {
    result.audioPath = await ensureMp3Format(result.audioPath);
  }

  if (!result || !result.audioPath || !fs.existsSync(result.audioPath)) {
    return messageID
      ? api.sendMessage("❌ Lỗi tải bài hát", threadID, undefined, messageID)
      : api.sendMessage("❌ Lỗi tải bài hát", threadID);
  }

  const fileStats = fs.statSync(result.audioPath);
  const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

  if (fileStats.size === 0) {
    try { fs.unlinkSync(result.audioPath); } catch (_) {}
    return messageID
      ? api.sendMessage("❌ File audio rỗng", threadID, undefined, messageID)
      : api.sendMessage("❌ File audio rỗng", threadID);
  }

  if (fileStats.size > 25 * 1024 * 1024) {
    try { fs.unlinkSync(result.audioPath); } catch (_) {}
    return messageID
      ? api.sendMessage(
          `❌ File quá lớn (${fileSizeMB} MB)! Facebook giới hạn 25 MB.`,
          threadID,
          undefined,
          messageID,
        )
      : api.sendMessage(`❌ File quá lớn (${fileSizeMB} MB)! Facebook giới hạn 25 MB.`, threadID);
  }

  const title = (result.title || "Unknown").substring(0, 100);
  const energyText = energyUse ? `\n⚡ Thể lực: -25 (${energyUse.energy}/${energyUse.maxEnergy})` : "";
  const msgObj = {
    body: `🎵 ${title}${energyText}`,
    attachment: fs.createReadStream(result.audioPath),
  };

  if (messageID) {
    await api.sendMessage(msgObj, threadID, undefined, messageID);
  } else {
    await api.sendMessage(msgObj, threadID);
  }

  setTimeout(() => {
    try {
      if (fs.existsSync(result.audioPath)) fs.unlinkSync(result.audioPath);
    } catch (_) {}
  }, 10000);
}

// ==========================================
// 🚀 MAIN MODULE EXPORTS
// ==========================================

module.exports = {
  name: "music",
  description: "Tìm kiếm và phát nhạc từ YouTube, SoundCloud",
  usage: "!music [tên bài hát | link YouTube/SoundCloud]",

  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event || {};
    const prefix = config?.prefix || "!";

    if (!args || args.length === 0) {
      return api.sendMessage(
        `🎧 Dùng: ${prefix}music [tên bài hát]\nVí dụ: ${prefix}music See You Again`,
        threadID,
        undefined,
        messageID,
      );
    }

    const input = args.join(" ");
    const cacheDir = path.resolve(__dirname, "../../../cache/music");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    try {
      const isYouTube = input.includes("youtube.com") || input.includes("youtu.be");
      const isSoundCloud = input.includes("soundcloud.com");

      // CASE 1: INPUT LÀ TÊN BÀI HÁT (SEARCH MODE)
      if (!isYouTube && !isSoundCloud) {
        let connLocal;
        try {
          connLocal = await getConnection();
          const energyState = await readAndSyncEnergy(connLocal, String(threadID), senderID);
          if (!energyState.ok) {
            return api.sendMessage(`❌ Mày chưa có tài khoản.\nDùng ${prefix}tien để tạo tài khoản.`, threadID, undefined, messageID);
          }
          if (energyState.energy < 25) {
            return api.sendMessage(
              `😵 Không đủ thể lực! Cần 25 thể lực (Hiện có: ${energyState.energy}/${energyState.maxEnergy})`,
              threadID,
              undefined,
              messageID,
            );
          }
        } finally {
          if (connLocal) connLocal.release();
        }

        api.sendMessage("🔍 Đang tìm kiếm bài hát...", threadID, undefined, messageID);
        const results = await searchYouTubeList(input, 5);
        if (!results || !results.length) {
          return api.sendMessage("❌ Không tìm thấy bài hát phù hợp!", threadID, undefined, messageID);
        }

        const lines = [`🔎 Kết quả tìm kiếm cho: ${input}`, "Reply số (1-5) để phát bài bạn muốn:"];
        results.forEach((r, i) => {
          const durValue = normalizeDurationValue(r.duration);
          const dur = typeof durValue === "number" ? formatDuration(durValue) : "??:??";
          const title = (r.title || r.url).substring(0, 120);
          lines.push(`${i + 1}. ${title} - ${dur}`);
        });

        const info = await api.sendMessage(lines.join("\n"), threadID, undefined, messageID);
        global.musicSearchSessions = global.musicSearchSessions || {};
        global.musicSearchSessions[threadID] = {
          messageID: info.messageID,
          requester: String(senderID),
          results,
          cacheDir,
        };
        return;
      }

      // CASE 2: INPUT LÀ LINK TRỰC TIẾP (DIRECT LINK MODE)
      const energyUse = await consumeUserEnergy(threadID, senderID, 25);
      if (!energyUse.ok) return api.sendMessage(energyUse.message || "❌ Lỗi thể lực.", threadID, undefined, messageID);

      api.sendMessage("⏳ Đang tải nhạc từ link...", threadID, undefined, messageID);
      let result;
      if (isYouTube) {
        result = await downloadYouTubeTomusic(input, cacheDir);
      } else {
        result = await downloadSoundCloudTomusic(input, cacheDir);
      }

      await sendAudioResult({ api, threadID, messageID, result, energyUse });
    } catch (error) {
      console.error("❌ Lỗi music.execute:", error);
      api.sendMessage(`❌ Lỗi: ${error.message || "Không thể xử lý yêu cầu"}`, threadID, undefined, messageID);
    }
  },

  handleReply: async ({ api, event, config }) => {
    const { threadID, body, messageReply, senderID } = event || {};
    try {
      if (!messageReply) return;

      global.musicSearchSessions = global.musicSearchSessions || {};
      const session = global.musicSearchSessions[threadID];
      if (!session) return;
      if (String(messageReply.senderID) !== String(api.getCurrentUserID())) return;
      if (String(messageReply.messageID) !== String(session.messageID)) return;

      const pick = parseInt((body || "").trim(), 10);
      if (!Number.isInteger(pick) || pick < 1 || pick > session.results.length) {
        return api.sendMessage("❌ Vui lòng reply 1 số hợp lệ từ 1-5.", threadID);
      }

      if (String(senderID) !== String(session.requester)) {
        return api.sendMessage("⚠️ Chỉ người đã yêu cầu tìm nhạc mới được chọn bài.", threadID);
      }

      const chosen = session.results[pick - 1];
      if (!chosen || !chosen.url) return api.sendMessage("❌ Bài hát đã chọn không hợp lệ.", threadID);

      try {
        if (session.messageID) await api.unsendMessage(session.messageID);
      } catch (_) {}

      const energyUse = await consumeUserEnergy(threadID, senderID, 25);
      if (!energyUse.ok) return api.sendMessage(energyUse.message || "❌ Lỗi thể lực.", threadID);

      const cacheDir = session.cacheDir || path.resolve(__dirname, "../../../cache/music");
      await api.sendMessage("⏳ Đang tải bài hát bạn chọn...", threadID);

      let result;
      if (chosen.url.includes("youtube.com") || chosen.url.includes("youtu.be")) {
        result = await downloadYouTubeTomusic(chosen.url, cacheDir);
      } else if (chosen.url.includes("soundcloud.com")) {
        result = await downloadSoundCloudTomusic(chosen.url, cacheDir);
      }

      if (chosen.title && result) result.title = chosen.title;
      await sendAudioResult({ api, threadID, result, energyUse });
    } catch (err) {
      console.error("❌ Lỗi music.handleReply:", err);
      if (threadID) {
        api.sendMessage(`❌ Lỗi: ${err.message || "Không thể tải bài hát"}`, threadID);
      }
    } finally {
      try {
        if (threadID) delete global.musicSearchSessions[threadID];
      } catch (_) {}
    }
  },
};
