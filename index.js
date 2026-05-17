const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { login } = require("ws3-fca");
const {
  checkPermission,
  getGroupMode,
} = require("./modules/utils/checkPermission");
const { startModeScheduler } = require("./modules/utils/modeScheduler");
const {
  runAiConversation,
  normalizeText,
} = require("./modules/utils/aiAssistant");

// --- THREAD INFO CACHE (giảm gọi API liên tục, tránh bị Facebook throttle) ---
const _threadInfoCache = new Map();
const THREAD_INFO_TTL = 5 * 60 * 1000; // 5 phút

// Tạm tắt console.error khi gọi getThreadInfo để ws3-fca không spam log
async function _quietGetThreadInfo(api, key) {
  const _origErr = console.error;
  console.error = () => {};
  try {
    return await api.getThreadInfo(key);
  } finally {
    console.error = _origErr;
  }
}

async function getThreadInfoCached(api, threadID) {
  const key = String(threadID);
  const cached = _threadInfoCache.get(key);
  if (cached && Date.now() - cached.ts < THREAD_INFO_TTL) {
    return cached.data;
  }
  try {
    const info = await _quietGetThreadInfo(api, key);
    if (info) {
      _threadInfoCache.set(key, { data: info, ts: Date.now() });
    }
    return info;
  } catch (err) {
    // Trả về cache cũ nếu có, dù đã hết hạn
    if (cached) return cached.data;
    return null;
  }
}

const DAILY_TOP_STATE_PATH = path.join(
  __dirname,
  "cache",
  "checktt_daily_top_state.json",
);
const MONTHLY_TOP_STATE_PATH = path.join(
  __dirname,
  "cache",
  "checktt_monthly_top_state.json",
);

// 1. LOAD CONFIG
let config;
try {
  config = require("./config.json");
} catch {
  config = { prefix: "!", adminIDs: [] };
}

// Add database config
const { getDatabaseConfig } = require("./modules/utils/envConfig");
config.database = {
  ...getDatabaseConfig(),
  name: getDatabaseConfig().database, // Add 'name' field for compatibility
};

// 2. LOAD APPSTATE
const loadAppStateCredentials = () => {
  try {
    return {
      appState: JSON.parse(fs.readFileSync("appstate.json", "utf8")),
    };
  } catch (err) {
    console.error("❌ Thiếu appstate.json");
    return null;
  }
};

const getFbLoginCredentials = () => {
  const email = process.env.FB_EMAIL || process.env.FACEBOOK_EMAIL || "";
  const password =
    process.env.FB_PASSWORD || process.env.FACEBOOK_PASSWORD || "";

  if (!email || !password) return null;

  return { email, password };
};

const RETRY_BASE_DELAY_MS = 5 * 60 * 1000;
const VERIFY_RETRY_DELAY_MS = 60 * 1000;
let loginRetryTimer = null;

const shouldTryFbRefresh = (err) => {
  const message = String(err?.message || err || "").toLowerCase();

  return (
    message.includes("appstate") ||
    message.includes("cookie") ||
    message.includes("session") ||
    message.includes("expired") ||
    message.includes("invalid") ||
    message.includes("token")
  );
};

const isUserIdRetrievalError = (err) => {
  const message = String(err?.message || err || "").toLowerCase();
  return message.includes("retrieving userid");
};

const scheduleLoginRetry = (reason, delayMs = RETRY_BASE_DELAY_MS) => {
  if (loginRetryTimer) clearTimeout(loginRetryTimer);

  const nextAttemptAt = new Date(Date.now() + delayMs).toLocaleString("vi-VN");
  console.error(
    `⏳ Sẽ thử đăng nhập lại sau ${Math.ceil(delayMs / 1000)} giây (${nextAttemptAt}): ${reason}`,
  );

  loginRetryTimer = setTimeout(() => {
    loginRetryTimer = null;
    attemptLogin();
  }, delayMs);
};

// --- FIX MENTIONS HELPER ---
const ensureMentions = async (api, event) => {
  if (!event.body || !event.body.includes("@")) return event;
  if (Object.keys(event.mentions || {}).length > 0) return event;
  try {
    const history = await api.getThreadHistory(event.threadID, 5);
    const originalMsg = history.find((m) => m.messageID === event.messageID);
    if (
      originalMsg &&
      originalMsg.mentions &&
      Object.keys(originalMsg.mentions).length > 0
    ) {
      event.mentions = originalMsg.mentions;
    }
  } catch (e) {}
  return event;
};

// --- HÀM QUÉT FILE ĐỆ QUY ---
const getAllFiles = (dirPath, arrayOfFiles) => {
  try {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];
    files.forEach((file) => {
      const fullPath = path.join(dirPath, file);
      if (fs.statSync(fullPath).isDirectory()) {
        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
      } else {
        if (file.endsWith(".js")) arrayOfFiles.push(fullPath);
      }
    });
    return arrayOfFiles;
  } catch {
    return [];
  }
};

