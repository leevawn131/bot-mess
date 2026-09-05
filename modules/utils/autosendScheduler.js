const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { execute } = require("./database");
const { ensureAutosendSchema } = require("./autosendSchema");
const { getCustomPrefix } = require("./customPrefix");
const { isMainThread, workerData } = require('worker_threads');

// Đường dẫn cache tạm để tải media từ URL
const TEMP_CACHE_DIR = path.join(__dirname, "../../cache", "autosend_temp");
if (!fs.existsSync(TEMP_CACHE_DIR)) {
  fs.mkdirSync(TEMP_CACHE_DIR, { recursive: true });
}

/**
 * Tìm lệnh dựa vào tên lệnh hoặc alias
 */
function resolveCommand(commandName) {
  const key = String(commandName || "").trim().toLowerCase();
  if (!key || !global.commands || !(global.commands instanceof Map)) return null;

  const direct = global.commands.get(commandName) || global.commands.get(key);
  if (direct) return direct;

  for (const command of global.commands.values()) {
    const names = [command?.name, command?.config?.name]
      .concat(command?.aliases || [])
      .concat(command?.config?.aliases || [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);

    if (names.includes(key)) {
      return command;
    }
  }

  return null;
}

/**
 * Lấy các thành phần thời gian Việt Nam (UTC+7)
 */
function getVNTimeInfo(date = new Date()) {
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  
  const hours = String(vnTime.getUTCHours()).padStart(2, "0");
  const minutes = String(vnTime.getUTCMinutes()).padStart(2, "0");
  const timeKey = `${hours}:${minutes}`; // định dạng HH:mm
  
  const dayOfMonth = vnTime.getUTCDate(); // 1 - 31
  
  const dayOfWeekVal = vnTime.getUTCDay(); // 0 (CN) - 6 (T7)
  const daysMap = ["cn", "t2", "t3", "t4", "t5", "t6", "t7"];
  const dayOfWeekStr = daysMap[dayOfWeekVal];
  
  const year = vnTime.getUTCFullYear();
  const month = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(vnTime.getUTCDate()).padStart(2, "0");
  const dateKey = `${year}-${month}-${day}`; // YYYY-MM-DD
  
  return { timeKey, dayOfMonth, dayOfWeekStr, dateKey };
}

/**
 * Tải file từ URL về thư mục tạm và trả về đường dẫn file cục bộ
 */
async function downloadMedia(url, ext = ".tmp") {
  try {
    const filename = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    const filePath = path.join(TEMP_CACHE_DIR, filename);
    
    const response = await axios({
      method: "get",
      url: url,
      responseType: "stream",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    // Lấy extension thật từ content-type nếu có thể
    let finalPath = filePath;
    const contentType = response.headers["content-type"] || "";
    if (contentType.includes("image/")) {
      const type = contentType.split("/")[1] || "png";
      finalPath = filePath.replace(ext, `.${type}`);
    } else if (contentType.includes("video/")) {
      const type = contentType.split("/")[1] || "mp4";
      finalPath = filePath.replace(ext, `.${type}`);
    } else if (contentType.includes("audio/")) {
      const type = contentType.split("/")[1] || "mp3";
      finalPath = filePath.replace(ext, `.${type}`);
    }

    const writer = fs.createWriteStream(finalPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve(finalPath));
      writer.on("error", (err) => {
        fs.unlink(finalPath, () => {});
        reject(err);
      });
    });
  } catch (error) {
    console.error("Lỗi khi tải file media từ URL:", url, error.message);
    return null;
  }
}

/**
 * Quét các lịch gửi tin và thực thi gửi
 */
// Set lưu trữ các job_id đang được xử lý trong bộ nhớ để tránh race condition
const runningJobs = new Set();

/**
 * Quét các lịch gửi tin và thực thi gửi
 */
async function checkAndSendAutosend(api) {
  try {
    await ensureAutosendSchema();
    const { timeKey, dayOfMonth, dayOfWeekStr, dateKey } = getVNTimeInfo();

    // Lấy các lịch gửi có giờ <= giờ hiện tại, đang hoạt động, chưa gửi hôm nay
    const activeJobs = await execute(
      `SELECT * FROM autosend_jobs 
       WHERE time <= ? 
       AND status = 1 
       AND (last_sent IS NULL OR last_sent != ?)`,
      [timeKey, dateKey]
    );

    if (!activeJobs || activeJobs.length === 0) return;

    // Xác định cụm hiện tại của worker
    let myClusterId = 1;
    if (!isMainThread && workerData && workerData.clusterId) {
      myClusterId = workerData.clusterId;
    }

    console.log(`[AUTOSEND] Phát hiện ${activeJobs.length} lịch có thể chạy vào/trước lúc ${timeKey}`);

    for (const job of activeJobs) {
      if (runningJobs.has(job.id)) {
        console.log(`[AUTOSEND] Job ID ${job.id} đang được thực thi ở đợt trước, bỏ qua.`);
        continue;
      }

      let isMatchSchedule = false;
      const st = String(job.schedule_type || "daily").toLowerCase().trim();

      if (st === "daily") {
        isMatchSchedule = true;
      } else if (st === `monthly${dayOfMonth}`) {
        isMatchSchedule = true;
      } else {
        // Kiểm tra xem schedule_type có chứa thứ hiện tại không (ví dụ "t2/t4/t6" chứa "t4")
        const daysParts = st.split("/").map(d => d.trim());
        if (daysParts.includes(dayOfWeekStr)) {
          isMatchSchedule = true;
        }
      }

      if (!isMatchSchedule) {
        continue;
      }

      // Phân rải autosend: Chỉ thực thi nếu nhóm này thuộc về Cụm hiện tại
      const bindings = await execute("SELECT cluster_id FROM group_profile_bindings WHERE thread_id = ?", [job.thread_id]);
      let targetCluster = 1; // Mặc định nhóm chưa gán sẽ do Cụm 1 gánh
      if (bindings && bindings.length > 0) {
        targetCluster = bindings[0].cluster_id;
      }

      if (myClusterId !== targetCluster) {
        continue; // Bỏ qua, để Cụm khác xử lý
      }

      runningJobs.add(job.id);
      console.log(`[AUTOSEND] Thực thi Job ID ${job.id} cho nhóm ${job.thread_id} (tại Cụm ${myClusterId})`);

      // Cập nhật ngay last_sent trong DB để tránh race condition và lặp vô tận khi tin nhắn bị delay/timeout
      await execute("UPDATE autosend_jobs SET last_sent = ? WHERE id = ?", [dateKey, job.id]).catch(() => {});

      // Thực thi công việc bất đồng bộ độc lập
      (async () => {
        try {
          const currentApi = global.client && global.client.api ? global.client.api : api;

          // 1. Kiểm tra xem tin nhắn có phải là lệnh bot hay không (Thực thi lệnh ngầm)
          if (job.message) {
            try {
              const customPrefix = await getCustomPrefix(job.thread_id);
              const config = require("../../config.json");
              const defaultPrefix = config.prefix || "!";
              const prefix = customPrefix || defaultPrefix;

              const msgStr = String(job.message).trim();
              if (msgStr.startsWith(prefix) && msgStr.length > prefix.length) {
                const commandText = msgStr.slice(prefix.length).trim();
                const rawArgs = commandText ? commandText.split(/ +/) : [];
                
                if (rawArgs.length > 0) {
                  const args = [...rawArgs];
                  const commandName = args.shift().toLowerCase();
                  const command = resolveCommand(commandName);
                  
                  if (command) {
                    console.log(`[AUTOSEND] Phát hiện lệnh ngầm: "${commandName}" (args: ${JSON.stringify(args)}). Thực thi trực tiếp.`);
                    const mockEvent = {
                      type: "message",
                      messageID: `autosend_cmd_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                      threadID: job.thread_id,
                      senderID: job.created_by || global.botID || currentApi.getCurrentUserID(),
                      body: job.message,
                      args: args,
                      mentions: {},
                      attachments: [],
                      messageReply: null,
                      timestamp: Date.now(),
                      isGroup: true
                    };

                    try {
                      console.log(`[AUTOSEND] Đang thực thi lệnh ngầm "${commandName}" cho Job ID ${job.id}...`);
                      await Promise.race([
                        command.execute({
                          api: currentApi,
                          event: mockEvent,
                          args,
                          config: { ...global.config, prefix }
                        }),
                        new Promise((_, rej) => setTimeout(() => rej(new Error("Lệnh ngầm quá 30s timeout")), 30000))
                      ]);
                      await execute("UPDATE autosend_jobs SET last_sent = ? WHERE id = ?", [dateKey, job.id]);
                      console.log(`[AUTOSEND] Đã thực thi xong lệnh ngầm ID ${job.id} (${commandName})`);
                    } catch (cmdErr) {
                      console.error(`[AUTOSEND] ⚠️ Lỗi thực thi lệnh ngầm ID ${job.id} (${commandName}):`, cmdErr.message || cmdErr);
                      // Đánh dấu đã gửi trong ngày để tránh vòng lặp quét liên tục mỗi 30s khi acc bị die / rate-limit
                      try {
                        await execute("UPDATE autosend_jobs SET last_sent = ? WHERE id = ?", [dateKey, job.id]);
                      } catch (e) {}
                    }
                    return;
                  }
                }
              }
            } catch (prefixErr) {
              console.error(`[AUTOSEND] Lỗi phân tích lệnh ngầm cho Job ID ${job.id}:`, prefixErr);
            }
          }

          console.log(`[AUTOSEND] Thực thi gửi tin nhắn thông thường cho Job ID ${job.id} tới nhóm ${job.thread_id}`);

          // Thực thi gửi tin nhắn thông thường
          let attachment = null;
          let isTempFile = false;
          let tempFilePath = null;

          try {
            if (job.media_path) {
              const media = job.media_path.trim();
              if (media.startsWith("http://") || media.startsWith("https://")) {
                let ext = ".png";
                try {
                  const urlPath = new URL(media).pathname;
                  const pathExt = path.extname(urlPath);
                  if (pathExt) ext = pathExt;
                } catch (e) {}

                const downloadedPath = await downloadMedia(media, ext);
                if (downloadedPath && fs.existsSync(downloadedPath)) {
                  attachment = fs.createReadStream(downloadedPath);
                  tempFilePath = downloadedPath;
                  isTempFile = true;
                }
              } else {
                const localPath = path.isAbsolute(media) 
                ? media 
                  : path.resolve(__dirname, "../../", media);
                
                if (fs.existsSync(localPath)) {
                  attachment = fs.createReadStream(localPath);
                } else {
                  console.warn(`[AUTOSEND] File media cục bộ không tồn tại: ${localPath}`);
                }
              }
            }

            let messageToSend = null;
            if (attachment) {
              messageToSend = {
                body: job.message || "",
                attachment: attachment
              };
            } else if (job.message) {
              messageToSend = job.message;
            }

            if (!messageToSend) {
              console.warn(`[AUTOSEND] Job ID ${job.id} không có cả nội dung và attachment.`);
              return;
            }

            // Gửi tin nhắn có timeout 15 giây phòng trường hợp callback bị treo
            await new Promise((resolve) => {
              let isResolved = false;
              const timeout = setTimeout(async () => {
                if (!isResolved) {
                  isResolved = true;
                  console.warn(`[AUTOSEND] Gửi tin nhắn Job ID ${job.id} quá 15s timeout.`);
                  if (isTempFile && tempFilePath && fs.existsSync(tempFilePath)) {
                    fs.unlink(tempFilePath, () => {});
                  }
                  await execute("UPDATE autosend_jobs SET last_sent = ? WHERE id = ?", [dateKey, job.id]).catch(() => {});
                  resolve();
                }
              }, 15000);

              currentApi.sendMessage(messageToSend, job.thread_id, async (err, info) => {
                if (!isResolved) {
                  isResolved = true;
                  clearTimeout(timeout);
                  if (isTempFile && tempFilePath && fs.existsSync(tempFilePath)) {
                    fs.unlink(tempFilePath, () => {});
                  }

                  if (err) {
                    console.error(`[AUTOSEND] ⚠️ Lỗi gửi tin nhắn Job ID ${job.id} tới nhóm ${job.thread_id}:`, err.message || err);
                    try {
                      await execute("UPDATE autosend_jobs SET last_sent = ? WHERE id = ?", [dateKey, job.id]);
                    } catch(dbErr) {}
                  } else {
                    console.log(`[AUTOSEND] Đã gửi thành công Job ID ${job.id} tới nhóm ${job.thread_id}`);
                    // Cập nhật trạng thái thành công
                    try {
                      await execute("UPDATE autosend_jobs SET last_sent = ? WHERE id = ?", [dateKey, job.id]);
                    } catch(dbErr) {
                      console.error(`[AUTOSEND] Lỗi cập nhật DB sau khi gửi Job ID ${job.id}:`, dbErr);
                    }
                  }
                  resolve();
                }
              });
            });

          } catch (err) {
            console.error(`[AUTOSEND] Lỗi xử lý Job ID ${job.id}:`, err.message);
            if (isTempFile && tempFilePath && fs.existsSync(tempFilePath)) {
              fs.unlink(tempFilePath, () => {});
            }
            await execute("UPDATE autosend_jobs SET last_sent = ? WHERE id = ?", [dateKey, job.id]).catch(() => {});
          }
        } finally {
          runningJobs.delete(job.id);
        }
      })();
    }
  } catch (e) {
    console.error("[AUTOSEND] Lỗi trong Scheduler quét autosend:", e);
  }
}

// 1. Dọn dẹp tiến trình cũ nếu nó đang tồn tại trong RAM
if (global.autosendSchedulerInterval) {
  clearInterval(global.autosendSchedulerInterval);
}

console.log("⏰ Đã kích hoạt Scheduler gửi tin nhắn tự động (autosend) - Quét mỗi 30 giây");

// 2. Bắt đầu tiến trình mới ngay khi file được require
global.autosendSchedulerInterval = setInterval(() => {
  const currentApi = (global.client && global.client.api) ? global.client.api : null;
  if (currentApi) {
    checkAndSendAutosend(currentApi).catch(e => console.error("Lỗi quét autosend định kỳ:", e));
  }
}, 30000);

// Quét ngay lập tức khi khởi động nếu có API
if (global.client && global.client.api) {
  checkAndSendAutosend(global.client.api).catch(e => console.error("Lỗi quét autosend ban đầu:", e));
}

module.exports = {
  getVNTimeInfo,
  checkAndSendAutosend
};
