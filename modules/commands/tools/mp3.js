const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mysql = require("mysql2/promise");
const { checkCooldown } = require("../../utils/cooldown");
const {
  consumeEnergy,
  getDBConfigFromRuntime,
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

function canUseYtDlpCli() {
  if (ytDlpCliHealthCache !== null) {
    return ytDlpCliHealthCache;
  }

  if (!hasCommand("yt-dlp")) {
    ytDlpCliHealthCache = false;
    return false;
  }

  try {
    execSync("yt-dlp --version", {
      stdio: "pipe",
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    ytDlpCliHealthCache = true;
    return true;
  } catch (error) {
    ytDlpCliHealthCache = false;
    console.log("⚠️ yt-dlp CLI không dùng được, chuyển fallback:", getExecErrorDetails(error));
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

module.exports = {
  name: "mp3",
  description: "Tải nhạc từ YouTube hoặc SoundCloud",
  usage: "[song name] hoặc [link YouTube/SoundCloud]",
  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;

    // Cooldown 20s
    const cooldown = checkCooldown({
      command: "mp3",
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
      return api.sendMessage("❌ Lỗi cấu hình Database.", threadID, messageID);
    }

    let energyUse;
    let energyConnection;
    try {
      energyConnection = await mysql.createConnection(dbConfig);
      energyUse = await consumeEnergy(energyConnection, senderID, 20);
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
      console.error("Energy check error (mp3):", error);
      return api.sendMessage("❌ Lỗi hệ thống thể lực.", threadID, messageID);
    } finally {
      if (energyConnection) await energyConnection.end();
    }

    const cacheDir = path.resolve(__dirname, "../../../cache/mp3");

    // Tạo thư mục cache nếu chưa tồn tại
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    try {
      api.sendMessage("⏳ Đang xử lý...", threadID, messageID);

      let videoUrl = input;
      let songTitle = "";

      // Kiểm tra nếu input là link
      if (
        !input.includes("youtube.com") &&
        !input.includes("youtu.be") &&
        !input.includes("soundcloud.com")
      ) {
        // Nếu không phải link, tìm kiếm trên YouTube
        console.log("🔍 Tìm kiếm:", input);
        videoUrl = await searchYouTube(input);
        if (!videoUrl) {
          return api.sendMessage(
            "❌ Không tìm thấy bài hát!",
            threadID,
            messageID,
          );
        }
      }

      // Xử lý YouTube
      if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
        console.log("📹 Xử lý YouTube:", videoUrl);
        const result = await downloadYouTubeToMP3(videoUrl, cacheDir);

        if (!result || !result.audioPath || !fs.existsSync(result.audioPath)) {
          return api.sendMessage(
            "❌ Lỗi tải video từ YouTube",
            threadID,
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
          return api.sendMessage("❌ File audio rỗng", threadID, messageID);
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
            messageID,
          );
        }

        // Gửi file audio - hiển thị tiêu đề và thể lực
        const title = result.title ? result.title.substring(0, 100) : "Unknown";
        await api.sendMessage(
          {
            body: `🎵 ${title}\n⚡ Thể lực: -20 (${energyUse.energy}/${energyUse.maxEnergy})`,
            attachment: fs.createReadStream(result.audioPath),
          },
          threadID,
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
        const result = await downloadSoundCloudToMP3(videoUrl, cacheDir);

        if (!result || !result.audioPath || !fs.existsSync(result.audioPath)) {
          return api.sendMessage(
            "❌ Lỗi tải audio từ SoundCloud",
            threadID,
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
          return api.sendMessage("❌ File audio rỗng", threadID, messageID);
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
            messageID,
          );
        }

        const title = result.title ? result.title.substring(0, 100) : "Unknown";
        await api.sendMessage(
          {
            body: `🎵 ${title}\n⚡ Thể lực: -20 (${energyUse.energy}/${energyUse.maxEnergy})`,
            attachment: fs.createReadStream(result.audioPath),
          },
          threadID,
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
      console.error("❌ Lỗi mp3:", error);
      api.sendMessage(`❌ Lỗi: ${error.message}`, threadID, messageID);
    }
  },
};

/**
 * Tìm kiếm YouTube
 */
async function searchYouTube(query) {
  try {
    const response = await axios.get(`https://www.youtube.com/results`, {
      params: { search_query: query },
    });

    // Tìm video ID từ HTML
    const videoIdMatch = response.data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (videoIdMatch) {
      return `https://www.youtube.com/watch?v=${videoIdMatch[1]}`;
    }
    return null;
  } catch (error) {
    console.error("Lỗi tìm kiếm YouTube:", error);
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
        const result = execSync(`yt-dlp -j "${url}"`, {
          stdio: "pipe",
          timeout: 10000,
          encoding: "utf8",
        });
        const info = JSON.parse(result);
        if (info && info.title) return info.title;
      } catch (_) {}
    }
  } catch (e) {
    console.log("⚠️ Không lấy được tiêu đề:", e.message);
  }
  return null;
}

/**
 * Tải video từ YouTube và convert thành MP3 bằng youtube-dl hoặc yt-dlp
 */
async function downloadYouTubeToMP3(url, cacheDir) {
  return new Promise((resolve, reject) => {
    try {
      const videoId = url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      )?.[1];
      if (!videoId) {
        return reject(new Error("URL YouTube không hợp lệ"));
      }

      const audioPath = path.join(cacheDir, `${videoId}.mp3`);
      const m4aPath = path.join(cacheDir, `${videoId}.m4a`);

      // Nếu file đã tồn tại (MP3 hoặc M4A), trả về luôn
      if (fs.existsSync(audioPath)) {
        console.log("✅ Sử dụng MP3 cache:", audioPath);
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

      console.log("📥 Tải audio từ YouTube...");

      let command = null;

      // Thử yt-dlp trước với format M4A (Facebook hỗ trợ tốt hơn)
      try {
        if (canUseYtDlpCli()) {
          // Tải trực tiếp dạng M4A thay vì convert từ MP3
          command = `yt-dlp -f "bestaudio[ext=m4a]/bestaudio" -o "${m4aPath}" "${url}"`;
          console.log("📦 Sử dụng yt-dlp (M4A format)");

          try {
            execSync(command, {
              stdio: "pipe",
              timeout: 120000,
              maxBuffer: 10 * 1024 * 1024,
            });

            if (fs.existsSync(m4aPath)) {
              console.log("✅ Tải M4A thành công:", m4aPath);
              return getYouTubeTitle(url)
                .then((title) => resolve({ audioPath: m4aPath, title }))
                .catch(() => resolve({ audioPath: m4aPath, title: null }));
            }
          } catch (e) {
            console.log("⚠️ Tải M4A thất bại, thử MP3...");
          }

          // Nếu M4A thất bại, thử MP3
          command = `yt-dlp -x --audio-format mp3 --audio-quality 128K -o "${audioPath.replace(".mp3", "")}.%(ext)s" "${url}"`;
          console.log("📦 Sử dụng yt-dlp (MP3 format)");
        } else {
          const ytDlpExec = getYtDlpExec();
          if (!ytDlpExec) {
            throw new Error("yt-dlp not found");
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
        execSync(command, {
          stdio: "pipe",
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        });

        // Kiểm tra file nào được tạo (M4A hoặc MP3)
        let resultPath = null;
        if (fs.existsSync(m4aPath)) {
          console.log("✅ Tải và chuyển đổi thành công:", m4aPath);
          resultPath = m4aPath;
        } else if (fs.existsSync(audioPath)) {
          console.log("✅ Tải và chuyển đổi thành công:", audioPath);
          resultPath = audioPath;
        } else {
          reject(new Error("Không tạo được file audio"));
          return;
        }

        getYouTubeTitle(url)
          .then((title) => {
            resolve({ audioPath: resultPath, title });
          })
          .catch(() => resolve({ audioPath: resultPath, title: null }));
      } catch (execError) {
        const detailed = getExecErrorDetails(execError);
        console.error("Lỗi tải video:", detailed || execError.message);
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
        const result = execSync(`yt-dlp -j "${url}"`, {
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
async function downloadSoundCloudToMP3(url, cacheDir) {
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
      const command = `yt-dlp -f "http_mp3/hls_mp3/bestaudio[ext=mp3]/bestaudio" -o "${outputBase}.%(ext)s" "${url}"`;
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
    console.error("❌ Lỗi downloadSoundCloudToMP3:", error.message);
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
  return null;
}