console.log("⏳ Đang kết nối tới Facebook...");

const fcaOptions = {
  online: config.fca?.online ?? true,
  listenEvents: config.fca?.listenEvents ?? true,
  selfListen: config.fca?.selfListen ?? true,
  autoReconnect: config.fca?.autoReconnect ?? true,
  updatePresence: config.fca?.updatePresence ?? false,
  autoMarkDelivery: config.fca?.autoMarkDelivery ?? false,
  autoMarkRead: config.fca?.autoMarkRead ?? true,
  forceLogin: config.fca?.forceLogin ?? false,
  emitReady: config.fca?.emitReady ?? false,
  listenTyping: config.fca?.listenTyping ?? false,
  userAgent:
    config.fca?.userAgent ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

if (config.fca?.bypassRegion) {
  fcaOptions.bypassRegion = config.fca.bypassRegion;
}

// Initialize database pool
const { initializePool } = require("./modules/utils/database");
try {
  initializePool();
  console.log("✅ Database pool initialized");
} catch (e) {
  console.error("❌ Failed to initialize database pool:", e);
}

// =================================================================
// 🚀 SERVER WEBHOOK SEPAY (NHẬN TIỀN TỰ ĐỘNG)
// =================================================================
const express = require("express");
const cors = require("cors");
const app = express();
app.use(express.json());
app.use(cors());

// SePay sẽ gọi vào link: http://ip-cua-ban:3000/webhook/sepay
app.post("/webhook/sepay", async (req, res) => {
  console.log("💳 Nhận Webhook từ SePay:", req.body);

  // Dữ liệu mẫu từ SePay
  const { transferAmount, content } = req.body;
  if (!content)
    return res.status(200).send({ success: false, message: "No content" });

  try {
    const { execute } = require("./modules/utils/database");

    // Tìm giao dịch đang chờ dựa vào Nội dung chuyển khoản
    // Vì người dùng có thể ghi kèm chữ khác, nên dùng LIKE '%BOTxxxx%'
    const pendingTx = await execute(
      "SELECT * FROM transactions WHERE status = 'pending' AND ? LIKE CONCAT('%', transaction_code, '%') LIMIT 1",
      [content],
    );

    if (pendingTx && pendingTx.length > 0) {
      const tx = pendingTx[0];

      // Kiểm tra số tiền chuyển có đủ không (Cho phép chuyển dư)
      if (transferAmount >= tx.amount) {
        // 1. Cập nhật trạng thái thành công
        await execute(
          "UPDATE transactions SET status = 'success' WHERE id = ?",
          [tx.id],
        );

        // 2. Tính toán ngày hết hạn dựa vào số tiền và Loại gói
        let months = 1;
        const isAdminPlan = tx.transaction_code.startsWith("ADM");

        if (isAdminPlan) {
          if (tx.amount >= 500000) months = 12;
          else if (tx.amount >= 300000) months = 6;
          else if (tx.amount >= 160000) months = 3;
          else months = 1;
        } else {
          if (tx.amount >= 250000) months = 12;
          else if (tx.amount >= 150000) months = 6;
          else if (tx.amount >= 80000) months = 3;
          else months = 1;
        }

        const daysToAdd = months * 30;

        // Cập nhật hoặc Insert vào bảng rented_groups
        await execute(
          `
          INSERT INTO rented_groups (thread_id, expire_date)
          VALUES (?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY))
          ON DUPLICATE KEY UPDATE expire_date = DATE_ADD(expire_date, INTERVAL ? DAY)
        `,
          [tx.thread_id, daysToAdd, daysToAdd],
        );

        console.log(`✅ Đã cộng ${daysToAdd} ngày cho nhóm ${tx.thread_id}`);

        // 3. Nếu là gói ADMIN-BOT, cấp quyền Admin
        let adminGrantedMsg = "";
        if (isAdminPlan) {
          try {
            const fs = require("fs");
            const path = require("path");
            const configPath = path.join(__dirname, "config.json");
            const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));

            if (!configData.adminIDs) configData.adminIDs = [];
            if (!configData.adminIDs.includes(tx.user_id)) {
              configData.adminIDs.push(tx.user_id);
              fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

              // Cập nhật ngay vào biến config đang chạy để có tác dụng luôn
              if (config && config.adminIDs) config.adminIDs.push(tx.user_id);
              if (global.config && global.config.adminIDs)
                global.config.adminIDs.push(tx.user_id);

              adminGrantedMsg = `\n👑 BẠN ĐÃ ĐƯỢC CẤP QUYỀN ADMIN-BOT!`;
            }
          } catch (e) {
            console.error("Lỗi cấp quyền admin:", e);
          }
        }

        // 4. Gửi tin nhắn thông báo (Sẽ thực hiện nếu api đã login)
        if (global.api_instance) {
          const planName = isAdminPlan ? "ADMIN-BOT" : "THƯỜNG";
          global.api_instance.sendMessage(
            `🎉 [ THANH TOÁN THÀNH CÔNG ] 🎉\n\n` +
              `Hệ thống đã nhận được ${transferAmount.toLocaleString("vi-VN")} VNĐ.\n` +
              `Nhóm của bạn đã được gia hạn thêm ${months} tháng sử dụng gói ${planName}!${adminGrantedMsg}\n` +
              `Cảm ơn bạn đã ủng hộ!`,
            tx.thread_id,
          );
        }
      }
    }

    res.status(200).send({ success: true });
  } catch (err) {
    console.error("❌ Lỗi xử lý webhook:", err);
    res.status(500).send({ success: false });
  }
});

