const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { execute, getConnection } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const {
  consumeEnergy,
  getDBConfigFromRuntime,
  readAndSyncEnergy,
} = require("../../utils/energySystem");

function hasCommand(command) {
  try {
    if (process.platform === "win32") {
      execSync(`where ${command}`, { stdio: "pipe" });
    } else {
      execSync(`command -v ${command}`, { stdio: "pipe" });
    }
    return true;
  } catch (_) {
    return false;
  }
}

function getExecErrorDetails(error) {
  const parts = [];
  if (error && error.message) {
    parts.push(error.message);
  }
  if (error && typeof error.status !== "undefined") {
    parts.push(`exit=${error.status}`);
  }

  const stderr = error && error.stderr ? String(error.stderr).trim() : "";
  if (stderr) {
    parts.push(stderr);
  }

  const stdout = error && error.stdout ? String(error.stdout).trim() : "";
  if (stdout) {
    parts.push(stdout);
  }

  return parts.join(" | ");
}

let ytDlpCliHealthCache = null;

function getYtDlpBaseCommand() {
  const envBin = String(process.env.YTDLP_BIN || "").trim();
  if (envBin) return `\"${envBin}\"`;

  const venvPython = path.resolve(__dirname, "../../../.venv/bin/python");
  if (fs.existsSync(venvPython)) {
    return `\"${venvPython}\" -m yt_dlp`;
  }

  return "yt-dlp";
}

function getBundledYtDlpBinaryCommand() {
  try {
    const packageJsonPath = require.resolve("yt-dlp-exec/package.json");
    const packageRoot = path.dirname(packageJsonPath);
    const binaryPath = path.resolve(packageRoot, "bin/yt-dlp");
    if (fs.existsSync(binaryPath)) {
      return `\"${binaryPath}\"`;
    }
  } catch (_) {}

  return null;
}

function buildYtDlpCommand(mainArgs) {
  const extra = getYtDlpExtraArgs();
  const base = getYtDlpBaseCommand();
  return `${base} ${extra} ${mainArgs}`.trim();
}