const WEBHOOK_PORT = process.env.PORT || 3000;
app.listen(WEBHOOK_PORT, () => {
  console.log(`🌐 Webhook Server đang chạy ở cổng ${WEBHOOK_PORT}`);
});

const attemptLogin = () => {
  const credentials = loadAppStateCredentials();
  if (!credentials) {
    scheduleLoginRetry("thiếu appstate.json", RETRY_BASE_DELAY_MS);
    return;
  }

  console.log("🔁 Đang thử đăng nhập lại từ appstate.json...");

  login(
    credentials,
    fcaOptions,
    async (err, api) => {
      if (err) {
        console.error("❌ LOGIN ERROR:", err);

        if (isUserIdRetrievalError(err)) {
          console.error(
            "ℹ️ Facebook đang chặn phiên đăng nhập này; hãy xác minh tài khoản trong browser rồi bot sẽ thử lại sau.",
          );
          scheduleLoginRetry("cần verify tài khoản Facebook", VERIFY_RETRY_DELAY_MS);
          return;
        }

        if (!shouldTryFbRefresh(err)) {
          console.error(
            "ℹ️ Lỗi này không giống appstate hết hạn, nên bot sẽ không tự refresh đăng nhập bằng email/password.",
          );
          scheduleLoginRetry("lỗi đăng nhập chưa xác định", RETRY_BASE_DELAY_MS);
          return;
        }

        const fbCredentials = getFbLoginCredentials();
        if (!fbCredentials) {
          console.error(
            "ℹ️ Để tự đăng nhập lại khi appstate hết hạn, hãy đặt FB_EMAIL và FB_PASSWORD trong .env.",
          );
          scheduleLoginRetry("thiếu FB_EMAIL/FB_PASSWORD", RETRY_BASE_DELAY_MS);
          return;
        }

        console.log("🔄 Appstate lỗi, đang thử làm mới bằng email/password...");
        const refreshResult = spawnSync(
          process.execPath,
          [path.join(__dirname, "refresh-appstate.js")],
          {
            stdio: "inherit",
            env: {
              ...process.env,
              FB_EMAIL: fbCredentials.email,
              FB_PASSWORD: fbCredentials.password,
            },
          },
        );

        if (refreshResult.status === 0) {
          console.log("✅ Đã làm mới appstate.json. Sẽ thử đăng nhập lại ngay.");
          scheduleLoginRetry("đã refresh appstate", 3000);
        } else {
          console.error("❌ Không thể làm mới appstate tự động.");
          scheduleLoginRetry("refresh appstate thất bại", RETRY_BASE_DELAY_MS);
        }

        return;
      }

      if (typeof api.setOptions === "function") {
        api.setOptions(fcaOptions);
      }

      const botID = api.getCurrentUserID();
      console.log(`✅ Đăng nhập thành công ID: ${botID}`);

      // Lưu api vào global để Webhook có thể dùng
      global.api_instance = api;

    // --- ADAPTER: đảm bảo `changeNickname` có sẵn trên `api` ---
    if (!api.changeNickname) {
      api.changeNickname = async (nickname, threadID, userID, callback) => {
        const tried = [];

        // Candidate known method names
        const candidates = [
          "setNickname",
          "setThreadNickname",
          "setUserNickname",
          "change_thread_nick",
        ];

        // Add any api method that mentions 'nick' or 'nickname'
        const dynamic = Object.keys(api || {}).filter(
          (k) => /nick/i.test(k) && typeof api[k] === "function",
        );

        const names = Array.from(new Set([...candidates, ...dynamic]));

        const tryCall = (fn) => {
          // Try several common argument orders
          const attempts = [
            () => fn(nickname, threadID, userID, callback),
            () => fn(threadID, userID, nickname, callback),
            () => fn(threadID, nickname, userID, callback),
            () => fn(userID, nickname, threadID, callback),
            () => fn(nickname, userID, threadID, callback),
          ];

          for (const attempt of attempts) {
            try {
              const res = attempt();
              return res;
            } catch (e) {
              tried.push(e.message || String(e));
            }
          }
          throw new Error("All call signatures failed for this candidate");
        };

        for (const name of names) {
          const f = api[name];
          if (typeof f !== "function") continue;
          try {
            const res = tryCall(f);
            // If function used callback style, assume success and return
            if (typeof callback === "function") return;
            return res;
          } catch (err) {
            // continue to next candidate
          }
        }

        const err = new Error(
          `changeNickname is not supported by this ws3-fca instance; tried: ${names.join(", ")}`,
        );
        if (typeof callback === "function") return callback(err);
        throw err;
      };
    }

    fs.writeFileSync(
      "appstate.json",
      JSON.stringify(api.getAppState(), null, 2),
    );

    // =================================================================
    // ĐOẠN MỚI: KIỂM TRA THÔNG BÁO RESET THÀNH CÔNG
    // =================================================================
    const resetPath = path.join(__dirname, "reset_data.json");
    if (fs.existsSync(resetPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(resetPath, "utf8"));
        const timeTaken = ((Date.now() - data.time) / 1000).toFixed(2);

        api.sendMessage(
          `✅ Bot đã khởi động lại thành công!\n` +
            `⏱ Thời gian reload: ${timeTaken} giây.\n` +
            `🚀 Các module lệnh đã được làm mới hoàn toàn.`,
          data.threadID,
        );

        // Xóa file tạm sau khi đã báo thành công
        fs.unlinkSync(resetPath);
      } catch (e) {
        console.error("❌ Lỗi xử lý file reset_data:", e);
      }
    }

    // --- NẠP COMMANDS VÀ EVENTS ---
    global.commands = new Map();
    const commandsDir = path.join(__dirname, "modules", "commands");
    if (!fs.existsSync(commandsDir))
      fs.mkdirSync(commandsDir, { recursive: true });

    getAllFiles(commandsDir).forEach((file) => {
      try {
        const cmd = require(file);
        // Backwards compatibility: some commands export `run` instead of `execute`.
        if (cmd && !cmd.execute && typeof cmd.run === 'function') {
          cmd.execute = cmd.run;
        }
        if (cmd && cmd.name) global.commands.set(cmd.name, cmd);
      } catch (e) {
        console.error(`❌ Lỗi nạp module ${path.basename(file)}: ${e.message}`);
      }
    });

    const events = new Map();
    const eventsDir = path.join(__dirname, "modules", "events");
    if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });
    getAllFiles(eventsDir).forEach((file) => {
      try {
        const ev = require(file);
        if (!ev.name) return;

        events.set(ev.name, ev);
      } catch {}
    });

    console.log(
      `📂 Đã nạp ${global.commands.size} lệnh và ${events.size} sự kiện.`,
    );

    // --- BẬT HẸN GIỜ TỰ ĐỘNG ĐỔI MODE ---
    startModeScheduler(api);

    // --- BẬT HẸN GIỜ GỬI TOP TƯƠNG TÁC ---
    let lastDailyCheckDate = null;
    let lastMonthlyCheckDate = null;

    // Hàm lấy giờ/phút theo Việt Nam (UTC+7) dưới dạng số
    const getVNTimeComponents = (date) => {
      const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
      return {
        hours: vnTime.getUTCHours(),
        minutes: vnTime.getUTCMinutes(),
      };
    };

    // Hàm lấy ngày theo Việt Nam (UTC+7)
    const getDateStamp = (date) => {
      const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
      const y = vnTime.getFullYear();
      const m = String(vnTime.getMonth() + 1).padStart(2, "0");
      const d = String(vnTime.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const checkAndSendTopStats = async () => {
      const now = new Date();
      const { hours, minutes } = getVNTimeComponents(now);
      const currentDate = getDateStamp(now);
      const currentDay = parseInt(currentDate.split("-")[2]);

      // Kiểm tra gửi top ngày vào 6:00-6:04 sáng (giờ Việt Nam)
      // Dùng khoảng thời gian rộng hơn để tránh bị miss khi setInterval lệch
      if (
        hours === 6 &&
        minutes >= 0 &&
        minutes <= 4 &&
        lastDailyCheckDate !== currentDate
      ) {
        console.log("🕗 Đang gửi TOP 10 tương tác ngày cho tất cả nhóm...");
        lastDailyCheckDate = currentDate; // Đánh dấu trước để tránh gọi lại nếu hàm chạy lâu
        await sendDailyTop10ToAllGroups(api);
      }

      // Kiểm tra gửi top tháng vào ngày 1 tháng lúc 6:00-6:04 sáng (giờ Việt Nam)
      if (
        currentDay === 1 &&
        hours === 6 &&
        minutes >= 0 &&
        minutes <= 4 &&
        lastMonthlyCheckDate !== currentDate
      ) {
        console.log("🕗 Đang gửi TOP 10 tương tác tháng cho tất cả nhóm...");
        lastMonthlyCheckDate = currentDate;
        await sendMonthlyTop10ToAllGroups(api);
      }
    };

    // Kiểm tra mỗi 30 giây để tránh miss thời điểm gửi
    setInterval(checkAndSendTopStats, 30000);
    console.log("✅ Đã bật hẹn giờ gửi TOP tương tác (6:00 sáng mỗi ngày)");

    // --- HÀM ĐẾM TIN NHẮN ---
    const statsPath = path.join(__dirname, "message_stats.json");
    let dailyTopStateCache = null;
    let monthlyTopStateCache = null;

    const readDailyTopState = () => {
      if (dailyTopStateCache) return dailyTopStateCache;

      try {
        if (fs.existsSync(DAILY_TOP_STATE_PATH)) {
          const parsed = JSON.parse(
            fs.readFileSync(DAILY_TOP_STATE_PATH, "utf8"),
          );
          dailyTopStateCache =
            parsed && typeof parsed === "object" ? parsed : {};
          return dailyTopStateCache;
        }
      } catch {}

      dailyTopStateCache = {};
      return dailyTopStateCache;
    };

    const writeDailyTopState = (state) => {
      dailyTopStateCache = state;
      const dir = path.dirname(DAILY_TOP_STATE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DAILY_TOP_STATE_PATH, JSON.stringify(state, null, 2));
    };

    const readMonthlyTopState = () => {
      if (monthlyTopStateCache) return monthlyTopStateCache;

      try {
        if (fs.existsSync(MONTHLY_TOP_STATE_PATH)) {
          const parsed = JSON.parse(
            fs.readFileSync(MONTHLY_TOP_STATE_PATH, "utf8"),
          );
          monthlyTopStateCache =
            parsed && typeof parsed === "object" ? parsed : {};
          return monthlyTopStateCache;
        }
      } catch {}

      monthlyTopStateCache = {};
      return monthlyTopStateCache;
    };

    const writeMonthlyTopState = (state) => {
      monthlyTopStateCache = state;
      const dir = path.dirname(MONTHLY_TOP_STATE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(MONTHLY_TOP_STATE_PATH, JSON.stringify(state, null, 2));
    };

    const getTimeKeys = (now = new Date()) => {
      // Chuyển sang giờ Việt Nam (UTC+7)
      const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      const year = vnTime.getFullYear();
      const month = String(vnTime.getMonth() + 1).padStart(2, "0");
      const day = String(vnTime.getDate()).padStart(2, "0");
      const dayKey = `${year}-${month}-${day}`;
      const monthKey = `${year}-${month}`;

      const weekDate = new Date(year, vnTime.getMonth(), day);
      const weekDay = (weekDate.getDay() + 6) % 7;
      weekDate.setDate(weekDate.getDate() - weekDay + 3);

      const firstThursday = new Date(weekDate.getFullYear(), 0, 4);
      const firstWeekDay = (firstThursday.getDay() + 6) % 7;
      firstThursday.setDate(firstThursday.getDate() - firstWeekDay + 3);

      const weekNumber =
        1 + Math.round((weekDate - firstThursday) / (7 * 24 * 60 * 60 * 1000));
      const weekKey = `${weekDate.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;

      return { dayKey, weekKey, monthKey };
    };

    const trimMapByNewestKeys = (mapObj, limit) => {
      const keys = Object.keys(mapObj || {}).sort();
      if (keys.length <= limit) return;
      const toDelete = keys.slice(0, keys.length - limit);
      toDelete.forEach((k) => {
        delete mapObj[k];
      });
    };

    const normalizeEntry = (raw) => {
      if (typeof raw === "number") {
        return {
          total: Number(raw) || 0,
          daily: {},
          weekly: {},
          monthly: {},
        };
      }

      if (!raw || typeof raw !== "object") {
        return {
          total: 0,
          daily: {},
          weekly: {},
          monthly: {},
        };
      }

      return {
        total: Number(raw.total) || 0,
        daily: raw.daily && typeof raw.daily === "object" ? raw.daily : {},
        weekly: raw.weekly && typeof raw.weekly === "object" ? raw.weekly : {},
        monthly:
          raw.monthly && typeof raw.monthly === "object" ? raw.monthly : {},
      };
    };

    const formatDayLabel = (dayKey) => {
      const [year, month, day] = String(dayKey || "").split("-");
      if (!year || !month || !day) return String(dayKey || "");
      return `${day}/${month}/${year}`;
    };

    const formatMonthLabel = (monthKey) => {
      const [year, month] = String(monthKey || "").split("-");
      if (!year || !month) return String(monthKey || "");
      return `${month}/${year}`;
    };

    const getPreviousDayKey = (now = new Date()) => {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return getTimeKeys(d).dayKey;
    };

    const getPreviousMonthKey = (now = new Date()) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return getTimeKeys(d).monthKey;
    };

    // maybeSendDailyTop10 đã bị xóa — top 10 chỉ gửi theo lịch 6:00 sáng qua sendDailyTop10ToAllGroups

    const sendDailyTop10ToAllGroups = async (api) => {
      try {
        const stats = {};
        if (fs.existsSync(statsPath)) {
          const data = JSON.parse(fs.readFileSync(statsPath, "utf8"));
          Object.assign(stats, data);
        }

        const yesterdayKey = getPreviousDayKey();
        const state = readDailyTopState();

        for (const threadID of Object.keys(stats)) {
          if (state[threadID] === yesterdayKey) continue;

          const threadStats = stats[threadID];
          const ranked = Object.entries(threadStats)
            .filter(([uid]) => /^\d+$/.test(String(uid)))
            .map(([uid, raw]) => {
              const entry = normalizeEntry(raw);
              return {
                uid: String(uid),
                count: Number(entry.daily?.[yesterdayKey] || 0),
                total: Number(entry.total || 0),
              };
            })
            .filter((item) => item.count > 0)
            .sort((a, b) => {
              const dayDiff = b.count - a.count;
              if (dayDiff !== 0) return dayDiff;
              return b.total - a.total;
            });

          if (ranked.length === 0) continue;

          try {
            const threadInfo = await getThreadInfoCached(api, threadID);
            if (!threadInfo?.isGroup) continue;

            const userMap = new Map(
              (threadInfo.userInfo || []).map((u) => [String(u.id), u.name]),
            );

            const lines = [
              `📊 TOP 10 TƯƠNG TÁC NGÀY ${formatDayLabel(yesterdayKey)}`,
              "━━━━━━━━━━━━━━━━━━",
              ...ranked.slice(0, 10).map((item, idx) => {
                const name =
                  userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
                return `${idx + 1}. ${name} — ${item.count}`;
              }),
            ];

            await api.sendMessage(lines.join("\n"), threadID);
            state[threadID] = yesterdayKey;
            console.log(`✅ Đã gửi TOP 10 tương tác ngày cho nhóm ${threadID}`);

            // Delay 2 giây giữa các nhóm để tránh bị Facebook throttle
            await new Promise((r) => setTimeout(r, 2000));
          } catch (e) {
            console.error(`❌ Lỗi gửi TOP 10 cho nhóm ${threadID}:`, e.message);
          }
        }

        writeDailyTopState(state);
      } catch (e) {
        console.error("❌ Lỗi gửi TOP 10 tương tác ngày cho tất cả nhóm:", e);
      }
    };

    const sendMonthlyTop10ToAllGroups = async (api) => {
      try {
        const stats = {};
        if (fs.existsSync(statsPath)) {
          const data = JSON.parse(fs.readFileSync(statsPath, "utf8"));
          Object.assign(stats, data);
        }

        const previousMonthKey = getPreviousMonthKey();
        const state = readMonthlyTopState();

        for (const threadID of Object.keys(stats)) {
          if (state[threadID] === previousMonthKey) continue;

          const threadStats = stats[threadID];
          const ranked = Object.entries(threadStats)
            .filter(([uid]) => /^\d+$/.test(String(uid)))
            .map(([uid, raw]) => {
              const entry = normalizeEntry(raw);
              return {
                uid: String(uid),
                count: Number(entry.monthly?.[previousMonthKey] || 0),
                total: Number(entry.total || 0),
              };
            })
            .filter((item) => item.count > 0)
            .sort((a, b) => {
              const monthDiff = b.count - a.count;
              if (monthDiff !== 0) return monthDiff;
              return b.total - a.total;
            });

          if (ranked.length === 0) continue;

          try {
            const threadInfo = await getThreadInfoCached(api, threadID);
            if (!threadInfo?.isGroup) continue;

            const userMap = new Map(
              (threadInfo.userInfo || []).map((u) => [String(u.id), u.name]),
            );

            const lines = [
              `📊 TOP 10 TƯƠNG TÁC THÁNG ${formatMonthLabel(previousMonthKey)}`,
              "━━━━━━━━━━━━━━━━━━",
              ...ranked.slice(0, 10).map((item, idx) => {
                const name =
                  userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
                return `${idx + 1}. ${name} — ${item.count}`;
              }),
            ];

            await api.sendMessage(lines.join("\n"), threadID);
            state[threadID] = previousMonthKey;
            console.log(
              `✅ Đã gửi TOP 10 tương tác tháng cho nhóm ${threadID}`,
            );

            // Delay 2 giây giữa các nhóm để tránh bị Facebook throttle
            await new Promise((r) => setTimeout(r, 2000));
          } catch (e) {
            console.error(
              `❌ Lỗi gửi TOP 10 tháng cho nhóm ${threadID}:`,
              e.message,
            );
          }
        }

        writeMonthlyTopState(state);
      } catch (e) {
        console.error("❌ Lỗi gửi TOP 10 tương tác tháng cho tất cả nhóm:", e);
      }
    };

    // maybeSendMonthlyTop10 đã bị xóa — top tháng chỉ gửi theo lịch ngày 1 lúc 6:00 sáng qua sendMonthlyTop10ToAllGroups

    // --- HÀM XÁC ĐỊNH LOẠI TIN NHẮN ---
    const getMessageType = (event) => {
      if (!event.attachments || event.attachments.length === 0) {
        return "text";
      }

      const attachment = event.attachments[0];
      const type = attachment.type || "";

      switch (type) {
        case "sticker":
          return "sticker";
        case "animated_image":
          return "gif";
        case "video":
          return "video";
        case "image":
          return "image";
        case "audio":
          return "audio";
        case "file":
          return "file";
        default:
          return "attachment";
      }
    };

    const updateMessageStats = (senderID, threadID, event = null) => {
      try {
        let stats = {};
        if (fs.existsSync(statsPath)) {
          stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
        }

        if (!stats[threadID]) {
          stats[threadID] = {};
        }

        const uid = String(senderID);
        const entry = normalizeEntry(stats[threadID][uid]);
        const { dayKey, weekKey, monthKey } = getTimeKeys();

        // Cập nhật tổng số tin nhắn
        entry.total = Number(entry.total || 0) + 1;
        entry.daily[dayKey] = Number(entry.daily[dayKey] || 0) + 1;
        entry.weekly[weekKey] = Number(entry.weekly[weekKey] || 0) + 1;
        entry.monthly[monthKey] = Number(entry.monthly[monthKey] || 0) + 1;

        // Giữ file stats gọn để tránh phình theo thời gian.
        trimMapByNewestKeys(entry.daily, 45);
        trimMapByNewestKeys(entry.weekly, 26);
        trimMapByNewestKeys(entry.monthly, 18);

        stats[threadID][uid] = entry;

        fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));

        return stats[threadID];
      } catch (e) {
        console.error("❌ Lỗi cập nhật thống kê tin nhắn:", e);
        return null;
      }
    };

    // --- LISTENER CHÍNH ---
      api.listenMqtt(async (err, event) => {
      if (err) {
        console.error("Listen Error:", err);
        if (err.type === "stop_listen" || err.error === "Connection refused") {
          console.error(
            "⚠️ MQTT bị từ chối. Kiểm tra lại appstate.json còn hợp lệ, hoặc tạo appstate mới bằng refresh-appstate.js.",
          );
        }
        return;
      }

      // 1. Xử lý Event hệ thống (Log message)
      if (event.logMessageType) {
        events.forEach(async (ev) => {
          if (ev.eventType && ev.eventType.includes(event.logMessageType)) {
            try {
              await ev.execute({ api, event, config });
            } catch (e) {}
          }
        });
      }

      // 1b. Xử lý Event theo event.type
      if (event.type) {
        events.forEach(async (ev) => {
          if (ev.eventType && ev.eventType.includes(event.type)) {
            try {
              await ev.execute({ api, event, config });
            } catch (e) {}
          }
        });
      }

      // 2. Đếm tin nhắn (bao gồm cả tin nhắn có attachments)
      if (
        (event.body || event.attachments) &&
        event.senderID &&
        event.senderID != botID &&
        event.threadID
      ) {
        updateMessageStats(event.senderID, event.threadID, event);
        // Top 10 chỉ gửi theo lịch 6:00 sáng — không trigger khi có tin nhắn nữa

        // 2b. Cập nhật ANTITHUHOI tức thời (nếu được bật)
        try {
          const antithuhoiPath = path.join(
            __dirname,
            "cache/antithuhoi/settings.json",
          );
          if (fs.existsSync(antithuhoiPath)) {
            const antithuhoiSettings = JSON.parse(
              fs.readFileSync(antithuhoiPath, "utf8"),
            );
            if (antithuhoiSettings[event.threadID]) {
              const messagesPath = path.join(
                __dirname,
                `cache/antithuhoi/messages_${event.threadID}.json`,
              );
              const threadInfo = await getThreadInfoCached(api, event.threadID);

              if (threadInfo) {
                const memberInfo = Array.isArray(threadInfo?.userInfo)
                  ? threadInfo.userInfo
                  : [];
                const nameById = new Map(
                  memberInfo.map((u) => [String(u.id), u.name || ""]),
                );
                const history = await api.getThreadHistory(event.threadID, 15);
                const messages = history
                  .filter(
                    (msg) => msg.body && String(msg.senderID) !== String(botID),
                  )
                  .map((msg) => ({
                    messageID: msg.messageID,
                    senderID: msg.senderID,
                    senderName:
                      nameById.get(String(msg.senderID)) ||
                      msg.senderName ||
                      "Unknown",
                    body: msg.body,
                    timestamp: msg.timestamp,
                    attachments: msg.attachments ? msg.attachments.length : 0,
                  }))
                  .reverse();
                const dir = path.dirname(messagesPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(
                  messagesPath,
                  JSON.stringify(messages, null, 2),
                );
              }
            }
          }
        } catch (err) {
          // Im lặng - không print error để không spam log
        }
      }

      if (!event.body) return;

      const body = String(event.body || "").trim();
      const senderID = String(event.senderID || "");
      const threadID = String(event.threadID || "");
      const prefix = config.prefix || "!";

      if (body) {
        console.log(
          `📩 [MSG] type=${event.type || "unknown"} tid=${threadID} sid=${senderID} body=${body.slice(0, 120)}`,
        );
      }

      const isBotSender = senderID === String(botID);
      const isInbox = threadID && senderID && threadID === senderID;
      const normalizedBody = normalizeText(body);

      // Lệnh không cần check quyền (tự trong lệnh xử lý)
      const FREE_COMMANDS = ["mode"];

      // =================================================================
      // XỬ LÝ LỆNH CÓ PREFIX (VD: !ve, !taixiu, !reset)
      // =================================================================
      if (event.body.startsWith(prefix)) {
        event = await ensureMentions(api, event);

        const args = event.body.slice(prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = global.commands.get(commandName);

        if (command) {
          try {
            // =================================================================
            // 🛡️ KIỂM TRA HẠN THUÊ BOT (RENTAL CHECK)
            // =================================================================
            const { execute } = require("./modules/utils/database");
            const isAdmin = config.adminIDs.includes(event.senderID) || String(event.senderID) === String(botID);
            const isFreeCommand = ["thuebot", "adminbot"].includes(commandName);

            if (!isAdmin && !isFreeCommand) {
              const rentedGroup = await execute(
                "SELECT * FROM rented_groups WHERE thread_id = ? AND expire_date > CURRENT_TIMESTAMP",
                [event.threadID],
              );

              if (!rentedGroup || rentedGroup.length === 0) {
                return api.sendMessage(
                  "⚠️ Nhóm này chưa thuê bot hoặc đã hết hạn thuê.\n" +
                    "Vui lòng dùng !adminbot để liên hệ admin hoặc dùng lệnh !thuebot để tự động gia hạn!",
                  event.threadID,
                  event.messageID,
                );
              }
            }

            console.log(`🚀 [CMD] ${commandName} | UID: ${event.senderID}`);

            const permCheck = await checkPermission(
              event.threadID,
              event.senderID,
              api,
            );
            if (!permCheck.allowed && !isFreeCommand) {
              // Fetch threadInfo for debugging (do not expose to chat, only server log)
              let threadInfoDebug = null;
              try {
                threadInfoDebug = await getThreadInfoCached(api, event.threadID);
              } catch (tiErr) {
                threadInfoDebug = { error: String(tiErr && tiErr.message ? tiErr.message : tiErr) };
              }
              console.error(`Permission denied for command ${commandName} | thread=${event.threadID} | sender=${event.senderID}`, { permCheck, threadInfo: threadInfoDebug });

              // Provide the reason from permission check to help debugging in chat
              const reasonText = permCheck.reason ? `\n🔍 Lý do: ${permCheck.reason}` : "";
              return api.sendMessage(
                `❌ Bạn không được dùng lệnh này trong mode hiện tại.${reasonText}`,
                event.threadID,
              );
            }

            // Pre-fetch threadInfo to debug cases where commands see non-group
            let preThreadInfo = null;
            try {
              preThreadInfo = await getThreadInfoCached(api, event.threadID);
            } catch (preErr) {
              preThreadInfo = { error: String(preErr && preErr.message ? preErr.message : preErr) };
            }

            if (!preThreadInfo || !preThreadInfo.isGroup) {
              console.error(`Command ${commandName} running but thread not a group according to getThreadInfo`, { threadID: event.threadID, sender: event.senderID, preThreadInfo });
            }

            try {
              await command.execute({ api, event, args, config });
            } catch (cmdErr) {
              // Log full stack for debugging and send a short message to chat
              console.error(`Error executing command ${commandName}:`, cmdErr);
              try {
                api.sendMessage(
                  `❌ Lỗi thực thi lệnh: ${commandName}\n⚠️ ${cmdErr.message || 'Xem logs server để biết chi tiết'}`,
                  event.threadID,
                );
              } catch (sendErr) {
                console.error('Failed to send error message to thread:', sendErr);
              }
            }
          } catch (error) {
            console.error(`Unexpected error handling command ${commandName}:`, error);
            try {
              api.sendMessage(
                `❌ Lỗi thực thi lệnh: ${commandName}\n⚠️ ${error.message || 'Xem logs server để biết chi tiết'}`,
                event.threadID,
              );
            } catch (sendErr) {
              console.error('Failed to send fallback error message:', sendErr);
            }
          }
        }
      }

      // =================================================================
      // XỬ LÝ REPLY (Tài Xỉu, Bầu Cua...)
      // =================================================================
      if (event.type === "message_reply") {
        const permCheck = await checkPermission(
          event.threadID,
          event.senderID,
          api,
        );
        if (!permCheck.allowed) return;

        global.commands.forEach(async (cmd) => {
          if (cmd.handleReply) {
            try {
              await cmd.handleReply({ api, event, config });
            } catch (e) {
              console.error(`❌ Lỗi handleReply [${cmd.name}]:`, e);
            }
          }
        });
      }
      });
    },
  );
};

attemptLogin();