function canUseYtDlpCli() {
  if (ytDlpCliHealthCache !== null) {
    return ytDlpCliHealthCache;
  }

  try {
    execSync(`${getYtDlpBaseCommand()} --version`, {
      stdio: "pipe",
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    ytDlpCliHealthCache = true;
    return true;
  } catch (error) {
    ytDlpCliHealthCache = false;
    console.log(
      "⚠️ yt-dlp CLI không dùng được, chuyển fallback:",
      getExecErrorDetails(error),
    );
    return false;
  }
}

function getYtDlpExec() {
  try {
    return require("yt-dlp-exec");
  } catch (_) {
    return null;
  }
}

function getYtDlpCookieArg() {
  const cookieFileCandidates = [
    process.env.YTDLP_COOKIES_FILE,
    path.resolve(process.cwd(), "youtube_cookies.txt"),
    path.resolve(process.cwd(), "cache/youtube_cookies.txt"),
    path.resolve(process.env.HOME || "", ".config/yt-dlp/cookies.txt"),
  ].filter(Boolean);

  for (const cookieFile of cookieFileCandidates) {
    try {
      if (fs.existsSync(cookieFile) && fs.statSync(cookieFile).size > 0) {
        return `--cookies "${cookieFile}"`;
      }
    } catch (_) {}
  }

  const preferredBrowser = String(
    process.env.YTDLP_COOKIES_BROWSER || "chrome:Default",
  ).trim();
  const browserOrder = [
    preferredBrowser,
    "chrome:Default",
    "chrome",
    "chromium:Default",
    "chromium",
    "firefox",
    "edge",
  ];
  const uniqBrowsers = [...new Set(browserOrder)];

  const browserCommands = {
    chrome: ["google-chrome", "google-chrome-stable", "chrome"],
    chromium: ["chromium", "chromium-browser"],
    firefox: ["firefox"],
    edge: ["microsoft-edge", "edge"],
  };

  for (const browserSpec of uniqBrowsers) {
    const browserType = String(browserSpec).split(":")[0].toLowerCase();
    const commands = browserCommands[browserType] || [];
    if (commands.some((cmd) => hasCommand(cmd))) {
      return `--cookies-from-browser "${browserSpec}"`;
    }
  }

  return "";
}

function getYtDlpJsRuntimeArg() {
  const nodeBin = String(
    process.env.YTDLP_NODE_BIN || process.execPath || "",
  ).trim();
  if (nodeBin && fs.existsSync(nodeBin)) {
    return `--js-runtimes "node:${nodeBin}"`;
  }
  if (hasCommand("node")) return "--js-runtimes node";
  if (hasCommand("deno")) return "--js-runtimes deno";
  return "";
}

function getYtDlpExtraArgs() {
  const args = [];
  const cookieArg = getYtDlpCookieArg();
  const jsRuntimeArg = getYtDlpJsRuntimeArg();

  if (cookieArg) args.push(cookieArg);
  if (jsRuntimeArg) args.push(jsRuntimeArg);
  if (jsRuntimeArg) args.push("--remote-components ejs:github");
  args.push("--ignore-config");
  args.push("--no-download-archive");
  args.push("--force-overwrites");

  // Nhẹ nhàng giảm tần suất request để hạn chế 429
  args.push(
    "--sleep-requests 1",
    "--sleep-interval 1",
    "--max-sleep-interval 5",
  );

  return args.join(" ");
}

function execYtDlpCommand(command, options = {}) {
  try {
    return execSync(command, {
      stdio: "pipe",
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
      ...options
    });
  } catch (error) {
    const errorDetails = getExecErrorDetails(error);
    if ((errorDetails.includes("403") || errorDetails.includes("Forbidden") || errorDetails.includes("Sign in to confirm you're not a bot")) && command.includes("--cookies")) {
      console.log("⚠️ Phát hiện lỗi 403 Forbidden hoặc yêu cầu đăng nhập khi dùng cookies. Thử lại không dùng cookies...");
      const commandNoCookies = command.replace(/--cookies\s+"[^"]+"/g, "").replace(/--cookies\s+\S+/g, "");
      return execSync(commandNoCookies, {
        stdio: "pipe",
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
        ...options
      });
    }
    throw error;
  }
}

module.exports = {
  name: "music",
  description: "Tải nhạc từ YouTube hoặc SoundCloud",
  usage:
    "\n!music [tên bài hát] → Tìm và tải nhạc\n!music [link YouTube/SoundCloud] → Tải từ link\n━━━━━━━━━━━━━\n🎧 Hỗ trợ: YouTube, SoundCloud\n⚡ Tốn năng lượng mỗi lần dùng\n💡 Ví dụ: !music See You Again",
  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;
    const prefix = config?.prefix || "!";

    // Cooldown 25s
    const cooldown = checkCooldown({
      command: "music",
      key: senderID,
      durationMs: 25000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    if (args.length === 0) {
      return api.sendMessage(
        "❌ Vui lòng nhập tên bài hát hoặc link (YouTube/SoundCloud)",
        threadID,
        messageID,
      );
    }

    const input = args.join(" ");

    const dbConfig = getDBConfigFromRuntime(config);
    if (!dbConfig) {
      return api.sendMessage("❌ Lỗi cấu hình Database.", threadID, undefined, messageID);
    }

    const cacheDir = path.resolve(__dirname, "../../../cache/music");

    // Tạo thư mục cache nếu chưa tồn tại
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    try {
      api.sendMessage("⏳ Đang xử lý...", threadID, undefined, messageID);

      let videoUrl = input;
      let songTitle = "";

      // Nếu input không phải link thì tìm kiếm và hiển thị top 5 kết quả
      if (
        !input.includes("youtube.com") &&
        !input.includes("youtu.be") &&
        !input.includes("soundcloud.com")
      ) {
        // Kiểm tra thể lực trước khi tìm kiếm
        let energyState;
        let energyConnectionLocal;
        try {
          energyConnectionLocal = await getConnection();
          energyState = await readAndSyncEnergy(energyConnectionLocal, senderID);
          if (!energyState.ok) {
            return api.sendMessage(
              `❌ Không thể kiểm tra thể lực lúc này.\nGõ ${prefix}tien để tạo thể lực`,
              threadID,
              undefined,
              messageID,
            );
          }
          if (energyState.energy < 25) {
            const deficit = 25 - energyState.energy;
            const regen = energyState.regenPerSec || (1 / 60);
            const waitSeconds = deficit / regen;
            
            const formatWait = (totalSeconds) => {
              const sec = Math.max(1, Math.ceil(totalSeconds));
              const minutes = Math.floor(sec / 60);
              const seconds = sec % 60;
              if (minutes <= 0) return `${seconds} giây`;
              if (seconds === 0) return `${minutes} phút`;
              return `${minutes} phút ${seconds} giây`;
            };

            return api.sendMessage(
              `😵 Không đủ thể lực, nghỉ ngơi đi!\n` +
                `⚡ Hiện tại: ${energyState.energy}/${energyState.maxEnergy}\n` +
                `🔋 Cần: 25 thể lực\n` +
                `⏳ Ước tính hồi đủ: ${formatWait(waitSeconds)}`,
              threadID,
              undefined,
              messageID,
            );
          }
        } catch (e) {
          console.error("Energy check error (music search):", e);
          return api.sendMessage("❌ Lỗi hệ thống thể lực.", threadID, undefined, messageID);
        } finally {
          if (energyConnectionLocal) energyConnectionLocal.release();
        }

        console.log("🔍 Tìm kiếm top 5:", input);
        const results = await searchYouTubeList(input, 5);
        if (!results || !results.length) {
          return api.sendMessage("❌ Không tìm thấy bài hát!", threadID, undefined, messageID);
        }

        // Enrich missing metadata before sending list (try to get title/duration)
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if ((!r.title || !r.duration) && r.url) {
            try {
              const info = await getYouTubeInfo(r.url);
              if (info) {
                r.title = r.title || info.title || r.url;
                r.duration = r.duration || info.duration || null;
                console.log(`ℹ️ Enriched result[${i}]:`, r.title, r.duration);
              }
            } catch (e) {
              console.log(`⚠️ Enrich failed for result[${i}]`, e && e.message ? e.message : e);
            }
            // small pause to avoid hammering
            await sleep(120);
          }
        }

        // Build message with index, title and duration
        const lines = [
          `🔎 Kết quả tìm kiếm cho: ${input}`,
          "Reply số (1-5) để phát bài bạn muốn:",
        ];
        results.forEach((r, i) => {
          const idx = i + 1;
          const durValue = normalizeDurationValue(r.duration);
          const dur = typeof durValue === "number" ? formatDuration(durValue) : "??:??";
          const title = (r.title || r.url).substring(0, 150);
          lines.push(`${idx}. ${title} - ${dur}`);
        });

        const info = await api.sendMessage(lines.join("\n"), threadID, undefined, messageID);

        // Lưu session để handleReply xử lý
        global.musicSearchSessions = global.musicSearchSessions || {};
        global.musicSearchSessions[threadID] = {
          messageID: info.messageID,
          requester: String(senderID),
          results,
          cacheDir,
        };

        return;
      }

      // Xử lý YouTube
      if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
        console.log("📹 Xử lý YouTube:", videoUrl);

        // Kiểm tra và trừ thể lực trước khi tải (trường hợp input là link)
        let energyUseLocal;
        let energyConnectionLocal;
        try {
          energyConnectionLocal = await getConnection();
          energyUseLocal = await consumeEnergy(energyConnectionLocal, senderID, 25);
          if (!energyUseLocal.ok) {
            if (energyUseLocal.reason === "not_enough") {
              return api.sendMessage(energyUseLocal.message, threadID, undefined, messageID);
            }
            return api.sendMessage(
              `❌ Không thể kiểm tra thể lực lúc này.\nGõ ${prefix}tien để tạo thể lực`,
              threadID,
              undefined,
              messageID,
            );
          }
        } catch (e) {
          console.error("Energy check error (music direct link):", e);
          return api.sendMessage("❌ Lỗi hệ thống thể lực.", threadID, undefined, messageID);
        } finally {
          if (energyConnectionLocal) energyConnectionLocal.release();
        }

        const result = await downloadYouTubeTomusic(videoUrl, cacheDir);

        if (!result || !result.audioPath || !fs.existsSync(result.audioPath)) {
          return api.sendMessage(
            "❌ Lỗi tải video từ YouTube",
            threadID,
            undefined,
            messageID,
          );
        }

        // Kiểm tra kích thước file
        const fileStats = fs.statSync(result.audioPath);
        const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

        if (fileStats.size === 0) {
          // Xóa file lỗi
          try {
            fs.unlinkSync(result.audioPath);
          } catch (e) {}
          return api.sendMessage("❌ File audio rỗng", threadID, undefined, messageID);
        }

        // Facebook Messenger có giới hạn 25MB cho file đính kèm
        if (fileStats.size > 25 * 1024 * 1024) {
          // Xóa file quá lớn ngay lập tức
          try {
            fs.unlinkSync(result.audioPath);
            console.log(`🗑️ Đã xóa file quá lớn: ${fileSizeMB} MB`);
          } catch (e) {}
          return api.sendMessage(
            `❌ File quá lớn!\n` +
              `📊 Kích thước: ${fileSizeMB} MB\n` +
              `⚠️ Giới hạn Facebook: 25 MB\n\n` +
              `💡 Đề xuất:\n` +
              `• Tìm video ngắn hơn\n`,
            threadID,
            undefined,
            messageID,
          );
        }

        // Gửi file audio - hiển thị tiêu đề và thể lực
        const title = result.title ? result.title.substring(0, 100) : "Unknown";
        await api.sendMessage(
          {
            body: `🎵 ${title}\n⚡ Thể lực: -25 (${energyUseLocal.energy}/${energyUseLocal.maxEnergy})`,
            attachment: fs.createReadStream(result.audioPath),
          },
          threadID,
          undefined,
          messageID,
        );

        // Xóa file sau khi gửi
        setTimeout(() => {
          try {
            if (fs.existsSync(result.audioPath)) {
              fs.unlinkSync(result.audioPath);
              console.log("🗑️ Đã xóa file cache:", result.audioPath);
            }
          } catch (e) {
            console.error("❌ Lỗi xóa file:", e);
          }
        }, 10000);
      }
      // Xử lý SoundCloud
      else if (videoUrl.includes("soundcloud.com")) {
        console.log("🎵 Xử lý SoundCloud:", videoUrl);

        // Kiểm tra và trừ thể lực trước khi tải (trường hợp input là link)
        let energyUseLocal;
        let energyConnectionLocal;
        try {
          energyConnectionLocal = await getConnection();
          energyUseLocal = await consumeEnergy(energyConnectionLocal, senderID, 25);
          if (!energyUseLocal.ok) {
            if (energyUseLocal.reason === "not_enough") {
              return api.sendMessage(energyUseLocal.message, threadID, undefined, messageID);
            }
            return api.sendMessage(
              `❌ Không thể kiểm tra thể lực lúc này.\nGõ ${prefix}tien để tạo thể lực`,
              threadID,
              undefined,
              messageID,
            );
          }
        } catch (e) {
          console.error("Energy check error (music direct link):", e);
          return api.sendMessage("❌ Lỗi hệ thống thể lực.", threadID, undefined, messageID);
        } finally {
          if (energyConnectionLocal) energyConnectionLocal.release();
        }

        const result = await downloadSoundCloudTomusic(videoUrl, cacheDir);

        if (!result || !result.audioPath || !fs.existsSync(result.audioPath)) {
          return api.sendMessage(
            "❌ Lỗi tải audio từ SoundCloud",
            threadID,
            undefined,
            messageID,
          );
        }

        // Kiểm tra kích thước file
        const fileStats = fs.statSync(result.audioPath);
        const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

        if (fileStats.size === 0) {
          try {
            fs.unlinkSync(result.audioPath);
          } catch (e) {}
          return api.sendMessage("❌ File audio rỗng", threadID, undefined, messageID);
        }

        if (fileStats.size > 25 * 1024 * 1024) {
          try {
            fs.unlinkSync(result.audioPath);
            console.log(`🗑️ Đã xóa file quá lớn: ${fileSizeMB} MB`);
          } catch (e) {}
          return api.sendMessage(
            `❌ File quá lớn!\n` +
              `📊 Kích thước: ${fileSizeMB} MB\n` +
              `⚠️ Giới hạn Facebook: 25 MB`,
            threadID,
            undefined,
            messageID,
          );
        }

        const title = result.title ? result.title.substring(0, 100) : "Unknown";
        await api.sendMessage(
          {
            body: `🎵 ${title}\n⚡ Thể lực: -25 (${energyUseLocal.energy}/${energyUseLocal.maxEnergy})`,
            attachment: fs.createReadStream(result.audioPath),
          },
          threadID,
          undefined,
          messageID,
        );

        setTimeout(() => {
          try {
            if (fs.existsSync(result.audioPath)) {
              fs.unlinkSync(result.audioPath);
              console.log("🗑️ Đã xóa file cache:", result.audioPath);
            }
          } catch (e) {
            console.error("❌ Lỗi xóa file:", e);
          }
        }, 10000);
      }
    } catch (error) {
      console.error("❌ Lỗi music:", error);
      api.sendMessage(`❌ Lỗi: ${error.message}`, threadID, undefined, messageID);
    }
  },
};

/**
 * Tìm kiếm YouTube
 */
async function searchYouTube(query) {
  try {
    // Thử phương pháp 1: HTTP scraping
    try {
      const response = await axios.get(`https://www.youtube.com/results`, {
        params: { search_query: query },
        timeout: 5000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      // Tìm video ID từ HTML - cải thiện regex
      const videoIdMatch = response.data.match(
        /"videoId":"([a-zA-Z0-9_-]{11})"/,
      );
      if (videoIdMatch && videoIdMatch[1]) {
        const url = `https://www.youtube.com/watch?v=${videoIdMatch[1]}`;
        console.log("✅ Tìm thấy video YouTube:", url);
        return url;
      }
    } catch (httpError) {
      console.log("⚠️ Phương pháp HTTP scraping thất bại:", httpError.message);
    }

    // Fallback: Thử yt-dlp để search
    if (canUseYtDlpCli()) {
      try {
        const result = execYtDlpCommand(
          `${buildYtDlpCommand(`"ytsearch:${query}" --dump-json -j`)} | head -1`,
          {
            stdio: "pipe",
            timeout: 10000,
            encoding: "utf8",
          },
        );
        if (result) {
          const info = JSON.parse(result);
          if (info?.url || info?.webpage_url) {
            const url = info.url || info.webpage_url;
            console.log("✅ Tìm thấy video từ yt-dlp:", url);
            return url;
          }
        }
      } catch (e) {
        console.log("⚠️ yt-dlp search thất bại:", e.message);
      }
    }

    console.log("❌ Không thể tìm kiếm video cho:", query);
    return null;
  } catch (error) {
    console.error("Lỗi tìm kiếm YouTube:", error.message);
    return null;
  }
}

/**
 * Lấy tiêu đề bài hát từ YouTube URL
 */
async function getYouTubeTitle(url) {
  try {
    const ytDlpExec = getYtDlpExec();
    if (ytDlpExec) {
      const info = await ytDlpExec(url, {
        dumpJson: true,
        noWarnings: true,
        noCheckCertificate: true,
      });
      if (typeof info === "object" && info.title) {
        return info.title;
      }
    }

    if (canUseYtDlpCli()) {
      try {
        const result = execYtDlpCommand(buildYtDlpCommand(`-j "${url}"`), {
          stdio: "pipe",
          timeout: 10000,
          encoding: "utf8",
        });
        const info = JSON.parse(result);
        if (info && info.title) return info.title;
      } catch (_) {}
    }
    // Fallback: fetch page HTML and parse og:title or <title>
    try {
      const res = await axios.get(url, { timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = String(res.data || '');
      const ogMatch = html.match(/<meta\s+property=(?:"|')og:title(?:"|')\s+content=(?:"|')([^"']+)(?:"|')/i);
      if (ogMatch && ogMatch[1]) return ogMatch[1];
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) return titleMatch[1].trim();
    } catch (e) {
      // ignore
    }
    // Fallback: try oEmbed (works without API key)
    try {
      const oembed = await axios.get('https://www.youtube.com/oembed', { params: { url, format: 'json' }, timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (oembed && oembed.data && oembed.data.title) return String(oembed.data.title).trim();
    } catch (e) {
      // ignore
    }
  } catch (e) {
    console.log("⚠️ Không lấy được tiêu đề:", e.message);
  }
  return null;
}

function extractPrintedTitle(output) {
  const text = String(output || "");
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("title:")) {
      const title = line.slice("title:".length).trim();
      if (title) return title;
    }
  }

  return null;
}

function extractPrintedFilePath(output) {
  const text = String(output || "");
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("filepath:")) {
      const filePath = line.slice("filepath:".length).trim();
      if (filePath) return filePath;
    }
  }

  return null;
}

/**
 * Tải video từ YouTube và convert thành music bằng youtube-dl hoặc yt-dlp
 */
async function downloadYouTubeTomusic(url, cacheDir) {
  return new Promise((resolve, reject) => {
    try {
      const downloadStartMs = Date.now();
      const videoId = url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      )?.[1];
      if (!videoId) {
        return reject(new Error("URL YouTube không hợp lệ"));
      }

      const audioPath = path.join(cacheDir, `${videoId}.mp3`);
      const m4aPath = path.join(cacheDir, `${videoId}.m4a`);
      const outputBase = path.join(cacheDir, videoId);

      // Nếu file đã tồn tại (mp3 hoặc M4A), trả về luôn
      if (fs.existsSync(audioPath)) {
        console.log("✅ Sử dụng mp3 cache:", audioPath);
        return getYouTubeTitle(url)
          .then((title) => {
            resolve({ audioPath, title });
          })
          .catch(() => resolve({ audioPath, title: null }));
      }
      if (fs.existsSync(m4aPath)) {
        console.log("✅ Sử dụng M4A cache:", m4aPath);
        return getYouTubeTitle(url)
          .then((title) => {
            resolve({ audioPath: m4aPath, title });
          })
          .catch(() => resolve({ audioPath: m4aPath, title: null }));
      }
      const cachedAnyAudio = findFirstExistingAudio(outputBase);
      if (cachedAnyAudio) {
        console.log("✅ Sử dụng audio cache:", cachedAnyAudio);
        return getYouTubeTitle(url)
          .then((title) => {
            resolve({ audioPath: cachedAnyAudio, title });
          })
          .catch(() => resolve({ audioPath: cachedAnyAudio, title: null }));
      }

      console.log("📥 Tải audio từ YouTube...");

      let command = null;

      // Thử yt-dlp trước với format M4A (Facebook hỗ trợ tốt hơn)
      try {
        if (canUseYtDlpCli()) {
          // Tải trực tiếp dạng M4A thay vì convert từ music
          command = buildYtDlpCommand(
            `--downloader curl \
            -x \
            --audio-format mp3 \
            --audio-quality 128K \
            --print "title:%(title)s" \
            --print "after_move:filepath:%(filepath)s" \
            -o "${audioPath.replace(".mp3", "")}.%(ext)s" \
            "${url}"`,);
          console.log("📦 Sử dụng yt-dlp (M4A format)");

          try {
            const m4aOutput = execYtDlpCommand(command, {
              stdio: "pipe",
              timeout: 120000,
              maxBuffer: 10 * 1024 * 1024,
              encoding: "utf8",
            });
            const m4aTitle = extractPrintedTitle(m4aOutput);
            const printedPath = extractPrintedFilePath(m4aOutput);

            const m4aResultPath = fs.existsSync(m4aPath)
              ? m4aPath
              : findFirstExistingAudio(outputBase);
            const recentAudioPath = m4aResultPath
              ? null
              : findRecentAudioInDir(
                  cacheDir,
                  downloadStartMs - 10000,
                  videoId,
                );
            const printedAudioPath =
              printedPath && fs.existsSync(printedPath) ? printedPath : null;

            if (m4aResultPath || recentAudioPath || printedAudioPath) {
              const finalPath =
                m4aResultPath || recentAudioPath || printedAudioPath;
              console.log("✅ Tải audio thành công:", finalPath);
              return Promise.resolve(m4aTitle || null)
                .then((title) => resolve({ audioPath: finalPath, title }))
                .catch(() => resolve({ audioPath: finalPath, title: null }));
            }
          } catch (e) {
            console.log(
              "⚠️ Tải M4A thất bại, thử music...",
              getExecErrorDetails(e),
            );
          }

          // Nếu M4A thất bại, thử mp3
          command = buildYtDlpCommand(
            `-x --audio-format mp3 --audio-quality 128K --print "title:%(title)s" --print "after_move:filepath:%(filepath)s" -o "${audioPath.replace(".mp3", "")}.%(ext)s" "${url}"`,
          );
          console.log("📦 Sử dụng yt-dlp (mp3 format)");
        } else {
          const ytDlpExec = getYtDlpExec();
          if (!ytDlpExec) {
            throw new Error("yt-dlp not found");
          }

          const bundledBinary = getBundledYtDlpBinaryCommand();
          if (bundledBinary) {
            console.log("📦 Sử dụng yt-dlp-exec binary (CLI mode)");
            command = `${bundledBinary} ${getYtDlpExtraArgs()} -f "bestaudio[ext=m4a]/bestaudio" --print "title:%(title)s" --print "after_move:filepath:%(filepath)s" -o "${m4aPath}" "${url}"`;

            try {
              const m4aOutput = execYtDlpCommand(command, {
                stdio: "pipe",
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024,
                encoding: "utf8",
              });
              const m4aTitle = extractPrintedTitle(m4aOutput);
              const printedPath = extractPrintedFilePath(m4aOutput);

              const m4aResultPath = fs.existsSync(m4aPath)
                ? m4aPath
                : findFirstExistingAudio(outputBase);
              const recentAudioPath = m4aResultPath
                ? null
                : findRecentAudioInDir(
                    cacheDir,
                    downloadStartMs - 10000,
                    videoId,
                  );
              const printedAudioPath =
                printedPath && fs.existsSync(printedPath) ? printedPath : null;

              if (m4aResultPath || recentAudioPath || printedAudioPath) {
                const finalPath =
                  m4aResultPath || recentAudioPath || printedAudioPath;
                console.log("✅ Tải audio thành công:", finalPath);
                return Promise.resolve(m4aTitle || null)
                  .then((title) => resolve({ audioPath: finalPath, title }))
                  .catch(() => resolve({ audioPath: finalPath, title: null }));
              }
            } catch (e) {
              console.log(
                "⚠️ yt-dlp-exec binary M4A thất bại, thử mp3...",
                getExecErrorDetails(e),
              );
            }

            command = `${bundledBinary} ${getYtDlpExtraArgs()} -x --audio-format mp3 --audio-quality 128K --print "title:%(title)s" --print "after_move:filepath:%(filepath)s" -o "${audioPath.replace(".mp3", "")}.%(ext)s" "${url}"`;
            console.log("📦 Sử dụng yt-dlp-exec binary (mp3 format)");

            try {
              const dlOutput = execYtDlpCommand(command, {
                stdio: "pipe",
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024,
                encoding: "utf8",
              });
              const printedTitle = extractPrintedTitle(dlOutput);
              const printedPath = extractPrintedFilePath(dlOutput);

              let resultPath = null;
              if (fs.existsSync(m4aPath)) {
                console.log("✅ Tải và chuyển đổi thành công:", m4aPath);
                resultPath = m4aPath;
              } else if (fs.existsSync(audioPath)) {
                console.log("✅ Tải và chuyển đổi thành công:", audioPath);
                resultPath = audioPath;
              } else {
                const anyAudioPath = findFirstExistingAudio(outputBase);
                const recentAudioPath = anyAudioPath
                  ? null
                  : findRecentAudioInDir(
                      cacheDir,
                      downloadStartMs - 10000,
                      videoId,
                    );
                const printedAudioPath =
                  printedPath && fs.existsSync(printedPath)
                    ? printedPath
                    : null;
                if (anyAudioPath || recentAudioPath || printedAudioPath) {
                  resultPath =
                    anyAudioPath || recentAudioPath || printedAudioPath;
                  console.log("✅ Tải audio thành công:", resultPath);
                } else {
                  try {
                    const dirEntries = fs.existsSync(cacheDir)
                      ? fs.readdirSync(cacheDir).slice(-30)
                      : [];
                    console.log(
                      "⚠️ Không tìm thấy output theo base:",
                      outputBase,
                    );
                    if (printedPath) {
                      console.log(
                        "⚠️ yt-dlp in ra filepath nhưng không tồn tại:",
                        printedPath,
                      );
                    }
                    console.log("⚠️ Cache files gần đây:", dirEntries);
                  } catch (_) {}
                  throw new Error("Không tạo được file audio");
                }
              }

              if (!resultPath) {
                throw new Error("Không tạo được file audio");
              }

              return Promise.resolve(printedTitle || null)
                .then((title) => resolve({ audioPath: resultPath, title }))
                .catch(() => resolve({ audioPath: resultPath, title: null }));
            } catch (execError) {
              const detailed = getExecErrorDetails(execError);
              console.error("Lỗi tải video:", detailed || execError.message);

              const details = String(detailed || execError.message || "");
              if (
                details.includes("Sign in to confirm you’re not a bot") ||
                details.includes("Sign in to confirm you're not a bot")
              ) {
                return reject(
                  new Error(
                    "YouTube yêu cầu xác thực. Hãy export cookies vào youtube_cookies.txt hoặc cache/youtube_cookies.txt rồi đặt ENV YTDLP_COOKIES_FILE nếu cần.",
                  ),
                );
              }

              return reject(
                new Error("Lỗi tải video: " + (detailed || execError.message)),
              );
            }
          }

          console.log("📦 Sử dụng yt-dlp-exec (bundled binary)");
          return downloadWithYtDlpExec(ytDlpExec, url, audioPath, m4aPath)
            .then((result) => resolve(result))
            .catch(reject);
        }
      } catch (e) {
        // Nếu không có yt-dlp, thử youtube-dl
        try {
          if (!hasCommand("youtube-dl")) {
            throw new Error("youtube-dl not found");
          }
          command = `youtube-dl -x -f bestaudio --audio-format mp3 --audio-quality 128K -o "${audioPath.replace(".mp3", "")}.%(ext)s" "${url}"`;
          console.log("📦 Sử dụng youtube-dl");
        } catch (e2) {
          return reject(
            new Error(
              "Thiếu công cụ tải nhạc. Hãy chạy: npm install yt-dlp-exec hoặc cài yt-dlp hệ thống.",
            ),
          );
        }
      }

      try {
        const dlOutput = execYtDlpCommand(command, {
          stdio: "pipe",
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
          encoding: "utf8",
        });
        const printedTitle = extractPrintedTitle(dlOutput);
        const printedPath = extractPrintedFilePath(dlOutput);

        // Kiểm tra file nào được tạo (M4A hoặc music)
        let resultPath = null;
        if (fs.existsSync(m4aPath)) {
          console.log("✅ Tải và chuyển đổi thành công:", m4aPath);
          resultPath = m4aPath;
        } else if (fs.existsSync(audioPath)) {
          console.log("✅ Tải và chuyển đổi thành công:", audioPath);
          resultPath = audioPath;
        } else {
          const anyAudioPath = findFirstExistingAudio(outputBase);
          const recentAudioPath = anyAudioPath
            ? null
            : findRecentAudioInDir(cacheDir, downloadStartMs - 10000, videoId);
          const printedAudioPath =
            printedPath && fs.existsSync(printedPath) ? printedPath : null;
          if (anyAudioPath || recentAudioPath || printedAudioPath) {
            resultPath = anyAudioPath || recentAudioPath || printedAudioPath;
            console.log("✅ Tải audio thành công:", resultPath);
          } else {
            try {
              const dirEntries = fs.existsSync(cacheDir)
                ? fs.readdirSync(cacheDir).slice(-30)
                : [];
              console.log("⚠️ Không tìm thấy output theo base:", outputBase);
              if (printedPath) {
                console.log(
                  "⚠️ yt-dlp in ra filepath nhưng không tồn tại:",
                  printedPath,
                );
              }
              console.log("⚠️ Cache files gần đây:", dirEntries);
            } catch (_) {}
            reject(new Error("Không tạo được file audio"));
            return;
          }
        }

        if (!resultPath) {
          reject(new Error("Không tạo được file audio"));
          return;
        }

        Promise.resolve(printedTitle || null)
          .then((title) => {
            resolve({ audioPath: resultPath, title });
          })
          .catch(() => resolve({ audioPath: resultPath, title: null }));
      } catch (execError) {
        const detailed = getExecErrorDetails(execError);
        console.error("Lỗi tải video:", detailed || execError.message);

        const details = String(detailed || execError.message || "");
        if (
          details.includes("Sign in to confirm you’re not a bot") ||
          details.includes("Sign in to confirm you're not a bot")
        ) {
          return reject(
            new Error(
              "YouTube yêu cầu xác thực. Hãy đăng nhập browser và cấu hình cookie cho bot. Gợi ý: export cookies ra file cache/youtube_cookies.txt rồi đặt ENV YTDLP_COOKIES_FILE=cache/youtube_cookies.txt",
            ),
          );
        }

        reject(new Error("Lỗi tải video: " + (detailed || execError.message)));
      }
    } catch (error) {
      reject(error);
    }
  });
}

async function downloadWithYtDlpExec(ytDlpExec, url, audioPath, m4aPath) {
  try {
    await ytDlpExec(
      url,
      {
        format: "bestaudio[ext=m4a]/bestaudio",
        output: m4aPath,
        noWarnings: true,
        noCheckCertificate: true,
        noProgress: true,
      },
      {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    if (fs.existsSync(m4aPath)) {
      console.log("✅ Tải M4A thành công:", m4aPath);
      const title = await getYouTubeTitle(url).catch(() => null);
      return { audioPath: m4aPath, title };
    }
  } catch (_) {}

  await ytDlpExec(
    url,
    {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: 5,
      output: `${audioPath.replace(".mp3", "")}.%(ext)s`,
      noWarnings: true,
      noCheckCertificate: true,
      noProgress: true,
    },
    {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (fs.existsSync(m4aPath)) {
    const title = await getYouTubeTitle(url).catch(() => null);
    return { audioPath: m4aPath, title };
  }
  if (fs.existsSync(audioPath)) {
    const title = await getYouTubeTitle(url).catch(() => null);
    return { audioPath, title };
  }

  throw new Error("Không tạo được file audio từ yt-dlp-exec");
}

/**
 * Lấy tiêu đề từ SoundCloud
 */
async function getSoundCloudTitle(url) {
  try {
    const ytDlpExec = getYtDlpExec();
    if (ytDlpExec) {
      const info = await ytDlpExec(url, {
        dumpJson: true,
        noWarnings: true,
        noCheckCertificate: true,
      });
      if (typeof info === "object" && info.title) {
        return info.title;
      }
    }

    if (canUseYtDlpCli()) {
      try {
        const result = execYtDlpCommand(buildYtDlpCommand(`-j "${url}"`), {
          stdio: "pipe",
          timeout: 10000,
          encoding: "utf8",
        });
        const info = JSON.parse(result);
        if (info && info.title) return info.title;
      } catch (_) {}
    }
  } catch (e) {
    console.log("⚠️ Không lấy được tiêu đề SoundCloud:", e.message);
  }
  return null;
}

/**
 * Tải audio từ SoundCloud
 */
async function downloadSoundCloudTomusic(url, cacheDir) {
  try {
    // Tạo tên file an toàn để tránh ký tự đặc biệt trên Windows
    const safeId = Buffer.from(url)
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 24);
    const outputBase = path.join(cacheDir, `soundcloud_${safeId}`);

    // Nếu file đã tồn tại, trả về ngay
    const cachedPath = findFirstExistingAudio(outputBase);
    if (cachedPath) {
      console.log("✅ Sử dụng SoundCloud cache:", cachedPath);
      const title = await getSoundCloudTitle(url).catch(() => null);
      return { audioPath: cachedPath, title };
    }

    console.log("📥 Tải audio từ SoundCloud...");

    const ytDlpExec = getYtDlpExec();
    if (ytDlpExec) {
      console.log("📦 Sử dụng yt-dlp-exec cho SoundCloud");
      await ytDlpExec(
        url,
        {
          // Ưu tiên lấy stream mp3 trực tiếp để không cần ffmpeg
          format: "http_mp3/hls_mp3/bestaudio[ext=mp3]/bestaudio",
          output: `${outputBase}.%(ext)s`,
          noWarnings: true,
          noCheckCertificate: true,
          noProgress: true,
        },
        {
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const outputPath = findFirstExistingAudio(outputBase);
      if (outputPath) {
        const title = await getSoundCloudTitle(url).catch(() => null);
        console.log("✅ Tải SoundCloud thành công:", outputPath);
        return { audioPath: outputPath, title };
      }
    }

    // Fallback to command line yt-dlp
    if (canUseYtDlpCli()) {
      const command = buildYtDlpCommand(
        `-f "http_mp3/hls_mp3/bestaudio[ext=mp3]/bestaudio" -o "${outputBase}.%(ext)s" "${url}"`,
      );
      console.log("📦 Sử dụng yt-dlp command");

      execSync(command, {
        stdio: "pipe",
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const outputPath = findFirstExistingAudio(outputBase);
      if (outputPath) {
        const title = await getSoundCloudTitle(url).catch(() => null);
        console.log("✅ Tải SoundCloud thành công:", outputPath);
        return { audioPath: outputPath, title };
      }
    }

    throw new Error(
      "Lỗi tải SoundCloud - không có định dạng audio phù hợp hoặc file không được tạo",
    );
  } catch (error) {
    console.error("❌ Lỗi downloadSoundCloudTomusic:", error.message);
    throw error;
  }
}

function findFirstExistingAudio(outputBase) {
  const extensions = ["mp3", "m4a", "opus", "webm", "ogg"];
  for (const ext of extensions) {
    const filePath = `${outputBase}.${ext}`;
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  // Fallback: lấy file bất kỳ có cùng base name (phòng trường hợp yt-dlp tạo đuôi khác)
  try {
    const dir = path.dirname(outputBase);
    const base = path.basename(outputBase);
    if (!fs.existsSync(dir)) return null;

    const entries = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(`${base}.`))
      .filter((name) => !name.endsWith(".part") && !name.endsWith(".ytdl"))
      .map((name) => ({
        name,
        fullPath: path.join(dir, name),
        stat: fs.statSync(path.join(dir, name)),
      }))
      .filter((item) => item.stat.isFile() && item.stat.size > 0)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    if (entries.length > 0) {
      return entries[0].fullPath;
    }
  } catch (_) {}

  return null;
}

function findRecentAudioInDir(dirPath, minMtimeMs, preferredBaseName) {
  try {
    if (!fs.existsSync(dirPath)) return null;

    const extensions = new Set([
      "music",
      "m4a",
      "opus",
      "webm",
      "ogg",
      "aac",
      "mp4",
      "flac",
      "wav",
    ]);
    const entries = fs
      .readdirSync(dirPath)
      .map((name) => {
        const fullPath = path.join(dirPath, name);
        const stat = fs.statSync(fullPath);
        return { name, fullPath, stat };
      })
      .filter((item) => item.stat.isFile() && item.stat.size > 0)
      .filter((item) => item.stat.mtimeMs >= minMtimeMs)
      .filter((item) => {
        const lower = item.name.toLowerCase();
        if (lower.endsWith(".part") || lower.endsWith(".ytdl")) return false;
        const dot = lower.lastIndexOf(".");
        if (dot < 0) return false;
        return extensions.has(lower.slice(dot + 1));
      })
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    if (!entries.length) return null;

    if (preferredBaseName) {
      const preferred = entries.find((item) =>
        item.name.startsWith(`${preferredBaseName}.`),
      );
      if (preferred) return preferred.fullPath;
    }

    return entries[0].fullPath;
  } catch (_) {
    return null;
  }
}

/**
 * Định dạng giây -> HH:MM:SS hoặc MM:SS
 */
function formatDuration(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds) || seconds <= 0)
    return "??:??";
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function normalizeDurationValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.floor(numeric);
    }

    const parsed = parseDurationString(trimmed);
    if (typeof parsed === "number" && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

async function scrapeYouTubeDuration(url) {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const html = String(response && response.data ? response.data : "");

    const candidates = [
      /"lengthSeconds":"?(\d+)"?/,
      /"approxDurationMs":"?(\d+)"?/, 
      /"durationSeconds":"?(\d+)"?/, 
    ];

    for (const regex of candidates) {
      const match = html.match(regex);
      if (match && match[1]) {
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > 0) {
          if (String(regex).includes("approxDurationMs")) {
            return Math.floor(value / 1000);
          }
          return Math.floor(value);
        }
      }
    }
  } catch (error) {
    console.log(`⚠️ scrape duration failed for ${url}:`, error && error.message ? error.message : error);
  }

  return null;
}

async function scrapeYouTubePageMetadata(url) {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const html = String(response && response.data ? response.data : "");

    let title = null;
    let duration = null;

    const ogTitleMatch = html.match(
      /<meta\s+property=(?:"|')og:title(?:"|')\s+content=(?:"|')([^"']+)(?:"|')/i,
    );
    if (ogTitleMatch && ogTitleMatch[1]) {
      title = String(ogTitleMatch[1]).trim();
    }

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (!title && titleMatch && titleMatch[1]) {
      title = String(titleMatch[1]).trim().replace(/\s+-\s+YouTube$/i, "");
    }

    const playerResponseMatch = html.match(
      /var ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s,
    );
    if (playerResponseMatch && playerResponseMatch[1]) {
      try {
        const playerResponse = JSON.parse(playerResponseMatch[1]);
        const videoDetails = playerResponse && playerResponse.videoDetails ? playerResponse.videoDetails : null;
        if (videoDetails) {
          if (!title && videoDetails.title) {
            title = String(videoDetails.title).trim();
          }
          duration =
            normalizeDurationValue(videoDetails.lengthSeconds) ||
            normalizeDurationValue(videoDetails.length_seconds) ||
            normalizeDurationValue(videoDetails.lengthText) ||
            normalizeDurationValue(videoDetails.duration) ||
            duration;
        }
      } catch (_) {}
    }

    return {
      title,
      duration,
      url,
    };
  } catch (error) {
    console.log(`⚠️ scrape metadata failed for ${url}:`, error && error.message ? error.message : error);
    return { title: null, duration: null, url };
  }
}

function collectVideoRenderers(node, output) {
  if (!node || typeof node !== "object" || output.length >= 20) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectVideoRenderers(item, output);
      if (output.length >= 20) break;
    }
    return;
  }

  if (node.videoRenderer && typeof node.videoRenderer === "object") {
    output.push(node.videoRenderer);
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      collectVideoRenderers(value, output);
      if (output.length >= 20) break;
    }
  }
}

function extractYouTubeSearchJson(html) {
  const text = String(html || "");
  const patterns = [
    /var ytInitialData\s*=\s*(\{.+?\})\s*;/s,
    /ytInitialData\s*=\s*(\{.+?\})\s*;/s,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (_) {}
    }
  }

  return null;
}

function parseYouTubeSearchResults(html, limit = 5) {
  try {
    const data = extractYouTubeSearchJson(html);
    if (!data) return [];

    const renderers = [];
    collectVideoRenderers(data, renderers);

    const results = [];
    for (const renderer of renderers) {
      if (results.length >= limit) break;
      const videoId = renderer.videoId;
      if (!videoId) continue;

      const titleRuns = renderer.title && Array.isArray(renderer.title.runs) ? renderer.title.runs : [];
      const title = titleRuns.map((run) => run.text).filter(Boolean).join("").trim() || null;
      const durationText = renderer.lengthText && (renderer.lengthText.simpleText || (Array.isArray(renderer.lengthText.runs) ? renderer.lengthText.runs.map((run) => run.text).join("") : null));
      const duration = normalizeDurationValue(durationText) || normalizeDurationValue(renderer.lengthSeconds);

      results.push({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title,
        duration,
      });
    }

    return results;
  } catch (error) {
    console.log("⚠️ parseYouTubeSearchResults failed:", error && error.message ? error.message : error);
    return [];
  }
}

/**
 * Lấy thông tin (title,duration) của video bằng yt-dlp nếu có
 */
async function getYouTubeInfo(url) {
  console.log('DBG getYouTubeInfo called for', url);
  try {
    let title = null;
    let duration = null;

    // Try oEmbed first (fast, doesn't require yt-dlp)
    try {
      const oembed = await axios.get("https://www.youtube.com/oembed", {
        params: { url, format: "json" },
        timeout: 6000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (oembed && oembed.data && oembed.data.title) {
        console.log(`ℹ️ oEmbed title for ${url}:`, oembed.data.title);
        title = title || String(oembed.data.title).trim();
      } else {
        console.log(`⚠️ oEmbed returned no title for ${url}`);
      }
    } catch (e) {
      console.log(`⚠️ oEmbed failed for ${url}:`, e && e.message ? e.message : e);
      // ignore, fallback to other methods
    }

    const ytDlpExec = getYtDlpExec();
    if (ytDlpExec) {
      const info = await ytDlpExec(url, { dumpJson: true, noWarnings: true, noCheckCertificate: true });
      if (info && typeof info === "object") {
        if (Array.isArray(info.entries) && info.entries.length > 0) {
          const first = info.entries[0] || {};
          title = title || first.title || info.title || null;
          duration =
            duration ||
            normalizeDurationValue(first.duration) ||
            normalizeDurationValue(first.duration_string) ||
            normalizeDurationValue(info.duration) ||
            normalizeDurationValue(info.duration_string) ||
            normalizeDurationValue(info.duration_raw);
          url = first.webpage_url || first.url || info.webpage_url || url;
        } else {
          title = title || info.title || null;
          duration =
            duration ||
            normalizeDurationValue(info.duration) ||
            normalizeDurationValue(info.duration_string) ||
            normalizeDurationValue(info.duration_raw);
          url = info.webpage_url || url;
        }
      }
    }

    if (canUseYtDlpCli()) {
      try {
        const out = execYtDlpCommand(buildYtDlpCommand(`-j "${url}"`), { stdio: "pipe", timeout: 8000, encoding: "utf8" });
        const info = JSON.parse(out);
        title = title || info.title || null;
        duration =
          duration ||
          normalizeDurationValue(info.duration) ||
          normalizeDurationValue(info.duration_string) ||
          normalizeDurationValue(info.duration_raw);
        url = info.webpage_url || url;
      } catch (_) {}
    }

    const scrapedMetadata = await scrapeYouTubePageMetadata(url);
    if (scrapedMetadata && (scrapedMetadata.title || scrapedMetadata.duration)) {
      title = title || scrapedMetadata.title || null;
      duration = duration || scrapedMetadata.duration || null;
    }

    // Fallback to title helper if still missing
    if (!title) {
      title = await getYouTubeTitle(url).catch(() => null);
    }

    return { title: title || null, duration: duration || null, url };
  } catch (e) {
    return { title: null, duration: null, url };
  }
}

/**
 * Tìm kiếm YouTube và trả về danh sách kết quả (url,title,duration)
 */
async function searchYouTubeList(query, limit = 5) {
  try {
    global.musicSearchCache = global.musicSearchCache || {};
    const cacheKey = `${SEARCH_CACHE_VERSION}:${query}::${limit}`;
    const cached = global.musicSearchCache[cacheKey];
    if (
      cached &&
      Date.now() - cached.ts < SEARCH_CACHE_TTL &&
      Array.isArray(cached.results) &&
      cached.results.length > 0 &&
      cached.results.every((item) => {
        const normalizedDuration = normalizeDurationValue(item && item.duration);
        return item && (item.title || item.url) && typeof normalizedDuration === "number";
      })
    ) {
      return cached.results;
    }

    const results = [];
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Ưu tiên scrape trực tiếp trang search của YouTube để lấy luôn title + duration
        try {
          const res = await axios.get(`https://www.youtube.com/results`, {
            params: { search_query: query },
            timeout: 8000,
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          const scrapedResults = parseYouTubeSearchResults(res.data, limit);
          if (scrapedResults.length) {
            for (const item of scrapedResults) {
              results.push(item);
              if (results.length >= limit) break;
            }
          }
        } catch (e) {
          console.log("⚠️ search page scrape failed:", e && e.message ? e.message : e);
        }

        // Nếu scrape search page chưa đủ, thử yt-dlp CLI / bundled
        if (results.length < limit && canUseYtDlpCli()) {
          try {
            const raw = execYtDlpCommand(
              buildYtDlpCommand(`"ytsearch${limit}:${query}" --dump-json -j`),
              { stdio: "pipe", timeout: 10000, encoding: "utf8" },
            );
            const lines = raw
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean);
            for (const line of lines) {
              if (results.length >= limit) break;
              try {
                const info = JSON.parse(line);
                if (!info) continue;
                if (Array.isArray(info.entries) && info.entries.length > 0) {
                  for (const entry of info.entries) {
                    if (!entry) continue;
                    results.push({
                      url: entry.webpage_url || entry.url,
                      title: entry.title || null,
                      duration:
                        normalizeDurationValue(entry.duration) ||
                        normalizeDurationValue(entry.duration_string) ||
                        normalizeDurationValue(entry.duration_raw),
                    });
                    if (results.length >= limit) break;
                  }
                } else {
                  results.push({
                    url: info.webpage_url || info.url,
                    title: info.title || null,
                    duration:
                      normalizeDurationValue(info.duration) ||
                      normalizeDurationValue(info.duration_string) ||
                      normalizeDurationValue(info.duration_raw),
                  });
                }
              } catch (e) {
                console.log("⚠️ Failed parse line (yt-dlp):", e && e.message ? e.message : e);
              }
            }
          } catch (e) {
            console.log("⚠️ yt-dlp CLI search timed out/failed, using fallbacks:", e && e.message ? e.message : e);
          }
        }

        // If not enough results, try yt-dlp-exec (node binding)
        if (results.length < limit) {
          try {
            const ytdlp = getYtDlpExec();
            if (ytdlp) {
              const info = await ytdlp(`ytsearch${limit}:${query}`, { dumpJson: true, noWarnings: true, noCheckCertificate: true });
              // info could be array or object with entries
              const entries = Array.isArray(info) ? info : info && info.entries ? info.entries : [info];
              for (const entry of entries) {
                if (!entry) continue;
                if (results.length >= limit) break;
                results.push({
                  url: entry.webpage_url || entry.url,
                  title: entry.title || null,
                  duration:
                    normalizeDurationValue(entry.duration) ||
                    normalizeDurationValue(entry.duration_string) ||
                    normalizeDurationValue(entry.duration_raw),
                });
              }
            }
          } catch (e) {
            console.log("⚠️ yt-dlp-exec search failed:", e && e.message ? e.message : e);
          }
        }

        // Fallback scraping by videoId only if we still need more results
        if (results.length < limit) {
          try {
            const res = await axios.get(`https://www.youtube.com/results`, {
              params: { search_query: query },
              timeout: 6000,
              headers: { "User-Agent": "Mozilla/5.0" },
            });
            const ids = [];
            const re = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
            let m;
            while ((m = re.exec(res.data)) !== null && ids.length < limit) {
              if (!ids.includes(m[1])) ids.push(m[1]);
            }
            for (const id of ids) {
              if (results.length >= limit) break;
              const url = `https://www.youtube.com/watch?v=${id}`;
              const info = await getYouTubeInfo(url).catch(() => ({ title: null, duration: null, url }));
              results.push(info);
            }
          } catch (e) {
            console.log("⚠️ Scraping YouTube failed:", e && e.message ? e.message : e);
          }
        }

        if (results.length) {
          // Enrich results with metadata if missing
          for (let i = 0; i < results.length && i < limit; i++) {
            const r = results[i];
            if ((!r.title || !r.duration) && r.url) {
              try {
                const info = await getYouTubeInfo(r.url);
                if (info) {
                  r.title = r.title || info.title || r.url;
                  r.duration = normalizeDurationValue(r.duration) || normalizeDurationValue(info.duration) || null;
                }
              } catch (e) {
                console.log("⚠️ Failed to enrich result metadata:", e && e.message ? e.message : e);
              }
            }
          }

          const slice = results.slice(0, limit);
          global.musicSearchCache[cacheKey] = { ts: Date.now(), results: slice };
          return slice;
        }

        // If we reach here, no results this attempt — retry with backoff
        const backoff = 300 * attempt;
        console.log(`⚠️ search attempt ${attempt} returned no results, retrying after ${backoff}ms`);
        await sleep(backoff + Math.floor(Math.random() * 200));
      } catch (e) {
        console.log(`⚠️ search attempt ${attempt} failed:`, e && (e.message || e));
        if (attempt < maxAttempts) await sleep(300 * attempt + Math.floor(Math.random() * 300));
      }
    }

    return [];
  } catch (error) {
    console.error("Lỗi searchYouTubeList:", error && error.message ? error.message : error);
    return [];
  }
}

function parseDurationString(durationString) {
  const raw = String(durationString || "").trim();
  if (!raw) return null;
  const parts = raw.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SEARCH_CACHE_VERSION = 3;


/**
 * Xử lý reply của người dùng để chọn bài hát đã tìm
 */
module.exports.handleReply = async ({ api, event, config }) => {
  try {
    const { threadID, body, messageReply, senderID } = event;
    const prefix = config?.prefix || "!";
    console.log("DBG music.handleReply entry. threadID:", threadID, "body:", body, "hasMessageReply:", !!messageReply);
    if (!messageReply) return;
    global.musicSearchSessions = global.musicSearchSessions || {};
    const session = global.musicSearchSessions[threadID];
    console.log("DBG music.handleReply session:", !!session, "session info:", session ? { messageID: session.messageID, requester: session.requester } : null);
    if (!session) return;
    console.log("DBG music.handleReply check senderID:", String(messageReply.senderID), "vs", String(api.getCurrentUserID()));
    if (String(messageReply.senderID) !== String(api.getCurrentUserID())) return;
    console.log("DBG music.handleReply check messageID:", String(messageReply.messageID), "vs", String(session.messageID));
    if (String(messageReply.messageID) !== String(session.messageID)) return;

    const pick = parseInt((body || "").trim(), 10);
    if (!Number.isInteger(pick) || pick < 1 || pick > session.results.length) {
      return api.sendMessage("❌ Vui lòng reply 1 số hợp lệ từ danh sách (1-5).", threadID);
    }

    // Chỉ cho người yêu cầu ban đầu chọn
    if (String(senderID) !== String(session.requester)) {
      return api.sendMessage("⚠️ Chỉ người đã yêu cầu tìm nhạc mới được chọn kết quả.", threadID);
    }

    const chosen = session.results[pick - 1];
    if (!chosen || !chosen.url) return api.sendMessage("❌ Lỗi kết quả đã chọn.", threadID);

    // Thử unsend (xóa) tin nhắn tìm kiếm của bot ngay khi đã chọn
    try {
      if (session.messageID) await api.unsendMessage(session.messageID);
    } catch (e) {
      console.log("⚠️ Không thể unsend message search:", e && e.message ? e.message : e);
    }

    // Giảm thể lực và tiến hành tải
    let energyUse;
    let energyConnection;
    try {
      energyConnection = await getConnection();
      energyUse = await consumeEnergy(energyConnection, senderID, 25);
      if (!energyUse.ok) {
        if (energyUse.reason === "not_enough") {
          return api.sendMessage(energyUse.message, threadID);
        }
        return api.sendMessage(`❌ Không thể kiểm tra thể lực lúc này.\nGõ ${prefix}tien để tạo thể lực`, threadID);
      }
    } catch (e) {
      console.error("Energy check error (music handleReply):", e);
      return api.sendMessage("❌ Lỗi hệ thống thể lực.", threadID);
    } finally {
      if (energyConnection) energyConnection.release();
    }

    // Bắt đầu tải và gửi file
    const cacheDir = session.cacheDir || path.resolve(__dirname, "../../../cache/music");
    try {
      await api.sendMessage("⏳ Đang tải bài hát...", threadID);
      if (chosen.url.includes("youtube.com") || chosen.url.includes("youtu.be")) {
        const result = await downloadYouTubeTomusic(chosen.url, cacheDir);
        if (!result || !result.audioPath || !fs.existsSync(result.audioPath)) {
          return api.sendMessage("❌ Lỗi tải video từ YouTube", threadID);
        }

        const fileStats = fs.statSync(result.audioPath);
        if (fileStats.size === 0) {
          try { fs.unlinkSync(result.audioPath); } catch (_) {}
          return api.sendMessage("❌ File audio rỗng", threadID);
        }

        if (fileStats.size > 25 * 1024 * 1024) {
          try { fs.unlinkSync(result.audioPath); } catch (_) {}
          return api.sendMessage("❌ File quá lớn! (Facebook giới hạn 25MB)", threadID);
        }

        // Prefer the cached title from session if available
        const cachedTitle = session && session.results && session.results[pick - 1] && session.results[pick - 1].title;
        const title = (cachedTitle || result.title || "Unknown").substring(0, 100);
        await api.sendMessage({ body: `🎵 ${title}\n⚡ Thể lực: -25 (${energyUse.energy}/${energyUse.maxEnergy})`, attachment: fs.createReadStream(result.audioPath) }, threadID);

        setTimeout(() => { try { if (fs.existsSync(result.audioPath)) fs.unlinkSync(result.audioPath); } catch (_) {} }, 10000);
      } else if (chosen.url.includes("soundcloud.com")) {
        const result = await downloadSoundCloudTomusic(chosen.url, cacheDir);
        if (!result || !result.audioPath || !fs.existsSync(result.audioPath)) {
          return api.sendMessage("❌ Lỗi tải audio từ SoundCloud", threadID);
        }

        const fileStats = fs.statSync(result.audioPath);
        if (fileStats.size === 0) {
          try { fs.unlinkSync(result.audioPath); } catch (_) {}
          return api.sendMessage("❌ File audio rỗng", threadID);
        }

        if (fileStats.size > 25 * 1024 * 1024) {
          try { fs.unlinkSync(result.audioPath); } catch (_) {}
          return api.sendMessage("❌ File quá lớn! (Facebook giới hạn 25MB)", threadID);
        }

        const title = result.title ? result.title.substring(0, 100) : "Unknown";
        await api.sendMessage({ body: `🎵 ${title}\n⚡ Thể lực: -25 (${energyUse.energy}/${energyUse.maxEnergy})`, attachment: fs.createReadStream(result.audioPath) }, threadID);

        setTimeout(() => { try { if (fs.existsSync(result.audioPath)) fs.unlinkSync(result.audioPath); } catch (_) {} }, 10000);
      } else {
        return api.sendMessage("❌ URL không hỗ trợ.", threadID);
      }
    } catch (err) {
      console.error("❌ Lỗi trong handleReply music:", err);
      return api.sendMessage(`❌ Lỗi: ${err.message || 'Không thể tải bài hát'}`, threadID);
    } finally {
      // Xóa session sau khi xử lý
      try { delete global.musicSearchSessions[threadID]; } catch (_) {}
    }
  } catch (error) {
    console.error("Lỗi music.handleReply:", error);
  }
};
