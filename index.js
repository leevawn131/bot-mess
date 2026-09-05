const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
if (isMainThread && typeof process.chdir === 'function') {
  try {
    process.chdir(__dirname);
  } catch (_) {}
}
process.env.TZ = "Asia/Ho_Chi_Minh";
process.on('unhandledRejection', (reason, promise) => {
  console.error('[⚠️] Unhandled Promise Rejection caught:', reason?.message || reason);
});
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const login = require("./includes/f");

// Helper yêu cầu Master khởi động lại RIÊNG luồng con của Cụm này (không ảnh hưởng các Cụm khác)
const requestWorkerRestart = (reason) => {
  if (!isMainThread && parentPort) {
    const cId = workerData?.clusterId || 1;
    const pName = workerData?.profileName || 'Default';
    console.warn(`[WORKER CỤM ${cId}] 🔄 Yêu cầu Master khởi động lại RIÊNG luồng Cụm ${cId} (${reason})...`);
    parentPort.postMessage({
      type: "restart_worker",
      clusterId: cId,
      profileName: pName
    });
  } else {
    scheduleLoginRetry(reason, 5000);
  }
};

// Hook bắt lỗi Appstate / Cookie / Blocked từ FCA Logger để tự động cào lại cookie khi cookie die
if (global.Fca && global.Fca.Require && global.Fca.Require.logger) {
  const origLoggerError = global.Fca.Require.logger.Error;
  const origLoggerWarning = global.Fca.Require.logger.Warning;

  const handleFcaFailure = (msg) => {
    const isFatal = msg.includes('Appstate') || 
                    msg.includes('Cookie Của Bạn Đã Bị Lỗi') || 
                    msg.includes('ErrAppState');

    if (isFatal) {
      const activeProf = global.current_logging_profile || (!isMainThread && workerData && workerData.profileName ? workerData.profileName : 'Default');
      console.warn(`[🚨 CẢNH BÁO FCA] Cookie của Profile "${activeProf}" bị lỗi / checkpoint / block! Tự động xóa appstate và khởi chạy Trình duyệt lấy lại cookie mới...`);
      
      const brokenAppstatePath = path.join(__dirname, 'runtime', 'appstates', `appstate_${activeProf}.json`);
      try {
        if (fs.existsSync(brokenAppstatePath)) fs.unlinkSync(brokenAppstatePath);
        if (fs.existsSync(APPSTATE_PATH)) fs.unlinkSync(APPSTATE_PATH);
        if (fs.existsSync(LEGACY_APPSTATE_PATH)) fs.unlinkSync(LEGACY_APPSTATE_PATH);
      } catch (e) {}

      runAutoExtractor(activeProf);
      requestWorkerRestart(`tự động lấy lại cookie sau lỗi FCA cho ${activeProf}`);
    }
  };

  global.Fca.Require.logger.Error = function(...args) {
    const msg = args.map(a => String(a || '')).join(' ');
    handleFcaFailure(msg);
    return origLoggerError.apply(this, args);
  };

  global.Fca.Require.logger.Warning = function(...args) {
    const msg = args.map(a => String(a || '')).join(' ');
    handleFcaFailure(msg);
    return origLoggerWarning.apply(this, args);
  };
}
const {
  checkPermission,
  getGroupMode,
} = require("./modules/utils/checkPermission");
const { startModeScheduler } = require("./modules/utils/modeScheduler");
const {
  runAiConversation,
  normalizeText,
} = require("./modules/utils/aiAssistant");
const {
  ensureMentionsFromHistory: ensureMentionsResolved,
} = require("./modules/utils/mentionResolver");
const {
  getThreadInfoCached,
  clearThreadInfoCache,
  syncThreadAdminRealtime,
  syncThreadNameRealtime,
  syncThreadNicknameRealtime,
  syncThreadParticipantRealtime,
  syncThreadImageRealtime,
  syncThreadThemeRealtime,
} = require("./modules/utils/threadInfo");
const accountProfilesManager = require("./src/managers/accountProfilesManager");
const clusterGroupTracker = require("./src/managers/clusterGroupTracker");
const { execute } = require("./modules/utils/database");
// Tạm tắt console.error khi gọi getThreadHistory để ws3-fca không spam log
async function _quietGetThreadHistory(api, threadID, limit) {
  const _origErr = console.error;
  console.error = () => { };
  try {
    return await api.getThreadHistory(threadID, limit);
  } finally {
    console.error = _origErr;
  }
}

global._quietGetThreadHistory = _quietGetThreadHistory;

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

// Set global config
global.config = config;

// Global client & data initialization for compatibility
if (!global.client) global.client = {};
if (!global.client.handleReply) global.client.handleReply = [];
if (!global.client.handleReaction) global.client.handleReaction = [];
if (!global.data) global.data = { threadData: new Map(), threadInfo: new Map(), allThreadID: [], allUserID: [], userBanned: new Map(), threadBanned: new Map(), commandBanned: new Map() };
if (!global.data.threadData) global.data.threadData = new Map();

// 🧹 TTL Eviction Cleaner: Quét và dọn dẹp context reply/reaction quá hạn (TTL = 10 phút) định kỳ mỗi 5 phút để chống rò rỉ RAM
const HANDLE_CONTEXT_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  if (Array.isArray(global.client.handleReply)) {
    global.client.handleReply = global.client.handleReply.filter((item) => {
      const createdAt = item.createdAt || item.timestamp || (item.time ? new Date(item.time).getTime() : 0);
      return !createdAt || (now - createdAt < HANDLE_CONTEXT_TTL_MS);
    });
  }
  if (Array.isArray(global.client.handleReaction)) {
    global.client.handleReaction = global.client.handleReaction.filter((item) => {
      const createdAt = item.createdAt || item.timestamp || 0;
      return !createdAt || (now - createdAt < HANDLE_CONTEXT_TTL_MS);
    });
  }
}, 5 * 60 * 1000);

// 2. LOAD APPSTATE
const APPSTATE_PATH = path.join(__dirname, "runtime", "appstate.json");
const LEGACY_APPSTATE_PATH = path.join(__dirname, "appstate.json");

const runAutoExtractor = (profileName = "") => {
  const lockDir = path.join(__dirname, "runtime", "extractor.lock");
  
  let locked = false;
  let lockWaitCount = 0;
  while (!locked) {
    try {
      fs.mkdirSync(lockDir);
      locked = true;
    } catch (e) {
      if (e.code === 'EEXIST') {
        lockWaitCount++;
        if (lockWaitCount > 40) { // Timeout sau 120s (40 * 3s)
            console.log(`[!] Khóa extractor.lock đã tồn tại quá lâu, tự động xóa khóa rác...`);
            try { fs.rmdirSync(lockDir); } catch(ex){}
            continue; // Thử lấy lại khóa
        }
        console.log(`[⏳] Đang chờ tiến trình lấy cookie khác hoàn tất (đợi tới lượt Profile: ${profileName})...`);
        try { require("child_process").execSync("sleep 3"); } catch(ex){}
      } else {
        locked = true; // Fallback if some other error occurs
      }
    }
  }

  try {
    console.log(`🔄 Tự động lấy appstate mới bằng Google Chrome cho Profile: ${profileName || "Tất cả"}...`);
    const args = [path.join(__dirname, "export-appstate.js")];
    if (profileName) args.push(profileName);
    args.push("--no-restart");

    spawnSync("node", args, { stdio: "inherit" });

    let checkPath = null;
    if (profileName) {
      checkPath = path.join(__dirname, "runtime", "appstates", `appstate_${profileName}.json`);
    } else {
      checkPath = fs.existsSync(APPSTATE_PATH) ? APPSTATE_PATH : LEGACY_APPSTATE_PATH;
    }
    if (fs.existsSync(checkPath)) {
      const content = fs.readFileSync(checkPath, "utf8").trim();
      if (content && content !== "[]" && content !== "{}") {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const lastCheckPath = path.join(__dirname, "cache", "top_reports_last_check.json");
            if (fs.existsSync(lastCheckPath)) fs.unlinkSync(lastCheckPath);
            return true;
          }
        } catch (ex) {}
      }
    }
  } catch (e) {
    console.error("❌ Lỗi khi chạy script lấy cookie Chrome:", e.message);
  } finally {
    try { fs.rmdirSync(lockDir); } catch(e) {}
  }
  return false;
};

const loadAppStateCredentials = () => {
  let appStatePath = fs.existsSync(APPSTATE_PATH)
    ? APPSTATE_PATH
    : LEGACY_APPSTATE_PATH;

  let hasAppState = false;
  if (fs.existsSync(appStatePath)) {
    try {
      const content = fs.readFileSync(appStatePath, "utf8").trim();
      if (content && content !== "[]" && content !== "{}") {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          // Định dạng chưa mã hóa (có key c_user / i_user)
          const hasRawCookies = parsed.some(c => typeof c === 'object' && c !== null && (c.key === 'c_user' || c.key === 'i_user'));
          // Định dạng đã bị FCA mã hóa (mảng các chuỗi hex dài)
          const isEncrypted = parsed.length > 0 && typeof parsed[0] === 'string' && parsed[0].length > 50;

          if (hasRawCookies || isEncrypted) {
            hasAppState = true;
          }
        }
      }
    } catch (e) {
      // Invalid JSON
    }
  }

  if (!hasAppState) {
    console.log("⚠️  Không tìm thấy appstate.json hợp lệ. Sẽ dựa vào cơ chế multi-profile để tự động lấy từng Profile...");
    if (fs.existsSync(APPSTATE_PATH)) {
      appStatePath = APPSTATE_PATH;
    } else if (fs.existsSync(LEGACY_APPSTATE_PATH)) {
      appStatePath = LEGACY_APPSTATE_PATH;
    }
  }

  try {
    const rawContent = fs.readFileSync(appStatePath, "utf8");
    const parsed = JSON.parse(rawContent);
    const hasRawCookies = Array.isArray(parsed) && parsed.some(c => typeof c === 'object' && c !== null && (c.key === 'c_user' || c.key === 'i_user'));
    const isEncrypted = Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string' && parsed[0].length > 50;

    if (!hasRawCookies && !isEncrypted) {
      console.error("❌ File appstate.json không chứa cookie đăng nhập c_user hoặc i_user hợp lệ.");
      return null;
    }
    return {
      appState: parsed,
    };
  } catch (err) {
    console.error("❌ Thiếu hoặc lỗi định dạng file appstate.json");
    return null;
  }
};

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

const RETRY_BASE_DELAY_MS = 5 * 20 * 1000;
const VERIFY_RETRY_DELAY_MS = 60 * 1000;
let loginRetryTimer = null;

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
  return ensureMentionsResolved(api, event);
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
  autoReconnect: config.fca?.autoReconnect ?? true, // Cho phép FCA tự kết nối lại MQTT khi mạng lắc nhẹ
  updatePresence: config.fca?.updatePresence ?? false,
  autoMarkDelivery: config.fca?.autoMarkDelivery ?? false,
  autoMarkRead: config.fca?.autoMarkRead ?? true,
  forceLogin: config.fca?.forceLogin ?? false,
  emitReady: config.fca?.emitReady ?? false,
  listenTyping: config.fca?.listenTyping ?? false,
  userAgent:
    config.fca?.userAgent ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
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
// 🚀 QUẢN LÝ TIẾN TRÌNH MASTER & WORKER THREADS
// =================================================================
const activeWorkers = {};
const activeClusterUids = new Map(); // clusterId -> { uid, profileName }

if (isMainThread) {
  console.log("👑 [MASTER] Đang khởi động luồng Tổng Quản...");

  // 🚀 SERVER WEBHOOK SEPAY (CHỈ CHẠY TRÊN THREAD MASTER)
  const express = require("express");
  const cors = require("cors");
  const app = express();
  app.use(express.json());
  app.use(cors());

  app.post("/webhook/sepay", async (req, res) => {
    console.log("💳 Nhận Webhook từ SePay:", req.body);
    const { transferAmount, content } = req.body;
    if (!content) return res.status(200).send({ success: false, message: "No content" });

    try {
      const { execute } = require("./modules/utils/database");
      const { ensureRentedGroupsSchema } = require("./modules/utils/rentalSchema");
      await ensureRentedGroupsSchema();

      const pendingTx = await execute(
        "SELECT * FROM transactions WHERE status = 'pending' AND ? LIKE ('%' || transaction_code || '%') LIMIT 1",
        [content],
      );

      if (pendingTx && pendingTx.length > 0) {
        const tx = pendingTx[0];
        if (transferAmount >= tx.amount) {
          await execute("UPDATE transactions SET status = 'success', updated_at = datetime('now') WHERE id = ?", [tx.id]);

          let months = Number(tx.months || 0);
          const isAdminPlan = tx.transaction_code.startsWith("ADM");

          if (!months || months <= 0) {
            if (isAdminPlan) {
              if (tx.amount >= 550000) months = 12;
              else if (tx.amount >= 280000) months = 6;
              else if (tx.amount >= 140000) months = 3;
              else months = 1;
            } else {
              if (tx.amount >= 275000) months = 12;
              else if (tx.amount >= 140000) months = 6;
              else if (tx.amount >= 70000) months = 3;
              else months = 1;
            }
          }

          const daysToAdd = months * 30;
          const existingGroup = await execute(
            "SELECT is_stopped, paused_remaining_ms FROM rented_groups WHERE thread_id = ?",
            [tx.thread_id]
          );

          if (existingGroup && existingGroup.length > 0 && existingGroup[0].is_stopped) {
            const addMs = daysToAdd * 24 * 60 * 60 * 1000;
            const newPausedMs = Number(existingGroup[0].paused_remaining_ms || 0) + addMs;
            await execute(
              "UPDATE rented_groups SET paused_remaining_ms = ?, renter_id = ?, rented_at = datetime('now'), is_admin_rental = ? WHERE thread_id = ?",
              [newPausedMs, tx.user_id, isAdminPlan ? 1 : 0, tx.thread_id]
            );
          } else {
            await execute(
              `INSERT INTO rented_groups (thread_id, expire_date, renter_id, rented_at, is_admin_rental, is_stopped, paused_remaining_ms)
              VALUES (?, datetime('now', '+' || ? || ' day'), ?, datetime('now'), ?, 0, 0)
              ON CONFLICT(thread_id) DO UPDATE SET
                expire_date = datetime(max(coalesce(expire_date, datetime('now')), datetime('now')), '+' || ? || ' day'),
                renter_id = ?, rented_at = datetime('now'), is_admin_rental = ?`,
              [tx.thread_id, daysToAdd, tx.user_id, isAdminPlan ? 1 : 0, daysToAdd, tx.user_id, isAdminPlan ? 1 : 0],
            );
          }

          console.log(`✅ Đã cộng ${daysToAdd} ngày cho nhóm ${tx.thread_id}`);
          try {
            const { clearRentalCache } = require("./modules/utils/rental");
            clearRentalCache(tx.thread_id);
          } catch (rentalCacheErr) { }

          // Tìm Cụm đang quản lý nhóm này để gửi tin nhắn thông báo thông qua Worker
          const binding = await execute("SELECT cluster_id FROM group_profile_bindings WHERE thread_id = ?", [tx.thread_id]);
          let clusterId = 1;
          if (binding && binding.length > 0) clusterId = binding[0].cluster_id;

          const adminGrantedMsg = isAdminPlan ? "\n👑 Quyền đổi mode đã được mở khóa cho tất cả QTV nhóm!" : "";
          const planName = isAdminPlan ? "ADMIN-BOT" : "THƯỜNG";
          const messageBody = `🎉 [ THANH TOÁN THÀNH CÔNG ] 🎉\n\nHệ thống đã nhận được ${transferAmount.toLocaleString("vi-VN")} VNĐ.\nNhóm của bạn đã được gia hạn thêm ${months} tháng sử dụng gói ${planName}!${adminGrantedMsg}\nCảm ơn bạn đã ủng hộ!`;

          if (activeWorkers[clusterId]) {
            activeWorkers[clusterId].postMessage({
              type: "send_message",
              threadID: tx.thread_id,
              body: messageBody
            });
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

  // 🎮 KHỞI ĐỘNG WEB GAME HUB & API BACKEND (CHỈ CHẠY TRÊN MASTER THREAD)
  try {
    const webApp = require(path.resolve(__dirname, "web/backend/app"));
    const webDb = require(path.resolve(__dirname, "web/backend/config/db"));
    const WEB_PORT = process.env.WEB_PORT || 3001;
    const WEB_HOST = process.env.WEB_HOST || "0.0.0.0";

    webDb.getDatabase();
    const webServer = webApp.listen(WEB_PORT, WEB_HOST, () => {
      console.log(`🎮 [Web Game Hub] Đang chạy tại: http://${WEB_HOST === "0.0.0.0" ? "localhost" : WEB_HOST}:${WEB_PORT}`);
    });

    webServer.on("error", (err) => {
      console.error("❌ [Web Game Hub] Lỗi khởi động Web Server:", err.message);
    });
  } catch (webErr) {
    console.error("❌ [Web Game Hub] Không thể nạp module Web Backend:", webErr.message);
  }

  // 🚀 KHỞI ĐỘNG CÁC WORKER (CÁC CỤM) CÓ GIÃN CÁCH (STAGGERED SPAWN)
  const TARGET_ALERT_THREAD = '1523319575522034';
  const PENDING_ALERTS_PATH = path.join(__dirname, 'runtime', 'pending_alerts.json');

  function savePendingAlert(body, threadID = TARGET_ALERT_THREAD) {
    try {
      let alerts = [];
      if (fs.existsSync(PENDING_ALERTS_PATH)) {
        alerts = JSON.parse(fs.readFileSync(PENDING_ALERTS_PATH, 'utf8') || '[]');
      }
      alerts.push({ body, threadID, createdAt: Date.now() });
      const dir = path.dirname(PENDING_ALERTS_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PENDING_ALERTS_PATH, JSON.stringify(alerts, null, 2), 'utf8');
    } catch (e) {}
  }

  function flushPendingAlerts(worker) {
    if (!fs.existsSync(PENDING_ALERTS_PATH)) return;
    try {
      const raw = fs.readFileSync(PENDING_ALERTS_PATH, 'utf8');
      const alerts = JSON.parse(raw || '[]');
      if (Array.isArray(alerts) && alerts.length > 0) {
        alerts.forEach(item => {
          worker.postMessage({
            type: "send_message",
            threadID: item.threadID || TARGET_ALERT_THREAD,
            body: item.body
          });
        });
        fs.unlinkSync(PENDING_ALERTS_PATH);
        console.log(`[MASTER 🚀] Đã gửi vét ${alerts.length} cảnh báo tồn đọng qua luồng vừa online!`);
      }
    } catch (e) {}
  }

  function dispatchAlertMessage(alertBody, threadID = TARGET_ALERT_THREAD, failedClusterId = null) {
    let sent = false;
    for (const [cId, worker] of Object.entries(activeWorkers)) {
      if (worker && String(cId) !== String(failedClusterId)) {
        worker.postMessage({ type: "send_message", threadID, body: alertBody });
        console.log(`[MASTER 📢] Đã gửi thông báo Checkpoint qua Cụm ${cId} tới nhóm ${threadID}`);
        sent = true;
        break;
      }
    }
    if (!sent) {
      for (const [cId, worker] of Object.entries(activeWorkers)) {
        if (worker) {
          worker.postMessage({ type: "send_message", threadID, body: alertBody });
          console.log(`[MASTER 📢] Đã gửi thông báo Checkpoint qua Cụm ${cId} tới nhóm ${threadID}`);
          sent = true;
          break;
        }
      }
    }
    if (!sent) {
      savePendingAlert(alertBody, threadID);
      console.log(`[MASTER ⏳] Đã lưu cảnh báo Checkpoint vào hàng đợi chờ Cụm online để gửi tới nhóm ${threadID}.`);
    }
  }

  const clusterRestartAttempts = new Map();
  const activeProfiles = accountProfilesManager.getActiveProfilesToRun();
  accountProfilesManager.loadConfig();
  const clusters = accountProfilesManager.config.clusters || [];

  function spawnWorkerForCluster(clusterId, profileName) {
    if (activeWorkers[clusterId]) {
      console.warn(`[MASTER] ⚠️ Cụm ${clusterId} đã có luồng con đang chạy, không khởi tạo thêm luồng trùng lặp.`);
      return;
    }
    console.log(`[MASTER] Đang khởi tạo luồng con cho Cụm ${clusterId} (Profile: ${profileName})...`);
    const worker = new Worker(__filename, { workerData: { clusterId, profileName } });

    activeWorkers[clusterId] = worker;

    worker.on('message', async (msg) => {
      if (msg.type === "log") console.log(`[WORKER CỤM ${clusterId}] ${msg.text}`);
      if (msg.type === "checkpoint_alert") {
        dispatchAlertMessage(msg.alertBody, msg.threadID || TARGET_ALERT_THREAD, msg.clusterId);
      }
      if (msg.type === "restart_worker") {
        console.log(`[MASTER] 🔄 Nhận yêu cầu khởi động lại RIÊNG cho Cụm ${clusterId} (Profile: ${msg.profileName || profileName})...`);
        if (activeWorkers[clusterId]) {
          activeWorkers[clusterId].terminate();
        }
      }
      if (msg.type === "worker_login_verify") {
        const { clusterId: cId, profileName: pName, botUid } = msg;
        const botUidStr = String(botUid);

        // 1. Kiểm tra xem UID này có đang chạy ở Cụm khác không
        let conflictCluster = null;
        let conflictProfile = null;
        for (const [existingCId, info] of activeClusterUids.entries()) {
          if (existingCId !== cId && String(info.uid) === botUidStr) {
            conflictCluster = existingCId;
            conflictProfile = info.profileName;
            break;
          }
        }

        if (conflictCluster) {
          console.error(`\n[MASTER 🚨 LỖI TRÙNG TÀI KHOẢN] Cụm ${cId} (Profile: ${pName}) vừa đăng nhập trùng UID ${botUidStr} với Cụm ${conflictCluster} (Profile: ${conflictProfile})!`);
          console.error(`[MASTER 🛑] Đã từ chối kết nối Cụm ${cId} để tránh xung đột session và Facebook khóa spam!`);
          worker.postMessage({
            type: "login_rejected",
            reason: "duplicate_uid",
            botUid: botUidStr,
            conflictCluster,
            conflictProfile
          });
          return;
        }

        // 2. Kiểm tra xem UID này có đúng với Cụm phân công không
        const validation = await accountProfilesManager.verifyAccountCluster(pName, botUidStr, cId);
        if (!validation.valid) {
          console.error(`\n[MASTER ⚠️ SAI CỤM PHÂN CÔNG] Cụm ${cId} (Profile: ${pName}) đăng nhập UID ${botUidStr} nhưng tài khoản này thuộc Cụm ${validation.registeredCluster}! (${validation.message || ""})`);
          worker.postMessage({
            type: "login_rejected",
            reason: "wrong_cluster",
            botUid: botUidStr,
            expectedCluster: validation.registeredCluster,
            message: validation.message
          });
          return;
        }

        // 3. Hợp lệ -> Đăng ký vào Master và reset bộ đếm thử lại
        activeClusterUids.set(cId, { uid: botUidStr, profileName: pName });
        clusterRestartAttempts.delete(cId);
        console.log(`[MASTER ✅ XÁC THỰC THÀNH CÔNG] Cụm ${cId} (Profile: ${pName}) ➡️ UID: ${botUidStr}`);
        worker.postMessage({
          type: "login_approved",
          clusterId: cId,
          profileName: pName,
          botUid: botUidStr
        });
        flushPendingAlerts(worker);
      }
    });

    worker.on('exit', (code) => {
      activeClusterUids.delete(clusterId);
      delete activeWorkers[clusterId];
      const attempts = (clusterRestartAttempts.get(clusterId) || 0) + 1;
      clusterRestartAttempts.set(clusterId, attempts);
      // Exponential backoff + random jitter: min 4s, max 60s
      const baseDelay = Math.min(60000, 3000 * Math.pow(1.4, Math.min(attempts, 8)));
      const jitter = Math.floor(Math.random() * 2000);
      const delay = Math.floor(baseDelay + jitter);
      console.log(`[MASTER] ⚠️ Worker Cụm ${clusterId} đã thoát (code ${code}). Tự động khởi động lại sau ${(delay / 1000).toFixed(1)}s (lần thử ${attempts})...`);
      setTimeout(() => {
        // Lấy lại cấu hình phòng trường hợp Master đã cập nhật lại active_profile qua tính năng Xoay vòng
        accountProfilesManager.loadConfig();
        const currentConfig = accountProfilesManager.config.clusters?.find(c => c.cluster_id === clusterId);
        if (currentConfig && currentConfig.enabled !== false && currentConfig.status !== 'paused') {
          spawnWorkerForCluster(clusterId, currentConfig.active_profile);
        }
      }, delay);
    });
  }

  // Khởi động các Cụm theo thứ tự giãn cách 3.5s - 5s
  let spawnDelayMs = 0;
  for (const c of clusters) {
    if (c.enabled !== false && c.status !== 'paused') {
      const clusterIdToRun = c.cluster_id;
      const profileNameToRun = c.active_profile;
      const curDelay = spawnDelayMs;
      setTimeout(() => {
        spawnWorkerForCluster(clusterIdToRun, profileNameToRun);
      }, curDelay);
      const jitter = Math.floor(Math.random() * 1500);
      spawnDelayMs += 3500 + jitter;
    }
  }

  // 🚀 BỘ ĐẾM GIỜ LUÂN PHIÊN CA LÀM VIỆC (LƯU VẾT TRÊN Ổ CỨNG, KHÔNG BỊ MẤT KHI RESTART PM2)
  const ROTATE_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 tiếng đổi ca 1 lần

  function checkAndRotateClusters() {
    accountProfilesManager.loadConfig();
    const now = Date.now();
    const clusters = accountProfilesManager.config.clusters || [];

    for (const c of clusters) {
      // 1. Kiểm tra hẹn giờ tự động bật lại (enable_at)
      if ((c.enabled === false || c.status === 'paused' || c.status === 'disabled') && c.enable_at) {
        if (now >= new Date(c.enable_at).getTime()) {
          console.log(`[MASTER ⏰] Đã đến giờ hẹn bật lại cho Cụm ${c.cluster_id} ("${c.name}"). Tự động khôi phục hoạt động...`);
          c.enabled = true;
          c.status = 'active';
          delete c.enable_at;
          accountProfilesManager.saveConfig();
        }
      }

      // Nếu cụm vẫn đang bị tạm ngưng -> Tự động dừng luồng con nếu đang chạy
      if (c.enabled === false || c.status === 'paused' || c.status === 'disabled') {
        if (activeWorkers[c.cluster_id]) {
          console.log(`[MASTER ⏸️] Cụm ${c.cluster_id} ("${c.name}") đang TẠM NGƯNG. Đang tắt luồng con...`);
          activeWorkers[c.cluster_id].terminate();
        }
        continue;
      }

      // 2. Nếu cụm được bật lại (enabled: true) mà chưa chạy -> Tự động khởi tạo luồng con ngay mà không cần restart
      if (!activeWorkers[c.cluster_id] && c.active_profile) {
        console.log(`[MASTER 🚀] Phát hiện Cụm ${c.cluster_id} ("${c.name}") được BẬT LẠI (enabled: true). Tự động khởi tạo luồng con cho Profile "${c.active_profile}"...`);
        spawnWorkerForCluster(c.cluster_id, c.active_profile);
      }

      if (!c.profiles || c.profiles.length <= 1) continue;

      const lastRotated = c.last_rotated_at ? new Date(c.last_rotated_at).getTime() : 0;
      if (!lastRotated) {
        c.last_rotated_at = new Date().toISOString();
        accountProfilesManager.saveConfig();
        const remainMins = Math.round(ROTATE_INTERVAL_MS / 60000);
        console.log(`[MASTER] ⏳ Cụm ${c.cluster_id} (hiện chạy "${c.active_profile}") sẽ đổi ca sau: ${remainMins} phút`);
        continue;
      }

      const elapsed = now - lastRotated;
      if (elapsed >= ROTATE_INTERVAL_MS) {
        console.log(`\n[MASTER ⏰] Đã đến giờ xoay ca làm việc cho Cụm ${c.cluster_id} (đã chạy liên tục ${Math.round(elapsed / 60000)} phút)!`);
        const newProfile = accountProfilesManager.rotateClusterProfile(c.cluster_id);
        if (newProfile) {
          if (activeWorkers[c.cluster_id]) {
            console.log(`[MASTER 🔄] Đang tắt luồng Cụm ${c.cluster_id} để nhường phiên cho "${newProfile}"...`);
            activeWorkers[c.cluster_id].terminate();
          }
        }
      }
    }
  }

  // Chạy kiểm tra ngay khi khởi động và lặp lại mỗi 60 giây (tự động spawn đúng 1 worker cho mỗi cụm enabled)
  checkAndRotateClusters();
  setInterval(checkAndRotateClusters, 60000);

  // DỪNG MASTER Ở ĐÂY, KHÔNG CHO CHẠY CODE BOT BÊN DƯỚI
  return;



  // DỪNG MASTER Ở ĐÂY, KHÔNG CHO CHẠY CODE BOT BÊN DƯỚI
  return;
}

// =================================================================
// 🚀 LUỒNG WORKER (CHỈ CHẠY CODE BOT CHO CỤM TƯƠNG ỨNG)
// =================================================================
if (!isMainThread) {
  // Lắng nghe tin nhắn từ Master (chẳng hạn webhook SePay gọi gửi tin nhắn)
  parentPort.on('message', (msg) => {
    if (msg.type === "send_message" && global.api_instance) {
      global.api_instance.sendMessage(msg.body, msg.threadID);
    }
  });
}


const TARGET_ALERT_THREAD = '1523319575522034';

function formatCheckpointAlert({ failedProfile, failedUid, failedName, clusterId, newProfile, reason }) {
  const nowStr = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  
  let msg = `🚨 [ CẢNH BÁO TÀI KHOẢN BỊ CHECKPOINT ] 🚨\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `👤 Tên tài khoản: ${failedName && failedName.trim() ? failedName : "Chưa xác định tên"}\n`;
  msg += `🆔 UID: ${failedUid || "Không rõ"}\n`;
  msg += `📁 Profile: ${failedProfile}\n`;
  msg += `🏷️ Cụm phụ trách: Cụm ${clusterId}\n`;
  msg += `⏰ Thời gian: ${nowStr}\n`;
  msg += `⚠️ Lý do: ${reason || "Bị checkpoint / Phiên Facebook hết hạn"}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (newProfile) {
    msg += `🔄 Hệ thống đã tự động chuyển sang nick dự phòng: "${newProfile}" cho Cụm ${clusterId}.`;
  } else {
    msg += `❌ Cụm ${clusterId} hiện KHÔNG còn nick dự phòng nào khả dụng! Cụm có thể tạm ngừng hoạt động.`;
  }
  return msg;
}

const sendCheckpointAlert = (info) => {
  const alertBody = formatCheckpointAlert(info);
  if (!isMainThread && parentPort) {
    try {
      parentPort.postMessage({
        type: "checkpoint_alert",
        alertBody,
        threadID: TARGET_ALERT_THREAD,
        clusterId: info.clusterId
      });
    } catch (e) {
      console.error("Lỗi gửi checkpoint_alert từ Worker lên Master:", e);
    }
  } else if (global.api_instance && typeof global.api_instance.sendMessage === "function") {
    global.api_instance.sendMessage(alertBody, TARGET_ALERT_THREAD, () => {});
  }
};

const handleProfileCheckpointAndRotate = async (failedProfileName, reason = "Bị khóa Checkpoint / Hết hạn phiên Facebook") => {
  let myClusterId = (!isMainThread && workerData && workerData.clusterId) ? workerData.clusterId : 1;
  try {
    accountProfilesManager.loadConfig();
    for (const c of accountProfilesManager.config?.clusters || []) {
      if (c.profiles && c.profiles.includes(failedProfileName)) {
        myClusterId = c.cluster_id;
        break;
      }
    }

    // 1. Lấy thông tin Tên và UID của tài khoản bị lỗi từ SQLite
    let failedUid = null;
    let failedAccName = null;
    try {
      const rows = await execute(
        `SELECT uid, account_name FROM profile_accounts WHERE profile_name = ?`,
        [failedProfileName]
      );
      if (rows && rows.length > 0) {
        failedUid = rows[0].uid;
        failedAccName = rows[0].account_name;
      }
    } catch (e) {}

    const newProf = await accountProfilesManager.switchProfileOnCheckpoint(failedProfileName, myClusterId);

    // 2. Gửi cảnh báo về nhóm 1523319575522034 kèm Tên và UID
    sendCheckpointAlert({
      failedProfile: failedProfileName,
      failedUid,
      failedName: failedAccName,
      clusterId: myClusterId,
      newProfile: newProf,
      reason
    });

    if (newProf) {
      console.log(`[🔄] Đã tự động đổi sang acc dự phòng "${newProf}" cho Cụm ${myClusterId} do "${failedProfileName}" bị lỗi/checkpoint.`);
      requestWorkerRestart(`đổi sang acc dự phòng ${newProf}`);
      return true;
    }
  } catch (e) {
    console.error(`❌ Lỗi khi tự động xoay acc dự phòng cho Cụm ${myClusterId}:`, e.message);
  }
  return false;
};

const attemptLogin = () => {
  let activeProfiles = accountProfilesManager.getActiveProfilesToRun();
  if (!isMainThread && workerData && workerData.profileName) {
    activeProfiles = [workerData.profileName];
  }

  const appstatesDir = path.join(__dirname, "runtime", "appstates");
  const credentialList = [];
  let missingAppstate = false;

  for (const profileName of activeProfiles) {
    const pPath = path.join(appstatesDir, `appstate_${profileName}.json`);
    let targetPath = null;

    if (fs.existsSync(pPath)) {
      targetPath = pPath;
    }

    if (targetPath && fs.existsSync(targetPath)) {
      try {
        const raw = fs.readFileSync(targetPath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          credentialList.push({
            profileName,
            appState: parsed
          });
          continue;
        }
      } catch (e) { }
    }
  }

  const missingProfilesList = activeProfiles.filter(p => !credentialList.some(c => c.profileName === p));

  if (missingProfilesList.length > 0) {
    const targetProfile = missingProfilesList[0];
    console.log(`⚠️ Profile "${targetProfile}" chưa có appstate hợp lệ. Đang khởi chạy tiến trình tự động xuất cookie từ trình duyệt...`);
    const success = runAutoExtractor(targetProfile);
    if (!success) {
      (async () => {
        const rotated = await handleProfileCheckpointAndRotate(targetProfile);
        if (!rotated) {
          scheduleLoginRetry(`đang chờ cập nhật appstate mới từ trình duyệt cho ${targetProfile}`, 15000);
        }
      })();
      return;
    }
    scheduleLoginRetry(`đang nạp appstate mới cho ${targetProfile}`, 3000);
    return;
  }

  if (credentialList.length === 0) {
    scheduleLoginRetry("thiếu appstate.json hợp lệ", RETRY_BASE_DELAY_MS);
    return;
  }

  console.log(`🔁 Tìm thấy ${credentialList.length} Profile có appstate hợp lệ (${credentialList.map(c => c.profileName).join(", ")}). Tiến hành đăng nhập...`);

  for (let idx = 0; idx < credentialList.length; idx++) {
    const cred = credentialList[idx];
    setTimeout(() => {
      console.log(`[🚀] Đang tiến hành đăng nhập Profile "${cred.profileName}"...`);
      global.current_logging_profile = cred.profileName;

      let callbackCalled = false;
      const loginWatchdog = setTimeout(() => {
        if (!callbackCalled) {
          console.warn(`[⏳ WATCHDOG] Đăng nhập Profile "${cred.profileName}" không nhận được phản hồi (FCA nuốt lỗi cookie). Tự động cào lại cookie mới...`);
          const brokenAppstatePath = path.join(__dirname, 'runtime', 'appstates', `appstate_${cred.profileName}.json`);
          try {
            if (fs.existsSync(brokenAppstatePath)) fs.unlinkSync(brokenAppstatePath);
            if (fs.existsSync(APPSTATE_PATH)) fs.unlinkSync(APPSTATE_PATH);
            if (fs.existsSync(LEGACY_APPSTATE_PATH)) fs.unlinkSync(LEGACY_APPSTATE_PATH);
          } catch (e) {}
          runAutoExtractor(cred.profileName);
          requestWorkerRestart(`tự động cào lại cookie do login timeout cho ${cred.profileName}`);
        }
      }, 15000);

      login(
        { appState: cred.appState },
        fcaOptions,
        async (err, api) => {
          callbackCalled = true;
          clearTimeout(loginWatchdog);
          if (err) {
            const errStr = String(err.message || err);
            const isCtxErr = errStr.includes("reading 'ctx'") || errStr.includes("ctx");
            const errReason = isCtxErr ? "Cookie hết hạn hoặc tài khoản bị văng checkpoint Facebook" : errStr;
            console.error(`❌ LỖI ĐĂNG NHẬP cho Profile "${cred.profileName}": ${errReason}`);

            // Xóa ngay appstate hỏng để lần thử sau bot nhận diện là thiếu và tự lấy mới qua Browser
            const brokenAppstatePath = path.join(__dirname, 'runtime', 'appstates', `appstate_${cred.profileName}.json`);
            if (fs.existsSync(brokenAppstatePath)) {
              try {
                fs.unlinkSync(brokenAppstatePath);
                console.log(`[🗑️] Đã xóa appstate hỏng của Profile "${cred.profileName}" để lấy lại mới.`);
              } catch (e) { }
            }
            try {
              if (fs.existsSync(APPSTATE_PATH)) fs.unlinkSync(APPSTATE_PATH);
              if (fs.existsSync(LEGACY_APPSTATE_PATH)) fs.unlinkSync(LEGACY_APPSTATE_PATH);
            } catch (e) {}

            console.warn(`[🚨 CẢNH BÁO] Profile "${cred.profileName}" bị hết hạn cookie / checkpoint. Tự động khởi chạy Trình duyệt lấy lại cookie mới...`);
            const success = runAutoExtractor(cred.profileName);
            if (!success) {
              (async () => {
                const rotated = await handleProfileCheckpointAndRotate(cred.profileName);
                if (!rotated) {
                  requestWorkerRestart(`thử lại đăng nhập cho ${cred.profileName}`);
                }
              })();
              return;
            }
            requestWorkerRestart(`tự động lấy lại cookie mới cho ${cred.profileName}`);
            return;
          }

          if (typeof api.setOptions === "function") {
            api.setOptions(fcaOptions);
          }

          // === BỌC HÀM HỖ TRỢ E2EE (REACTION, TYPING INDICATOR, UNSEND) ===
          if (api) {
            const origSetReaction = api.setMessageReaction;
            api.setMessageReaction = function (reaction, messageID, callback, forceCustomReaction, threadID, senderJid) {
              if (typeof callback !== "function") callback = () => {};
              const threadStr = threadID ? String(threadID) : "";
              const isE2EEThread = (api.e2eeThreads && api.e2eeThreads.has(threadStr)) || (api.e2eeClient && threadStr && (threadStr.includes("@msgr") || threadStr.includes("@g.us")));
              if (api.e2eeClient && (isE2EEThread || (threadStr && !/^\d{15,16}$/.test(threadStr)))) {
                const targetThread = (api.threadToUserMap && api.threadToUserMap.get(threadStr)) || threadStr;
                return api.e2eeClient.sendReaction({
                  threadId: targetThread,
                  messageId: String(messageID),
                  senderJid: senderJid || undefined,
                  reaction: reaction
                }).then((res) => {
                  callback(null, res);
                }).catch(() => {
                  origSetReaction.call(api, reaction, messageID, callback, forceCustomReaction);
                });
              }
              return origSetReaction.call(api, reaction, messageID, callback, forceCustomReaction);
            };

            const origSendTyping = api.sendTypingIndicator;
            api.sendTypingIndicator = function (threadID, callback, isTyping = true) {
              if (typeof callback !== "function") callback = () => {};
              const threadStr = threadID ? String(threadID) : "";
              const isE2EEThread = (api.e2eeThreads && api.e2eeThreads.has(threadStr)) || (api.e2eeClient && threadStr && (threadStr.includes("@msgr") || threadStr.includes("@g.us")));
              if (api.e2eeClient && (isE2EEThread || (threadStr && !/^\d{15,16}$/.test(threadStr)))) {
                const targetThread = (api.threadToUserMap && api.threadToUserMap.get(threadStr)) || threadStr;
                return api.e2eeClient.sendTyping({
                  threadId: targetThread,
                  isTyping: !!isTyping
                }).then((res) => {
                  callback(null, res);
                }).catch(() => {
                  origSendTyping.call(api, threadID, callback, isTyping);
                });
              }
              return origSendTyping.call(api, threadID, callback, isTyping);
            };

            const origUnsend = api.unsendMessage;
            api.unsendMessage = function (messageID, arg2, arg3) {
              let threadID = undefined;
              let callback = null;
              if (typeof arg2 === "function") {
                callback = arg2;
                threadID = arg3;
              } else if (typeof arg3 === "function") {
                callback = arg3;
                threadID = arg2;
              } else {
                threadID = arg2;
                callback = null;
              }

              const threadStr = threadID ? String(threadID) : "";
              const msgIdStr = String(messageID || "");
              const isE2EEMsg = /^\d{10,20}$/.test(msgIdStr);

              if (api.e2eeClient && (isE2EEMsg || (api.e2eeThreads && api.e2eeThreads.has(threadStr)) || (threadStr && threadStr.includes("@msgr")))) {
                const targetThread = (api.threadToUserMap && api.threadToUserMap.get(threadStr)) || threadStr;
                const p = api.e2eeClient.unsendMessage({
                  messageId: msgIdStr,
                  threadId: targetThread || undefined,
                  fromMe: true
                }).then((res) => {
                  if (typeof callback === "function") callback(null, res);
                  return res;
                }).catch((err) => {
                  if (typeof callback === "function") callback(err);
                  throw err;
                });
                return p;
              }

              if (typeof callback === "function") {
                return origUnsend.call(api, messageID, threadID, callback);
              } else {
                return new Promise((resolve, reject) => {
                  origUnsend.call(api, messageID, threadID, (err, res) => {
                    if (err) return reject(err);
                    resolve(res);
                  });
                });
              }
            };
          }

          const botID = api.getCurrentUserID();
          const currentClusterId = !isMainThread && workerData?.clusterId ? workerData.clusterId : 1;

          // XÁC THỰC VỚI MASTER TRÁNH TRÙNG TÀI KHOẢN VÀ SAI CỤM
          if (!isMainThread && parentPort) {
            const verifyPromise = new Promise((resolve) => {
              const handler = (msg) => {
                if (msg && msg.type === "login_approved") {
                  parentPort.off('message', handler);
                  resolve({ approved: true });
                } else if (msg && msg.type === "login_rejected") {
                  parentPort.off('message', handler);
                  resolve({
                    approved: false,
                    reason: msg.reason,
                    conflictCluster: msg.conflictCluster,
                    conflictProfile: msg.conflictProfile,
                    expectedCluster: msg.expectedCluster,
                    message: msg.message
                  });
                }
              };
              parentPort.on('message', handler);
              parentPort.postMessage({
                type: "worker_login_verify",
                clusterId: currentClusterId,
                profileName: cred.profileName,
                botUid: botID
              });
            });

            const verifyResult = await verifyPromise;
            if (!verifyResult.approved) {
              console.error(`\n[WORKER CỤM ${currentClusterId} 🛑] DỪNG ĐĂNG NHẬP: Tài khoản UID ${botID} bị Master từ chối!`);
              if (verifyResult.reason === "duplicate_uid") {
                console.error(`[WORKER CỤM ${currentClusterId} 🚨] Tài khoản UID ${botID} đang chạy ở Cụm ${verifyResult.conflictCluster} (Profile: ${verifyResult.conflictProfile}). Không thể chạy 1 nick ở nhiều Cụm!`);
              } else if (verifyResult.reason === "wrong_cluster") {
                console.error(`[WORKER CỤM ${currentClusterId} ⚠️] Tài khoản UID ${botID} không thuộc Cụm ${currentClusterId}! (${verifyResult.message || ""})`);
              }

              // Xóa file appstate trùng lặp
              const brokenAppstatePath = path.join(__dirname, 'runtime', 'appstates', `appstate_${cred.profileName}.json`);
              try {
                if (fs.existsSync(brokenAppstatePath)) fs.unlinkSync(brokenAppstatePath);
                console.log(`[🗑️] Đã xóa appstate không đúng/trùng lặp của Profile "${cred.profileName}".`);
              } catch (e) {}

              // Đóng session FCA
              try {
                if (typeof api.logout === "function") api.logout();
              } catch (e) {}

              return; // DỪNG LUỒNG, KHÔNG CHẠY LISTENMQTT
            }
          } else {
            // Trường hợp chạy đơn luồng (main thread): kiểm tra trực tiếp qua DB
            const validation = await accountProfilesManager.verifyAccountCluster(cred.profileName, botID, currentClusterId);
            if (!validation.valid) {
              console.warn(`[⚠️ CẢNH BÁO PHÂN BỔ CỤM] ${validation.message}`);
            }
          }

          console.log(`✅ [Profile ${cred.profileName}] Đăng nhập thành công ID: ${botID} (Cụm ${currentClusterId})`);

          if (!global.api_instance) global.api_instance = api;
          if (!global.botID) global.botID = botID;
          global.current_profile = cred.profileName;

          // Lấy tên tài khoản Facebook để lưu trữ phục vụ cảnh báo Checkpoint
          let botName = "";
          try {
            const uInfo = await new Promise((resolve) => {
              if (typeof api.getUserInfo === "function") {
                api.getUserInfo(botID, (err, ret) => {
                  if (!err && ret && ret[botID] && ret[botID].name) {
                    resolve(ret[botID].name);
                  } else {
                    resolve("");
                  }
                });
              } else {
                resolve("");
              }
            });
            botName = uInfo || "";
          } catch (e) {}

          // Đồng bộ phân bổ rải nhóm thuê adminbot & tự đếm/rời nhóm thừa (Slot Tracker)
          try {
            await accountProfilesManager.registerActiveAccount(cred.profileName, botID, botName);
            await clusterGroupTracker.syncAndBalanceClusterGroups();
            await clusterGroupTracker.checkAndLeaveExcessGroups(api, botID, cred.profileName);
          } catch (clusterErr) {
            console.error(`❌ Lỗi khi tự đếm/rời nhóm thừa và đồng bộ cụm cho Profile "${cred.profileName}":`, clusterErr.message);
          }

          // --- BẮT LỖI TÍNH NĂNG BỊ KHÓA HOẶC PHIÊN LỖI (ACTION BLOCKED 1390008 / BROWSER REOPEN REQUIRED 1357004) ---
          const handleAccountBlocked = (err) => {
            const errStr = JSON.stringify(err || {}).toLowerCase() + " " + String(err || "").toLowerCase();
            const is1357004 = errStr.includes("1357004") || errStr.includes("đóng và mở lại cửa sổ trình duyệt") || (err && err.error === 1357004);
            const isBlocked = errStr.includes("1390008") || errStr.includes("bảo vệ cộng đồng khỏi spam") || errStr.includes("bị giới hạn tần suất") || (err && (err.error === 1390008 || err.blockedAction));

            if (isBlocked || is1357004) {
              if (is1357004) {
                console.error(`\n[⚠️] TÀI KHOẢN (ID: ${botID}) GẶP LỖI PHIÊN XÁC MINH TRÌNH DUYỆT (Lỗi 1357004)!`);
                console.error(`[🔄] Đang xóa session cũ và tự động xoay vòng sang Profile dự phòng...`);
              } else {
                console.error(`\n[🚫] TÀI KHOẢN (ID: ${botID}) ĐÃ BỊ FACEBOOK KHÓA TÍNH NĂNG GỬI TIN NHẮN (Lỗi 1390008)!`);
                console.error(`[⏳] Tiến hành bỏ qua tài khoản này trong 1 tiếng và tự động xoay vòng sang Profile dự phòng...`);
              }

              try {
                if (isBlocked) {
                  const blockedPath = path.join(__dirname, 'runtime', 'blocked_accounts.json');
                  let blockedData = {};
                  if (fs.existsSync(blockedPath)) {
                    try { blockedData = JSON.parse(fs.readFileSync(blockedPath, 'utf8')); } catch (e) { }
                  }

                  const activeInfoPath = path.join(__dirname, 'runtime', 'active_profile.json');
                  let activeProfileDir = "Default";
                  if (fs.existsSync(activeInfoPath)) {
                    try {
                      const info = JSON.parse(fs.readFileSync(activeInfoPath, 'utf8'));
                      if (info.profileDir) activeProfileDir = info.profileDir;
                    } catch (e) { }
                  }

                  blockedData[activeProfileDir] = {
                    blockedAt: Date.now(),
                    unblockAt: Date.now() + (1 * 60 * 60 * 1000),
                    botID: botID
                  };
                  fs.writeFileSync(blockedPath, JSON.stringify(blockedData, null, 2), 'utf8');
                }

                // Xóa file appstate cũ để lần sau Playwright tự động quét lại cookie mới
                if (fs.existsSync(APPSTATE_PATH)) fs.unlinkSync(APPSTATE_PATH);
                if (fs.existsSync(LEGACY_APPSTATE_PATH)) fs.unlinkSync(LEGACY_APPSTATE_PATH);
              } catch (e) {
                console.error("❌ Lỗi khi dọn dẹp session:", e);
              }

              // Xoay tua Profile ngay lập tức sang nick dự phòng trong Cụm
              (async () => {
                try {
                  await handleProfileCheckpointAndRotate(cred.profileName, "Tài khoản bị Facebook khóa tính năng hoặc lỗi phiên trình duyệt (1390008 / 1357004)");
                  console.log(`[🔄] Đã tự động xoay vòng active_profile Cụm ${myClusterId} sang nick dự phòng do bị Facebook Block Action.`);
                } catch (e) {
                  console.error("❌ Lỗi khi xoay profile do block action:", e);
                } finally {
                  requestWorkerRestart(`xoay profile do block action cho ${cred.profileName}`);
                }
              })();

              return true;
            }
            return false;
          };

          if (!global.knownGroupThreads) global.knownGroupThreads = new Set();

          function isGroupThreadId(threadID) {
            if (!threadID) return false;
            const str = String(threadID);
            if (global.knownGroupThreads.has(str)) return true;
            return str.length >= 15;
          }

          function calculateHumanTypingDelay(msg) {
            if (msg && typeof msg === "object" && (msg.noTyping || msg.skipTyping)) {
              return 0;
            }
            let len = 0;
            if (typeof msg === "string") {
              len = msg.length;
            } else if (msg && typeof msg === "object") {
              if (typeof msg.body === "string") len = msg.body.length;
              if (msg.attachment) len += 40;
            }
            if (len === 0) return 0;

            // Độ trễ tự nhiên tối thiểu 1.2s - 3.5s để người dùng nhìn thấy rõ dấu 3 chấm nhảy múa
            const base = 1200 + Math.min(len * 15, 2300);
            const jitter = Math.floor(Math.random() * 300) - 150;
            return Math.max(1200, Math.min(base + jitter, 3800));
          }

          const originalSendMessage = api.sendMessage;
          if (typeof originalSendMessage === "function") {
            api.sendMessage = function (msg, threadID, arg3, arg4) {
              let callback = null;
              let replyToMessage = undefined;

              if (typeof arg3 === "function") {
                callback = arg3;
                replyToMessage = arg4;
              } else if (typeof arg4 === "function") {
                callback = arg4;
                replyToMessage = arg3;
              } else {
                replyToMessage = arg3;
                callback = null;
              }

              const delay = calculateHumanTypingDelay(msg);
              const tid = String(threadID || "");

              const sendAction = (cb) => {
                let stopTyping = null;
                if (delay > 0 && tid && typeof api.sendTypingIndicator === "function") {
                  try {
                    stopTyping = api.sendTypingIndicator(tid);
                  } catch (e) {}
                }

                setTimeout(() => {
                  let isFinished = false;
                  const safeCallback = (err, messageInfo) => {
                    if (isFinished) return;
                    isFinished = true;
                    if (typeof stopTyping === "function") {
                      try { stopTyping(); } catch (e) {}
                    } else if (typeof api.sendTypingIndicator === "function") {
                      try { api.sendTypingIndicator(tid, false); } catch (e) {}
                    }
                    if (cb) cb(err, messageInfo);
                  };

                  // Fallback timeout sau 12 giây phòng trường hợp Facebook lag không trả callback
                  const fallbackTimer = setTimeout(() => {
                    if (!isFinished) {
                      safeCallback(null, {
                        threadID: tid,
                        messageID: utils.generateOfflineThreadingID ? utils.generateOfflineThreadingID() : String(Date.now()),
                        timestamp: Date.now()
                      });
                    }
                  }, 12000);

                  try {
                    originalSendMessage.call(api, msg, threadID, (err, messageInfo) => {
                      clearTimeout(fallbackTimer);
                      safeCallback(err, messageInfo);
                    }, replyToMessage);
                  } catch (e) {
                    clearTimeout(fallbackTimer);
                    if (handleAccountBlocked(e)) return;
                    safeCallback(e);
                  }
                }, delay);
              };

              if (typeof callback === "function") {
                const wrappedCallback = (err, messageInfo) => {
                  if (err && handleAccountBlocked(err)) return;
                  callback(err, messageInfo);
                };
                sendAction(wrappedCallback);
              } else {
                return new Promise((resolve, reject) => {
                  const wrappedCallback = (err, messageInfo) => {
                    if (err && handleAccountBlocked(err)) return reject(err);
                    if (err) return reject(err);
                    resolve(messageInfo || {});
                  };
                  sendAction(wrappedCallback);
                });
              }
            };
          }

          if (typeof api.sendMessageEffect === "function") {
            const originalSendMessageEffect = api.sendMessageEffect;
            api.sendMessageEffect = function (msg, threadID, arg3, arg4) {
              let callback = null;
              let replyToMessage = undefined;

              if (typeof arg3 === "function") {
                callback = arg3;
                replyToMessage = arg4;
              } else if (typeof arg4 === "function") {
                callback = arg4;
                replyToMessage = arg3;
              } else {
                replyToMessage = arg3;
                callback = null;
              }

              const delay = calculateHumanTypingDelay(msg);
              const tid = String(threadID || "");

              const sendAction = (cb) => {
                let stopTyping = null;
                if (delay > 0 && tid && typeof api.sendTypingIndicator === "function") {
                  try {
                    stopTyping = api.sendTypingIndicator(tid);
                  } catch (e) {}
                }

                setTimeout(() => {
                  let isFinished = false;
                  const safeCallback = (err, messageInfo) => {
                    if (isFinished) return;
                    isFinished = true;
                    if (typeof stopTyping === "function") {
                      try { stopTyping(); } catch (e) {}
                    } else if (typeof api.sendTypingIndicator === "function") {
                      try { api.sendTypingIndicator(tid, false); } catch (e) {}
                    }
                    if (cb) cb(err, messageInfo);
                  };

                  const fallbackTimer = setTimeout(() => {
                    if (!isFinished) {
                      safeCallback(null, {
                        threadID: tid,
                        messageID: utils.generateOfflineThreadingID ? utils.generateOfflineThreadingID() : String(Date.now()),
                        timestamp: Date.now()
                      });
                    }
                  }, 12000);

                  try {
                    originalSendMessageEffect.call(api, msg, threadID, (err, messageInfo) => {
                      clearTimeout(fallbackTimer);
                      safeCallback(err, messageInfo);
                    }, replyToMessage);
                  } catch (e) {
                    clearTimeout(fallbackTimer);
                    if (handleAccountBlocked(e)) return;
                    safeCallback(e);
                  }
                }, delay);
              };

              if (typeof callback === "function") {
                const wrappedCallback = (err, messageInfo) => {
                  if (err && handleAccountBlocked(err)) return;
                  callback(err, messageInfo);
                };
                sendAction(wrappedCallback);
              } else {
                return new Promise((resolve, reject) => {
                  const wrappedCallback = (err, messageInfo) => {
                    if (err && handleAccountBlocked(err)) return reject(err);
                    if (err) return reject(err);
                    resolve(messageInfo || {});
                  };
                  sendAction(wrappedCallback);
                });
              }
            };
          }

          // Ghi nhận và lưu trữ botID vào file runtime/bot_info.json (tách biệt hoàn toàn với adminIDs)
          if (!global.botID) global.botID = String(botID);
          try {
            const { saveBotIdentity } = require("./modules/utils/botIdentity");
            saveBotIdentity({
              botID,
              clusterId: currentClusterId,
              profileName: typeof profileName !== "undefined" ? profileName : "Default",
            });
          } catch (err) {
            console.error("❌ Lỗi lưu thông tin UID bot vào bot_info.json:", err.message);
          }

          // Tự động kiểm tra và tiếp tục gửi thông báo sendallbox còn dở dang (nếu bot bị ngắt giữa chừng trước đó)
          try {
            const { resumeBroadcastIfPending } = require("./modules/commands/adminbot/sendallbox");
            if (typeof resumeBroadcastIfPending === "function") {
              resumeBroadcastIfPending(api);
            }
          } catch (e) {
            console.error("❌ Lỗi tự động tiếp tục đợt gửi sendallbox:", e.message);
          }

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

          const appState = JSON.stringify(api.getAppState(), null, 2);
          fs.mkdirSync(path.dirname(APPSTATE_PATH), { recursive: true });
          fs.writeFileSync(APPSTATE_PATH, appState);
          fs.writeFileSync(LEGACY_APPSTATE_PATH, appState);

          // --- TỰ ĐỘNG CẬP NHẬT APPSTATE ĐỊNH KỲ ---
          // Fix lỗi: Cookie Facebook thay đổi theo thời gian nhưng bot không lưu lại,
          // dẫn đến việc mỗi khi "pm2 restart" bot đọc lại file cũ rích và bị văng Checkpoint.
          const saveAppState = () => {
            try {
              if (api && typeof api.getAppState === 'function') {
                const currentState = JSON.stringify(api.getAppState(), null, 2);
                fs.writeFileSync(APPSTATE_PATH, currentState);
                fs.writeFileSync(LEGACY_APPSTATE_PATH, currentState);
              }
            } catch (err) { }
          };

          // Lưu mỗi 10 phút
          setInterval(saveAppState, 10 * 60 * 1000);

          // Lưu khẩn cấp ngay khi dùng lệnh `pm2 restart` (PM2 gửi SIGINT)
          process.on('SIGINT', () => {
            saveAppState();
            process.exit(0);
          });
          process.on('SIGTERM', () => {
            saveAppState();
            process.exit(0);
          });

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
              if (cmd && !cmd.name && cmd.config?.name) {
                cmd.name = cmd.config.name;
              }
              if (cmd && !cmd.aliases && cmd.config?.aliases) {
                cmd.aliases = cmd.config.aliases;
              }
              // Backwards compatibility: some commands export `run` instead of `execute`.
              if (cmd && !cmd.execute && typeof cmd.run === 'function') {
                cmd.execute = cmd.run;
              }
              if (cmd && cmd.name) {
                cmd.__filePath = file;

                // Tự động phân quyền dựa trên thư mục chứa file
                const parentDirName = path.basename(path.dirname(file));
                const currentPerm = cmd.hasPermission ?? cmd.hasPermssion ?? cmd.config?.hasPermission ?? cmd.config?.hasPermssion ?? 0;

                if (parentDirName === "qtv" && currentPerm < 1) {
                  cmd.hasPermission = 1;
                } else if (parentDirName === "adminbot" && currentPerm < 2) {
                  cmd.hasPermission = 2;
                } else if (!cmd.hasOwnProperty('hasPermission')) {
                  cmd.hasPermission = currentPerm;
                }

                global.commands.set(cmd.name, cmd);
              }
            } catch (e) {
              console.error(`❌ Lỗi nạp module ${path.basename(file)}: ${e.message}`);
            }
          });

          global.events = new Map();
          const eventsDir = path.join(__dirname, "modules", "events");
          if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });
          getAllFiles(eventsDir).forEach((file) => {
            try {
              const ev = require(file);
              if (!ev.name) return;

              global.events.set(ev.name, ev);
            } catch { }
          });

          console.log(
            `📂 Đã nạp ${global.commands.size} lệnh và ${global.events.size} sự kiện.`,
          );

          // --- BẬT HẸN GIỜ TỰ ĐỘNG ĐỔI MODE ---
          startModeScheduler(api);

          // --- BẬT HẸN GIỜ GỬI TIN NHẮN TỰ ĐỘNG (AUTOSEND) ---
          try {
            if (!global.client) global.client = {};
            global.client.api = api;
            require("./modules/utils/autosendScheduler");
          } catch (err) {
            console.error("❌ Lỗi khi khởi động Autosend Scheduler:", err);
          }

          // --- BẬT HẸN GIỜ GỬI TOP TƯƠNG TÁC ---
          const LAST_TOP_CHECK_PATH = path.join(__dirname, "cache", "top_reports_last_check.json");

          const readLastTopCheckState = () => {
            try {
              if (fs.existsSync(LAST_TOP_CHECK_PATH)) {
                const parsed = JSON.parse(fs.readFileSync(LAST_TOP_CHECK_PATH, "utf8"));
                if (parsed && typeof parsed === "object") return parsed;
              }
            } catch (e) {}
            return {};
          };

          const writeLastTopCheckState = (dailyDate, monthlyDate, streakResetDate) => {
            try {
              const dir = path.dirname(LAST_TOP_CHECK_PATH);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              const state = readLastTopCheckState();
              if (dailyDate !== undefined) state.daily = dailyDate;
              if (monthlyDate !== undefined) state.monthly = monthlyDate;
              if (streakResetDate !== undefined) state.streakReset = streakResetDate;
              fs.writeFileSync(LAST_TOP_CHECK_PATH, JSON.stringify(state, null, 2));
            } catch (e) {}
          };

          const savedLastCheck = readLastTopCheckState();
          let lastDailyCheckDate = savedLastCheck.daily || null;
          let lastMonthlyCheckDate = savedLastCheck.monthly || null;
          let lastStreakResetDate = savedLastCheck.streakReset || null;

          // Hàm lấy giờ/phút theo Việt Nam (UTC+7) dưới dạng số
          const getVNTimeComponents = (date) => {
            const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
            return {
              hours: vnTime.getUTCHours(),
              minutes: vnTime.getUTCMinutes(),
            };
          };

          // --- HÀM ĐẾM TIN NHẮN & ĐỌC TRẠNG THÁI TOP (RAM DEBOUNCE BUFFER) ---
          const statsPath = path.join(__dirname, "message_stats.json");
          let inMemoryMessageStats = null;
          let isStatsDirty = false;

          const loadMessageStatsToRam = () => {
            if (inMemoryMessageStats !== null) return inMemoryMessageStats;
            try {
              if (fs.existsSync(statsPath)) {
                const parsed = JSON.parse(fs.readFileSync(statsPath, "utf8"));
                inMemoryMessageStats = parsed && typeof parsed === "object" ? parsed : {};
              } else {
                inMemoryMessageStats = {};
              }
            } catch (e) {
              console.error("❌ Lỗi nạp message_stats.json vào RAM:", e.message);
              inMemoryMessageStats = {};
            }
            return inMemoryMessageStats;
          };

          const flushStatsToDisk = () => {
            if (!isStatsDirty || !inMemoryMessageStats) return;
            try {
              fs.writeFileSync(statsPath, JSON.stringify(inMemoryMessageStats, null, 2));
              isStatsDirty = false;
            } catch (err) {
              console.error("❌ Lỗi ghi message_stats.json xuống đĩa:", err.message);
            }
          };

          // Tự động flush dữ liệu định kỳ mỗi 15 giây nếu có tin nhắn mới
          setInterval(flushStatsToDisk, 15000);

          // Flush an toàn khi tắt bot
          process.on("SIGINT", flushStatsToDisk);
          process.on("SIGTERM", flushStatsToDisk);
          process.on("exit", flushStatsToDisk);

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
            } catch { }

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
            } catch { }

            monthlyTopStateCache = {};
            return monthlyTopStateCache;
          };

          const writeMonthlyTopState = (state) => {
            monthlyTopStateCache = state;
            const dir = path.dirname(MONTHLY_TOP_STATE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(MONTHLY_TOP_STATE_PATH, JSON.stringify(state, null, 2));
          };

          // Hàm lấy ngày theo Việt Nam (UTC+7)
          const getDateStamp = (date) => {
            const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
            const y = vnTime.getUTCFullYear();
            const m = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
            const d = String(vnTime.getUTCDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
          };

          const getTimeKeys = (now = new Date()) => {
            // Chuyển sang giờ Việt Nam (UTC+7)
            const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
            const year = vnTime.getUTCFullYear();
            const month = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
            const day = String(vnTime.getUTCDate()).padStart(2, "0");
            const dayKey = `${year}-${month}-${day}`;
            const monthKey = `${year}-${month}`;

            const weekDate = new Date(Date.UTC(year, vnTime.getUTCMonth(), vnTime.getUTCDate()));
            const weekDay = (weekDate.getUTCDay() + 6) % 7;
            weekDate.setUTCDate(weekDate.getUTCDate() - weekDay + 3);

            const firstThursday = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 4));
            const firstWeekDay = (firstThursday.getUTCDay() + 6) % 7;
            firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekDay + 3);

            const weekNumber =
              1 + Math.round((weekDate - firstThursday) / (7 * 24 * 60 * 60 * 1000));
            const weekKey = `${weekDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;

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
                streak: { current: 0, lastDate: null, lastTime: 0, longest: 0, brokenCount: 0 }
              };
            }

            if (!raw || typeof raw !== "object") {
              return {
                total: 0,
                daily: {},
                weekly: {},
                monthly: {},
                streak: { current: 0, lastDate: null, lastTime: 0, longest: 0, brokenCount: 0 }
              };
            }

            return {
              total: Number(raw.total) || 0,
              daily: raw.daily && typeof raw.daily === "object" ? raw.daily : {},
              weekly: raw.weekly && typeof raw.weekly === "object" ? raw.weekly : {},
              monthly: raw.monthly && typeof raw.monthly === "object" ? raw.monthly : {},
              streak: {
                current: Number(raw.streak?.current) || 0,
                lastDate: raw.streak?.lastDate || null,
                lastTime: Number(raw.streak?.lastTime) || 0,
                longest: Number(raw.streak?.longest) || 0,
                brokenCount: Number(raw.streak?.brokenCount) || 0
              }
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

          const formatDateTime = (timestamp) => {
            if (!timestamp) return "Chưa có dữ liệu";
            const date = new Date(timestamp);
            const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
            const hours = String(vnTime.getUTCHours()).padStart(2, "0");
            const minutes = String(vnTime.getUTCMinutes()).padStart(2, "0");
            const seconds = String(vnTime.getUTCSeconds()).padStart(2, "0");
            const day = String(vnTime.getUTCDate()).padStart(2, "0");
            const month = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
            const year = vnTime.getUTCFullYear();
            return `${hours}:${minutes}:${seconds} ${day}/${month}/${year}`;
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

          // Khóa Mutex chống gửi lặp đồng thời giữa các vòng lặp interval
          let isSendingDailyTop = false;
          let isSendingMonthlyTop = false;
          let isResettingDailyStreak = false;

          const dailyTopFailureCooldowns = new Map(); // threadID -> timestamp
          const dailyTopRetryCounts = new Map(); // threadID -> count
          const monthlyTopFailureCooldowns = new Map(); // threadID -> timestamp
          const monthlyTopRetryCounts = new Map(); // threadID -> count

          /**
           * Hàm phân giải tên người dùng 3 lớp (Tránh lỗi User XXXXXX)
           * Lớp 1: threadInfo.userInfo
           * Lớp 2: global.data.userName & SQLite bảng messenger_users
           * Lớp 3: Batch api.getUserInfo (có timeout)
           */
          const getUserNames = async (api, uids, threadInfo) => {
            const userMap = new Map();
            if (threadInfo?.userInfo && Array.isArray(threadInfo.userInfo)) {
              for (const u of threadInfo.userInfo) {
                if (u && u.id && u.name) userMap.set(String(u.id), u.name);
              }
            }

            const missingUids = uids.map(String).filter((id) => !userMap.has(id));
            if (missingUids.length === 0) return userMap;

            // 1. Tìm trong global.data.userName
            if (global.data?.userName instanceof Map) {
              for (const id of missingUids) {
                if (global.data.userName.has(id)) {
                  userMap.set(id, global.data.userName.get(id));
                }
              }
            }

            const stillMissing = missingUids.filter((id) => !userMap.has(id));
            if (stillMissing.length === 0) return userMap;

            // 2. Tìm trong SQLite (messenger_users)
            try {
              const { execute } = require("./modules/utils/database");
              const placeholders = stillMissing.map(() => "?").join(",");
              const rows = await execute(
                `SELECT psid, name FROM messenger_users WHERE psid IN (${placeholders}) AND name IS NOT NULL AND name != 'Người dùng' AND name != ''`,
                stillMissing
              );
              if (Array.isArray(rows)) {
                for (const row of rows) {
                  if (row && row.psid && row.name) {
                    userMap.set(String(row.psid), row.name);
                  }
                }
              }
            } catch (e) {}

            const finalMissing = stillMissing.filter((id) => !userMap.has(id));
            if (finalMissing.length === 0) return userMap;

            // 3. Batch gọi api.getUserInfo từ Facebook (timeout tối đa 5 giây)
            if (typeof api?.getUserInfo === "function") {
              try {
                const info = await new Promise((resolve) => {
                  const timer = setTimeout(() => resolve(null), 5000);
                  api.getUserInfo(finalMissing, (err, data) => {
                    clearTimeout(timer);
                    if (err || !data) return resolve(null);
                    resolve(data);
                  });
                });
                if (info && typeof info === "object") {
                  if (Array.isArray(info)) {
                    for (const item of info) {
                      if (item && typeof item === "object") {
                        for (const [id, u] of Object.entries(item)) {
                          if (u && u.name) userMap.set(String(id), u.name);
                        }
                      }
                    }
                  } else {
                    for (const [id, u] of Object.entries(info)) {
                      if (u && u.name) userMap.set(String(id), u.name);
                    }
                  }
                }
              } catch (e) {}
            }

            return userMap;
          };

          const performDailyStreakReset = async (api) => {
            if (isResettingDailyStreak) return;
            isResettingDailyStreak = true;
            try {
              const stats = loadMessageStatsToRam();

              const yesterdayKey = getPreviousDayKey();
              const state = readDailyTopState();

              for (const threadID of Object.keys(stats)) {
                const threadStats = stats[threadID];
                const lostUsers = [];

                try {
                  const { checkRentalStatus } = require("./modules/utils/rental");
                  const isRented = await checkRentalStatus(threadID);
                  if (!isRented) continue;

                  const threadInfo = await getThreadInfoCached(api, threadID);
                  if (!threadInfo || !threadInfo.isGroup) continue;

                  const participantIDs = Array.isArray(threadInfo.participantIDs)
                    ? threadInfo.participantIDs.map((id) => String(id))
                    : [];
                  const participantSet = new Set(participantIDs);

                  const activeUids = Object.keys(threadStats).filter(
                    (uid) => /^\d+$/.test(uid) && (participantSet.size === 0 || participantSet.has(uid))
                  );
                  const userMap = await getUserNames(api, activeUids, threadInfo);

                  for (const uid of activeUids) {
                    const entry = normalizeEntry(threadStats[uid]);
                    if (entry.streak.current > 0) {
                      const yesterdayMsgCount = Number(entry.daily?.[yesterdayKey] || 0);
                      if (yesterdayMsgCount === 0) {
                        lostUsers.push({
                          uid,
                          name: userMap.get(uid) || `User ${uid.slice(-6)}`,
                          lostStreak: entry.streak.current,
                        });

                        entry.streak.brokenCount = (entry.streak.brokenCount || 0) + 1;
                        entry.streak.current = 0;

                        stats[threadID][uid] = entry;
                        isStatsDirty = true;
                      }
                    }
                  }

                  state[threadID + "_lostUsers"] = lostUsers;
                } catch (err) {
                  console.error(`❌ Lỗi reset chuỗi cho nhóm ${threadID}:`, err.message);
                }
              }

              flushStatsToDisk();
              writeDailyTopState(state);
              console.log("✅ Hoàn thành quét reset chuỗi tương tác hàng ngày.");
            } catch (e) {
              console.error("❌ Lỗi quét reset chuỗi tương tác hàng ngày:", e);
            } finally {
              isResettingDailyStreak = false;
            }
          };

          const sendDailyTop10ToAllGroups = async (api) => {
            if (isSendingDailyTop) return;
            isSendingDailyTop = true;
            try {
              const stats = loadMessageStatsToRam();

              const yesterdayKey = getPreviousDayKey();
              const todayKey = getTimeKeys().dayKey;
              const state = readDailyTopState();
              const nowTs = Date.now();

              for (const threadID of Object.keys(stats)) {
                if (state[threadID] === yesterdayKey) continue;

                // Kiểm tra cooldown nếu nhóm này vừa bị lỗi
                const cooldownUntil = dailyTopFailureCooldowns.get(threadID) || 0;
                if (nowTs < cooldownUntil) continue;

                // Kiểm tra số lần thử lại tối đa (3 lần/ngày)
                const retries = dailyTopRetryCounts.get(threadID) || 0;
                if (retries >= 3) continue;

                // Kiểm tra trạng thái thuê bot
                try {
                  const { checkRentalStatus } = require("./modules/utils/rental");
                  const isRented = await checkRentalStatus(threadID);
                  if (!isRented) {
                    state[threadID] = yesterdayKey;
                    writeDailyTopState(state);
                    continue;
                  }
                } catch (e) {
                  console.error(`❌ Lỗi check rental cho top ngày nhóm ${threadID}:`, e.message);
                }

                const threadStats = stats[threadID];
                const ranked = Object.entries(threadStats)
                  .filter(([uid]) => /^\d+$/.test(String(uid)))
                  .map(([uid, raw]) => {
                    const entry = normalizeEntry(raw);
                    let yesterdayStreak = 0;
                    if (entry.streak) {
                      if (entry.streak.lastDate === todayKey) {
                        yesterdayStreak = entry.streak.current > 1 ? entry.streak.current - 1 : 0;
                      } else if (entry.streak.lastDate === yesterdayKey) {
                        yesterdayStreak = entry.streak.current;
                      }
                    }
                    return {
                      uid: String(uid),
                      count: Number(entry.daily?.[yesterdayKey] || 0),
                      total: Number(entry.total || 0),
                      streakValue: yesterdayStreak
                    };
                  })
                  .filter((item) => item.count > 0)
                  .sort((a, b) => {
                    const dayDiff = b.count - a.count;
                    if (dayDiff !== 0) return dayDiff;
                    return b.total - a.total;
                  });

                if (ranked.length === 0) {
                  state[threadID] = yesterdayKey;
                  writeDailyTopState(state);
                  continue;
                }

                try {
                  let threadInfo = await getThreadInfoCached(api, threadID);
                  if (!threadInfo) {
                    console.warn(`[sendDailyTop10] Không lấy được threadInfo cho nhóm ${threadID} (có thể bị rate-limit), dùng fallback.`);
                    threadInfo = { isGroup: true, userInfo: [] };
                  }
                  if (threadInfo.isGroup === false) continue;

                  const top10 = ranked.slice(0, 10);
                  const userMap = await getUserNames(api, top10.map((item) => item.uid), threadInfo);

                  const lines = [
                    `📊 TOP 10 TƯƠNG TÁC NGÀY ${formatDayLabel(yesterdayKey)}`,
                    "━".repeat(13),
                    ...top10.map((item, idx) => {
                      const name =
                        userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
                      const currentStreak = item.streakValue || 0;
                      return `${idx + 1}. ${name} - ${item.count} tin | ${currentStreak} ngày 🔥`;
                    }),
                  ];

                  const totalMessages = ranked.reduce((acc, item) => acc + item.count, 0);
                  lines.push('━'.repeat(13));
                  lines.push(`💬 Tổng tin nhắn trong ngày: ${totalMessages}`);

                  const lostUsers = state[threadID + "_lostUsers"] || [];
                  if (lostUsers.length > 0) {
                    lines.push("");
                    lines.push("❄️ THÀNH VIÊN ĐÃ MẤT CHUỖI");
                    lines.push("━".repeat(13));
                    lostUsers.forEach((user) => {
                      lines.push(`- ${user.name} (đứt chuỗi ${user.lostStreak} ngày)`);
                    });
                    delete state[threadID + "_lostUsers"];
                  }

                  const sendResult = await new Promise((resolve, reject) => {
                    const bodyMsg = lines.join("\n");
                    const sendFallback = () => {
                      api.sendMessage(bodyMsg, threadID, (err, info) => {
                        if (err) return reject(err);
                        resolve(info);
                      });
                    };

                    if (typeof api.sendMessageEffect === "function") {
                      try {
                        const effects = ["LOVE", "GIFTWRAP", "CELEBRATION", "FIRE"];
                        const randomEffect = effects[Math.floor(Math.random() * effects.length)];
                        api.sendMessageEffect({ body: bodyMsg, effect: randomEffect }, threadID, (err, info) => {
                          if (err) return sendFallback();
                          resolve(info);
                        });
                      } catch (e) {
                        sendFallback();
                      }
                    } else {
                      sendFallback();
                    }
                  });

                  // Chỉ ghi nhận thành công khi Facebook trả về xác nhận
                  if (sendResult && (sendResult.messageID || sendResult.messageIDs || typeof sendResult === "object")) {
                    state[threadID] = yesterdayKey;
                    writeDailyTopState(state);
                    dailyTopFailureCooldowns.delete(threadID);
                    dailyTopRetryCounts.delete(threadID);
                    console.log(`✅ Đã gửi TOP 10 tương tác ngày cho nhóm ${threadID}`);
                  } else {
                    throw new Error("Không nhận được messageID xác nhận từ Facebook");
                  }

                  // Delay 2 giây giữa các nhóm để tránh bị Facebook throttle
                  await new Promise((r) => setTimeout(r, 2000));
                } catch (e) {
                  const errMsg = e?.message || String(e || "");
                  console.error(`❌ Lỗi gửi TOP 10 cho nhóm ${threadID}:`, errMsg);

                  if (errMsg.includes("1545012")) {
                    console.warn(`⚠️ [sendDailyTop10] Bot không còn trong nhóm ${threadID} (bị kick hoặc nhóm khóa). Bỏ qua báo cáo.`);
                    state[threadID] = yesterdayKey;
                    writeDailyTopState(state);
                  } else {
                    // Lỗi tạm thời: KHÔNG đánh dấu đã gửi (tránh fake status), thiết lập cooldown 5 phút
                    const currentRetries = (dailyTopRetryCounts.get(threadID) || 0) + 1;
                    dailyTopRetryCounts.set(threadID, currentRetries);
                    dailyTopFailureCooldowns.set(threadID, Date.now() + 5 * 60 * 1000);
                    console.log(`⏳ Sẽ thử lại gửi TOP 10 cho nhóm ${threadID} sau 5 phút (Lần thử: ${currentRetries}/3)`);
                  }
                }
              }

              writeDailyTopState(state);
            } catch (e) {
              console.error("❌ Lỗi gửi TOP 10 tương tác ngày cho tất cả nhóm:", e);
            } finally {
              isSendingDailyTop = false;
            }
          };

          const sendMonthlyTop10ToAllGroups = async (api) => {
            if (isSendingMonthlyTop) return;
            isSendingMonthlyTop = true;
            try {
              const stats = loadMessageStatsToRam();

              const previousMonthKey = getPreviousMonthKey();
              const state = readMonthlyTopState();
              const nowTs = Date.now();

              for (const threadID of Object.keys(stats)) {
                if (state[threadID] === previousMonthKey) continue;

                // Kiểm tra cooldown nếu nhóm này vừa bị lỗi
                const cooldownUntil = monthlyTopFailureCooldowns.get(threadID) || 0;
                if (nowTs < cooldownUntil) continue;

                // Kiểm tra số lần thử lại tối đa (3 lần)
                const retries = monthlyTopRetryCounts.get(threadID) || 0;
                if (retries >= 3) continue;

                // Skip sending monthly stats if the group's rental has expired
                try {
                  const { checkRentalStatus } = require("./modules/utils/rental");
                  const isRented = await checkRentalStatus(threadID);
                  if (!isRented) {
                    state[threadID] = previousMonthKey;
                    writeMonthlyTopState(state);
                    continue;
                  }
                } catch (e) {
                  console.error(`❌ Lỗi check rental cho top tháng nhóm ${threadID}:`, e.message);
                }

                const threadStats = stats[threadID];
                const ranked = Object.entries(threadStats)
                  .filter(([uid]) => /^\d+$/.test(String(uid)))
                  .map(([uid, raw]) => {
                    const entry = normalizeEntry(raw);
                    return {
                      uid: String(uid),
                      count: Number(entry.monthly?.[previousMonthKey] || 0),
                      total: Number(entry.total || 0),
                      streak: entry.streak
                    };
                  })
                  .filter((item) => item.count > 0)
                  .sort((a, b) => {
                    const monthDiff = b.count - a.count;
                    if (monthDiff !== 0) return monthDiff;
                    return b.total - a.total;
                  });

                if (ranked.length === 0) {
                  state[threadID] = previousMonthKey;
                  writeMonthlyTopState(state);
                  continue;
                }

                // Top 10 longest streaks
                const rankedStreaks = Object.entries(threadStats)
                  .filter(([uid]) => /^\d+$/.test(String(uid)))
                  .map(([uid, raw]) => {
                    const entry = normalizeEntry(raw);
                    return {
                      uid: String(uid),
                      longest: Number(entry.streak?.longest || 0)
                    };
                  })
                  .filter((item) => item.longest > 0)
                  .sort((a, b) => b.longest - a.longest);

                try {
                  let threadInfo = await getThreadInfoCached(api, threadID);
                  if (!threadInfo) {
                    console.warn(`[sendMonthlyTop10] Không lấy được threadInfo cho nhóm ${threadID} (có thể bị rate-limit), dùng fallback.`);
                    threadInfo = { isGroup: true, userInfo: [] };
                  }
                  if (threadInfo.isGroup === false) continue;

                  const top10 = ranked.slice(0, 10);
                  const streakTop10 = rankedStreaks.slice(0, 10);
                  const allNeededUids = Array.from(new Set([...top10.map(i => i.uid), ...streakTop10.map(i => i.uid)]));
                  const userMap = await getUserNames(api, allNeededUids, threadInfo);

                  const lines = [
                    `📊 TOP 10 TƯƠNG TÁC THÁNG ${formatMonthLabel(previousMonthKey)}`,
                    "━".repeat(13),
                    ...top10.map((item, idx) => {
                      const name =
                        userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
                      const longest = item.streak?.longest || 0;
                      const broken = item.streak?.brokenCount || 0;
                      const streakText = longest > 0 ? ` (Kỷ lục: ${longest} ngày${broken > 0 ? `, đứt chuỗi: ${broken} lần` : ""})` : "";
                      return `${idx + 1}. ${name} — ${item.count}${streakText}`;
                    }),
                  ];

                  const totalMessages = ranked.reduce((acc, item) => acc + item.count, 0);
                  lines.push('━'.repeat(13));
                  lines.push(`💬 Tổng tin nhắn trong tháng: ${totalMessages}`);

                  if (rankedStreaks.length > 0) {
                    lines.push("");
                    lines.push("🔥 TOP 10 GIỮ CHUỖI TƯƠNG TÁC LÂU NHẤT THÁNG");
                    lines.push("━".repeat(13));
                    streakTop10.forEach((item, idx) => {
                      const name = userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
                      lines.push(`${idx + 1}. ${name} — ${item.longest} ngày`);
                    });
                  }

                  const sendResult = await new Promise((resolve, reject) => {
                    const bodyMsg = lines.join("\n");
                    const sendFallback = () => {
                      api.sendMessage(bodyMsg, threadID, (err, info) => {
                        if (err) return reject(err);
                        resolve(info);
                      });
                    };

                    if (typeof api.sendMessageEffect === "function") {
                      try {
                        const copyEffects = ["LOVE", "GIFTWRAP", "CELEBRATION", "FIRE"];
                        const randomEffect = copyEffects[Math.floor(Math.random() * copyEffects.length)];
                        api.sendMessageEffect({ body: bodyMsg, effect: randomEffect }, threadID, (err, info) => {
                          if (err) return sendFallback();
                          resolve(info);
                        });
                      } catch (e) {
                        sendFallback();
                      }
                    } else {
                      sendFallback();
                    }
                  });

                  if (sendResult && (sendResult.messageID || sendResult.messageIDs || typeof sendResult === "object")) {
                    // Reset brokenCount cho toàn bộ thành viên nhóm sau khi báo cáo tháng
                    for (const uid of Object.keys(threadStats)) {
                      if (/^\d+$/.test(uid)) {
                        if (stats[threadID][uid] && stats[threadID][uid].streak) {
                          stats[threadID][uid].streak.brokenCount = 0;
                          isStatsDirty = true;
                        }
                      }
                    }

                    state[threadID] = previousMonthKey;
                    writeMonthlyTopState(state);
                    monthlyTopFailureCooldowns.delete(threadID);
                    monthlyTopRetryCounts.delete(threadID);
                    console.log(
                      `✅ Đã gửi TOP 10 tương tác tháng cho nhóm ${threadID}`,
                    );
                  } else {
                    throw new Error("Không nhận được messageID xác nhận từ Facebook");
                  }

                  // Delay 2 giây giữa các nhóm để tránh bị Facebook throttle
                  await new Promise((r) => setTimeout(r, 2000));
                } catch (e) {
                  const errMsg = e?.message || String(e || "");
                  console.error(
                    `❌ Lỗi gửi TOP 10 tháng cho nhóm ${threadID}:`,
                    errMsg,
                  );

                  if (errMsg.includes("1545012")) {
                    console.warn(`⚠️ [sendMonthlyTop10] Bot không còn trong nhóm ${threadID}. Bỏ qua báo cáo.`);
                    state[threadID] = previousMonthKey;
                    writeMonthlyTopState(state);
                  } else {
                    // Lỗi tạm thời: KHÔNG đánh dấu đã gửi, thiết lập cooldown 5 phút
                    const currentRetries = (monthlyTopRetryCounts.get(threadID) || 0) + 1;
                    monthlyTopRetryCounts.set(threadID, currentRetries);
                    monthlyTopFailureCooldowns.set(threadID, Date.now() + 5 * 60 * 1000);
                    console.log(`⏳ Sẽ thử lại gửi TOP 10 tháng cho nhóm ${threadID} sau 5 phút (Lần thử: ${currentRetries}/3)`);
                  }
                }
              }

              flushStatsToDisk();
              writeMonthlyTopState(state);
            } catch (e) {
              console.error("❌ Lỗi gửi TOP 10 tương tác tháng cho tất cả nhóm:", e);
            } finally {
              isSendingMonthlyTop = false;
            }
          };

          const checkAndSendTopStats = async () => {
            const now = new Date();
            const { hours, minutes } = getVNTimeComponents(now);
            const currentDate = getDateStamp(now);
            const currentDay = parseInt(currentDate.split("-")[2]);

            // Quét và reset chuỗi lúc 00:00-00:04 hàng ngày (giờ Việt Nam)
            if (
              hours === 0 &&
              minutes >= 0 &&
              minutes <= 4 &&
              lastStreakResetDate !== currentDate &&
              !isResettingDailyStreak
            ) {
              console.log("🕗 Đang quét và reset chuỗi tương tác (00:00)...");
              lastStreakResetDate = currentDate;
              writeLastTopCheckState(undefined, undefined, currentDate);
              await performDailyStreakReset(api);
            }

            // Đọc trạng thái per-group
            const dailyState = readDailyTopState();
            const monthlyState = readMonthlyTopState();
            const yesterdayKey = getPreviousDayKey(now);
            const previousMonthKey = getPreviousMonthKey(now);
            const stats = loadMessageStatsToRam();

            // Kiểm tra xem còn nhóm nào chưa nhận báo cáo ngày hôm qua không
            const hasPendingDaily = Object.keys(stats).some(
              (tid) => dailyState[tid] !== yesterdayKey
            );

            // Kiểm tra gửi top ngày từ 6:00 sáng trở đi nếu còn ít nhất 1 nhóm chưa nhận hoặc chưa gửi hôm nay
            if (
              (hours > 6 || (hours === 6 && minutes >= 0)) &&
              (lastDailyCheckDate !== currentDate || hasPendingDaily) &&
              !isSendingDailyTop
            ) {
              console.log("🕗 Đang gửi TOP 10 tương tác ngày cho tất cả nhóm chưa nhận...");
              lastDailyCheckDate = currentDate; // Đánh dấu trước để tránh gọi lặp lại
              writeLastTopCheckState(currentDate, undefined, undefined);
              await sendDailyTop10ToAllGroups(api);
            }

            // Kiểm tra xem còn nhóm nào chưa nhận báo cáo tháng không (chỉ gửi vào ngày đầu tiên của tháng mới - ngày 1)
            const isFirstDayOfMonth = currentDay === 1;
            const hasPendingMonthly = isFirstDayOfMonth && Object.keys(stats).some(
              (tid) => monthlyState[tid] !== previousMonthKey
            );

            // Kiểm tra gửi top tháng vào ngày 1 hàng tháng từ 6:00 sáng trở đi
            if (
              isFirstDayOfMonth &&
              (hours > 6 || (hours === 6 && minutes >= 0)) &&
              (lastMonthlyCheckDate !== currentDate || hasPendingMonthly) &&
              !isSendingMonthlyTop
            ) {
              console.log("🕗 Đang gửi TOP 10 tương tác tháng cho tất cả nhóm chưa nhận...");
              lastMonthlyCheckDate = currentDate;
              writeLastTopCheckState(undefined, currentDate, undefined);
              await sendMonthlyTop10ToAllGroups(api);
            }
          };

          // Kiểm tra mỗi 30 giây để tránh miss thời điểm gửi
          setInterval(checkAndSendTopStats, 30000);
          console.log("✅ Đã bật hẹn giờ gửi TOP tương tác (6:00 sáng mỗi ngày)");

          // Chạy kiểm tra ngay lập tức khi vừa đăng nhập / vừa lấy lại appstate mới
          checkAndSendTopStats().catch((err) =>
            console.error("❌ Lỗi kiểm tra TOP ngay sau khi có appstate/đăng nhập:", err.message)
          );

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

          const updateMessageStats = (senderID, threadID, event = null, isRented = true) => {
            try {
              const stats = loadMessageStatsToRam();

              if (!stats[threadID]) {
                stats[threadID] = {};
              }

              const uid = String(senderID);
              const entry = normalizeEntry(stats[threadID][uid]);
              const { dayKey, weekKey, monthKey } = getTimeKeys();

              // Cập nhật chuỗi tương tác (Streak) - Chỉ tính khi nhóm đang thuê bot hợp lệ
              if (isRented) {
                entry.streak.lastTime = Date.now();

                const hasNotUpdatedStreakToday = entry.streak.lastDate !== dayKey;
                if (hasNotUpdatedStreakToday) {
                  const yesterdayKey = getPreviousDayKey();
                  if (entry.streak.lastDate === null) {
                    entry.streak.current = 1;
                    entry.streak.lastDate = dayKey;
                    entry.streak.longest = Math.max(entry.streak.longest, 1);
                  } else if (entry.streak.lastDate === yesterdayKey) {
                    entry.streak.current += 1;
                    entry.streak.lastDate = dayKey;
                    entry.streak.longest = Math.max(entry.streak.longest, entry.streak.current);
                  } else {
                    if (entry.streak.current > 0) {
                      entry.streak.brokenCount = (entry.streak.brokenCount || 0) + 1;
                    }
                    entry.streak.current = 1;
                    entry.streak.lastDate = dayKey;
                    entry.streak.longest = Math.max(entry.streak.longest, 1);
                  }
                }
              }

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
              isStatsDirty = true; // Đánh dấu dữ liệu đã thay đổi để flush định kỳ 15s

              return stats[threadID];
            } catch (e) {
              console.error("❌ Lỗi cập nhật thống kê tin nhắn trên RAM:", e);
              return null;
            }
          };

          // --- LISTENER CHÍNH ---
          api.listenMqtt(async (err, event) => {
            if (err) {
              const errStrFull = JSON.stringify(err || {}).toLowerCase() + " " + String(err.message || err.error || err).toLowerCase();
              const isRealCheckpoint = errStrFull.includes('not logged in') || 
                                       errStrFull.includes('account blocked') || 
                                       errStrFull.includes('checkpoint') || 
                                       errStrFull.includes('13570') || 
                                       errStrFull.includes('đóng và mở lại cửa sổ trình duyệt') ||
                                       errStrFull.includes('connection refused') ||
                                       errStrFull.includes('connack') ||
                                       errStrFull.includes('"code":21') ||
                                       errStrFull.includes('code: 21') ||
                                       (err && (err.code === 21 || err.code === "21")) ||
                                       errStrFull.includes('eauth') ||
                                       errStrFull.includes('invalid session') ||
                                       errStrFull.includes('session expired') ||
                                       errStrFull.includes('ctx') ||
                                       errStrFull.includes('please login') ||
                                       errStrFull.includes('client disconnecting');

              const errMessage = String(err.error || err.message || err);

              if (isRealCheckpoint) {
                console.error(`❌ Listen Error (Cookie hết hạn / Checkpoint / Logout / Mqtt Drop) cho Profile "${cred.profileName}":`, errMessage);

                // Xóa appstate hỏng của Profile này
                const brokenProfilePath = path.join(__dirname, 'runtime', 'appstates', `appstate_${cred.profileName}.json`);
                try {
                  if (fs.existsSync(brokenProfilePath)) fs.unlinkSync(brokenProfilePath);
                  if (fs.existsSync(APPSTATE_PATH)) fs.unlinkSync(APPSTATE_PATH);
                  if (fs.existsSync(LEGACY_APPSTATE_PATH)) fs.unlinkSync(LEGACY_APPSTATE_PATH);
                  console.log(`[🗑️] Đã xóa appstate hỏng của Profile "${cred.profileName}" để tự động lấy lại cookie.`);
                } catch (e) {}

                console.warn(`[🚨 CẢNH BÁO] Profile "${cred.profileName}" bị mất kết nối/die cookie. Tự động khởi chạy Trình duyệt lấy lại cookie mới...`);
                const success = runAutoExtractor(cred.profileName);
                if (!success) {
                  (async () => {
                    const rotated = await handleProfileCheckpointAndRotate(cred.profileName);
                    if (!rotated) {
                      requestWorkerRestart(`tự động lấy lại cookie mới cho ${cred.profileName}`);
                    }
                  })();
                  return;
                }
                requestWorkerRestart(`tự động lấy lại cookie mới cho ${cred.profileName}`);
                return;
              }

              // Gián đoạn MQTT tạm thời (Server unavailable / Connection lost / stop_listen) -> Khởi động lại riêng luồng này
              console.warn(`[⚠️] Kết nối MQTT của Profile "${cred.profileName}" bị gián đoạn tạm thời (${errMessage}). Khởi động lại riêng luồng này...`);
              requestWorkerRestart(`kết nối lại MQTT cho ${cred.profileName}`);
              return;
            }



            if (event && event.threadID) {
              // console.log(`[DEBUG-EVENT] Profile: ${cred.profileName} | Type: ${event.type} | ThreadID: ${event.threadID} | Body: ${event.body}`);
              accountProfilesManager.loadConfig();
              const clusters = accountProfilesManager.config ? accountProfilesManager.config.clusters : [];
              let myClusterId = 1;
              for (const c of clusters) {
                if (c.profiles && c.profiles.includes(cred.profileName)) {
                  myClusterId = c.cluster_id;
                  break;
                }
              }

              if (!global.cluster_apis) global.cluster_apis = new Map();
              global.cluster_apis.set(myClusterId, api);
              global.api_instance = api;

              try {
                let assignedClusterId = null;
                if (String(event.threadID) === '1523319575522034' || String(event.threadID) === '844251878447942') {
                  assignedClusterId = myClusterId; // Đặc cách 2 box test: Mọi Cụm đều được quyền xử lý và không bị tính giới hạn
                } else {
                  const row = await execute(`SELECT cluster_id FROM group_profile_bindings WHERE thread_id = ?`, [String(event.threadID)]);
                  
                  let isBotBeingAdded = false;
                  if (event.type === "log:subscribe" && event.logMessageData && event.logMessageData.addedParticipants) {
                      isBotBeingAdded = event.logMessageData.addedParticipants.some(i => String(i.userFbId) === String(api.getCurrentUserID()));
                  }

                  if (isBotBeingAdded) {
                      // Nếu chính bot này vừa được thêm vào, nó sẽ CƯỚP lại nhóm từ Cụm cũ (trường hợp Cụm cũ bị ban/kick offline)
                      assignedClusterId = myClusterId;
                      // Cố tình gán row rỗng để nó chạy vào nhánh tạo 1 tiếng dùng thử bên dưới
                      row.length = 0; 
                      await execute(`DELETE FROM group_profile_bindings WHERE thread_id = ?`, [String(event.threadID)]).catch(() => {});
                  } else if (row && row.length > 0) {
                    assignedClusterId = row[0].cluster_id;
                  } else {
                    const isGroupEvent = event.isGroup === true || (event.threadID && event.senderID && String(event.threadID) !== String(event.senderID));
                    if (isGroupEvent) {
                      // Nhóm mới chưa phân bổ -> BẮT BUỘC phải gán cho myClusterId
                      // (Vì mỗi Cụm dùng 1 nick Facebook khác nhau, nick nào được add vào nhóm thì nick đó phải làm)
                      const bestCluster = myClusterId;

                      // Luôn phân bổ tạm thời cho bestCluster để bot hoạt động trải nghiệm trong 1 tiếng
                      const profilesJson = JSON.stringify(clusters.find(c => c.cluster_id === bestCluster)?.profiles || []);
                      await execute(`INSERT OR IGNORE INTO group_profile_bindings (thread_id, cluster_id, is_admin_rental, assigned_profiles) VALUES (?, ?, 0, ?)`, [String(event.threadID), bestCluster, profilesJson]);

                      // Đọc lại từ DB để đảm bảo lấy đúng cluster_id do bot nào chèn vào trước (nếu 2 luồng cùng xử lý)
                      const freshRow = await execute(`SELECT cluster_id FROM group_profile_bindings WHERE thread_id = ?`, [String(event.threadID)]);
                      assignedClusterId = freshRow && freshRow.length > 0 ? freshRow[0].cluster_id : bestCluster;

                      console.log(`[+] Nhóm mới ${event.threadID} tạm giao cho Cụm ${assignedClusterId} (1 tiếng trải nghiệm)`);

                      // Đã bỏ cơ chế tự out sau 1 tiếng theo yêu cầu của user.
                      // Nhóm sẽ vĩnh viễn nằm trong Sổ đỏ với is_admin_rental = 0 cho đến khi khách thuê bot hoặc admin tự kích.
                    } else {
                      assignedClusterId = myClusterId; // Inbox riêng tư (1-1 / E2EE): Nick nào nhận được tin nhắn trực tiếp thì nick đó tự xử lý
                    }
                  }
                } // Close the 'else' block for test boxes
                if (assignedClusterId !== myClusterId) {
                  // Nhóm này thuộc về Cụm khác -> Bỏ qua event để tránh trùng lặp tin nhắn (ĐÃ BỎ CƠ CHẾ TỰ OUT)
                  return; // Bỏ qua hoàn toàn event
                }
              } catch (bindErr) {
                console.error("Lỗi khi kiểm tra phân bổ cụm:", bindErr);
                return; // Nếu có lỗi DB (như lock), bỏ qua event để tránh 2 bot cùng trả lời
              }

              if (event.logMessageType || event.type === "change_thread_image") {
                const lmt = event.logMessageType || event.type;
                const lmd = event.logMessageData || {};
                const tid = event.threadID;

                if (lmt === "log:thread-admins" && lmd) {
                  const targetID = lmd.TARGET_ID || lmd.target_id || lmd.targetId || lmd.participant_id;
                  const adminEvent = lmd.ADMIN_EVENT || lmd.admin_event;
                  if (targetID && adminEvent) {
                    syncThreadAdminRealtime(tid, targetID, adminEvent).catch(() => {});
                  }
                } else if (lmt === "log:thread-name" && lmd?.name) {
                  syncThreadNameRealtime(tid, lmd.name).catch(() => {});
                } else if (lmt === "log:user-nickname" && lmd?.participant_id) {
                  syncThreadNicknameRealtime(tid, lmd.participant_id, lmd.nickname !== undefined ? lmd.nickname : "").catch(() => {});
                } else if (lmt === "log:subscribe" && lmd?.addedParticipants) {
                  syncThreadParticipantRealtime(tid, lmd.addedParticipants, "add").catch(() => {});
                } else if (lmt === "log:unsubscribe" && lmd?.leftParticipantFbId) {
                  syncThreadParticipantRealtime(tid, lmd.leftParticipantFbId, "remove").catch(() => {});
                } else if (lmt === "change_thread_image" || lmt === "log:thread-image") {
                  const imgUrl = event.image?.url || lmd?.url || "";
                  if (imgUrl) syncThreadImageRealtime(tid, imgUrl).catch(() => {});
                } else if (lmt === "log:thread-color" || lmt === "log:thread-icon") {
                  syncThreadThemeRealtime(tid, { emoji: lmd.theme_emoji || lmd.thread_icon, color: lmd.theme_color }).catch(() => {});
                }
              }
            }

            const shouldAllowEvent = async (ev, threadID) => {
              if (!threadID) return true;

              const adminList = Array.isArray(config?.adminIDs) ? config.adminIDs : (Array.isArray(global.config?.adminIDs) ? global.config.adminIDs : []);
              const isAdmin = adminList.includes(event.senderID) || String(event.senderID) === String(botID);
              if (isAdmin) return true;

              if (ev.name === "greetingSticker") return true;

              if (
                ev.name === "welcome" &&
                event.logMessageType === "log:subscribe" &&
                Array.isArray(event.logMessageData?.addedParticipants) &&
                event.logMessageData.addedParticipants.some(i => String(i.userFbId) === String(botID))
              ) {
                return true;
              }

              try {
                const { checkRentalStatus } = require("./modules/utils/rental");
                return await checkRentalStatus(threadID);
              } catch (err) {
                console.error("Lỗi kiểm tra trạng thái thuê bot cho event:", err);
                return true;
              }
            };

            // 1. Xử lý Event hệ thống (Log message)
            if (event.logMessageType) {
              global.events.forEach(async (ev) => {
                if (ev.eventType && ev.eventType.includes(event.logMessageType)) {
                  try {
                    if (await shouldAllowEvent(ev, event.threadID)) {
                      await ev.execute({ api, event, config });
                    }
                  } catch (e) {
                    console.error(`❌ Lỗi thực thi event ${ev.name}:`, e.message);
                  }
                }
              });
            }

            // 1b. Xử lý Event theo event.type
            if (event.type) {
              global.events.forEach(async (ev) => {
                if (ev.eventType && ev.eventType.includes(event.type)) {
                  try {
                    if (await shouldAllowEvent(ev, event.threadID)) {
                      await ev.execute({ api, event, config });
                    }
                  } catch (e) {
                    console.error(`❌ Lỗi thực thi event ${ev.name}:`, e.message);
                  }
                }
              });
            }

            // 1c. Dispatch handleEvent cho tất cả các command (anti, antiSpamBot, resend...)
            if (global.commands && global.commands.size > 0) {
              const uniqueEventCommands = new Set(global.commands.values());
              uniqueEventCommands.forEach(async (cmd) => {
                if (cmd && typeof cmd.handleEvent === "function") {
                  try {
                    await cmd.handleEvent({ api, event, config });
                  } catch (e) { }
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
              const { checkRentalStatus } = require("./modules/utils/rental");
              const isRented = await checkRentalStatus(event.threadID);
              updateMessageStats(event.senderID, event.threadID, event, isRented);

              // 2c. Cộng EXP Chat (nếu là nhóm, đã thuê bot và tin nhắn hợp lệ)
              try {
                if (isRented) {
                  const threadInfo = await getThreadInfoCached(api, event.threadID);
                  if (threadInfo && threadInfo.isGroup) {
                    const { isLevelEnabled } = require("./modules/utils/levelSettings");
                    const levelEnabled = await isLevelEnabled(event.threadID);
                    if (levelEnabled) {
                      const LevelSystem = require("./modules/utils/LevelSystem");
                      // Chỉ cộng EXP cho các sự kiện là tin nhắn hoặc reply (không phải unsend/logs)
                      if (event.type === "message" || event.type === "message_reply") {
                        const bodyStr = (event.body || "").trim();
                        const { getCustomPrefix } = require("./modules/utils/customPrefix");
                        const customPrefix = await getCustomPrefix(event.threadID);
                        const prefix = customPrefix || config.prefix || "!";

                        let textToParse = bodyStr;
                        if (!textToParse && event.attachments && event.attachments.length > 0) {
                          const firstAttach = event.attachments[0];
                          const type = firstAttach.type || "";
                          const id = firstAttach.ID || firstAttach.stickerID || firstAttach.attachmentID || (firstAttach.fileMap && firstAttach.fileMap.attachmentID) || "media";
                          textToParse = `[attachment_${type}_${id}]`;
                        }

                        // Loại trừ các tin nhắn bắt đầu bằng prefix (lệnh của bot)
                        if (!bodyStr.startsWith(prefix) && !bodyStr.startsWith("!") && !bodyStr.startsWith("/")) {
                          const userMap = new Map((threadInfo.userInfo || []).map((u) => [String(u.id), u.name]));
                          let userName = userMap.get(event.senderID);
                          if (!userName || userName === "Người dùng" || userName.startsWith("User ")) {
                            userName = global.data?.userName?.get(event.senderID);
                          }
                          if (!userName || userName === "Người dùng" || userName.startsWith("User ")) {
                            try {
                              const dbRows = await execute("SELECT name FROM messenger_users WHERE thread_id = ? AND psid = ?", [String(event.threadID), String(event.senderID)]);
                              if (dbRows && dbRows[0] && dbRows[0].name && dbRows[0].name !== "Người dùng") {
                                userName = dbRows[0].name;
                              }
                            } catch (e) {}
                          }
                          if (!userName || userName === "Người dùng" || userName.startsWith("User ")) {
                            try {
                              const userObj = await new Promise((resolve) => {
                                api.getUserInfo(event.senderID, (err, ret) => {
                                  if (err || !ret) return resolve(null);
                                  resolve(ret[event.senderID]);
                                });
                              });
                              if (userObj?.name) {
                                userName = userObj.name;
                                if (global.data?.userName) global.data.userName.set(event.senderID, userName);
                                execute("UPDATE messenger_users SET name = ? WHERE thread_id = ? AND psid = ?", [userName, String(event.threadID), String(event.senderID)]).catch(() => {});
                              }
                            } catch (e) {}
                          }
                          userName = userName || "Người dùng";
                          const res = await LevelSystem.addChatExp(event.senderID, textToParse, event.threadID, userName);
                          if (res && res.didLevelUp) {
                            const { isLevelNotiEnabled } = require("./modules/utils/levelSettings");
                            if (await isLevelNotiEnabled(event.threadID)) {
                              const formatNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
                              const reqExpForNext = LevelSystem.getRequiredExp(res.newLevel);
                              const oldTitle = LevelSystem.getTitle(res.oldLevel);
                              const newTitle = LevelSystem.getTitle(res.newLevel);

                              const nextLevel = res.newLevel + 1;
                              let levelUpMsg =
                                `=== ✨ LÊN CẤP ✨ ===\n` +
                                `🎉 Chúc mừng ${userName}!\n` +
                                `⭐ Đạt cấp ${res.newLevel}!!!\n` +
                                `🏷️ Danh hiệu: ${newTitle.icon} ${newTitle.title}\n` +
                                `📈 Cấp ${nextLevel} cần: ` +
                                `${formatNum(res.currentExp)} / ${formatNum(reqExpForNext)} EXP\n`;

                              if (oldTitle.title !== newTitle.title) {
                                levelUpMsg +=
                                  `🎊 Bạn đã mở khóa danh hiệu mới: ` +
                                  `${newTitle.icon} ${newTitle.title}\n`;
                              }
                              levelUpMsg += `===================`;

                              const sendCb = (err, info) => {
                                if (!err && info && info.messageID) {
                                  setTimeout(() => {
                                    api.unsendMessage(info.messageID);
                                  }, 30000);
                                }
                              };

                              if (typeof api.sendMessageEffect === "function") {
                                api.sendMessageEffect(
                                  { body: levelUpMsg, effect: "FIRE" },
                                  event.threadID,
                                  sendCb
                                );
                              } else {
                                api.sendMessage(levelUpMsg, event.threadID, sendCb);
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              } catch (err) {
                console.error("❌ Lỗi LevelSystem.addChatExp:", err.message);
              }



              // 2b. ANTITHUHOI: Đã được module hóa và xử lý bất đồng bộ qua modules/events/antithuhoi.js (0ms, 0 Network API Call trên hot path)
            }

            if (!event.body) return;

            const body = String(event.body || "").trim();
            const senderID = String(event.senderID || "");
            const threadID = String(event.threadID || "");
            const { getCustomPrefix } = require("./modules/utils/customPrefix");
            const customPrefix = await getCustomPrefix(threadID);
            const prefix = customPrefix || config.prefix || "!";

            if (body) {
              console.log(
                `📩 [MSG] type=${event.type || "unknown"} tid=${threadID} sid=${senderID} body=${body.slice(0, 120)} tags=${JSON.stringify(event.tags || [])}`,
              );
            }

            const isBotSender = senderID === String(botID);
            const isInbox = (threadID && senderID && threadID === senderID) || event.isGroup === false;
            const normalizedBody = normalizeText(body);

            const { checkRentalStatus, getRentalExpiry, isRentalStopped } = require("./modules/utils/rental");
            const adminList = Array.isArray(config?.adminIDs) ? config.adminIDs : (Array.isArray(global.config?.adminIDs) ? global.config.adminIDs : []);
            const isAdmin = adminList.includes(event.senderID) || String(event.senderID) === String(botID);

            const sendRentalNotice = async () => {
              try {
                if (await isRentalStopped(event.threadID)) {
                  return api.sendMessage(
                    "⏸️ Nhóm này đang bị TẠM DỪNG TÍNH NGÀY (Bot tạm thời bị vô hiệu hóa).\n" +
                    `Vui lòng dùng ${prefix}thuebot để xem thời gian bảo lưu hoặc liên hệ admin bot!`,
                    event.threadID,
                    event.messageID,
                  );
                }
              } catch (e) { }
              return api.sendMessage(
                "⚠️ Nhóm này chưa thuê bot hoặc đã hết hạn thuê.\n" +
                `Vui lòng dùng ${prefix}adminbot để liên hệ admin\nHoặc dùng lệnh ${prefix}thuebot để tự động gia hạn!`,
                event.threadID,
                event.messageID,
              );
            };

            const sendHelpHint = () =>
              api.sendMessage(
                `Bố mày đây, gõ ${prefix}help mà xem danh sách lệnh`,
                event.threadID,
                event.messageID,
              );

            const sendPrefix = () =>
              api.sendMessage(
                `Prefix của bot là: ${prefix}` +
                `\nDùng lệnh ${prefix}setprefix <prefix> để đổi prefix cho nhóm`,
                event.threadID,
                event.messageID,
              );

            if (normalizedBody === "bot dau") {
              if (!isAdmin && !isInbox) {
                const isRented = await checkRentalStatus(event.threadID);
                if (!isRented) return sendRentalNotice();
              }
              return sendHelpHint();
            }

            if (normalizedBody === "prefix") {
              if (!isAdmin && !isInbox) {
                const isRented = await checkRentalStatus(event.threadID);
                if (!isRented) return sendRentalNotice();
              }
              return sendPrefix();
            }

            // Lệnh không cần check quyền (tự trong lệnh xử lý)
            const FREE_COMMANDS = ["mode"];

            // =================================================================
            // XỬ LÝ LỆNH CÓ PREFIX (VD: !ve, !taixiu, !reset)
            // =================================================================
            if (event.body.startsWith(prefix)) {
              if (global.spamBotCooldown && global.spamBotCooldown.has(String(event.senderID))) {
                const unblockAt = global.spamBotCooldown.get(String(event.senderID));
                if (Date.now() < unblockAt) {
                  return; // Block execution while user is in anti-spam cooldown
                } else {
                  global.spamBotCooldown.delete(String(event.senderID));
                }
              }

              event = await ensureMentions(api, event);

              const commandText = event.body.slice(prefix.length).trim();
              const rawArgs = commandText ? commandText.split(/ +/) : [];
              const firstWord = rawArgs.length > 0 ? rawArgs[0].toLowerCase() : "";

              // =================================================================
              // 🛡️ KIỂM TRA HẠN THUÊ BOT (RENTAL CHECK)
              // =================================================================
              const isFreeCommand = ["thuebot", "adminbot", "gopy", "dangky", "matkhau", "register", "password", "webpass"].includes(firstWord);

              if (!isAdmin && !isFreeCommand && !isInbox) {
                const isRented = await checkRentalStatus(event.threadID);

                if (!isRented) {
                  return sendRentalNotice();
                }

                // Cảnh báo hạn thuê bot còn <= 3 ngày (Chỉ cảnh báo 1 lần mỗi 12 tiếng)
                try {
                  const expireDate = await getRentalExpiry(event.threadID);
                  if (expireDate) {
                    const diffMs = expireDate - Date.now();
                    const diffDays = diffMs / (1000 * 60 * 60 * 24);
                    if (diffDays > 0 && diffDays <= 3) {
                      if (!global.lastExpiryWarned) global.lastExpiryWarned = new Map();
                      const lastWarned = global.lastExpiryWarned.get(event.threadID) || 0;
                      if (Date.now() - lastWarned > 12 * 60 * 60 * 1000) {
                        global.lastExpiryWarned.set(event.threadID, Date.now());
                        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                        let timeText = `${Math.floor(diffDays)} ngày`;
                        if (diffHours > 0) timeText += ` ${diffHours} giờ`;
                        if (diffMinutes > 0) timeText += ` ${diffMinutes} phút`;

                        api.sendMessage(
                          `⚠️ [CẢNH BÁO HẠN DÙNG BOT]\n` +
                          `Nhóm của bạn chỉ còn ${timeText} hạn sử dụng bot.\n` +
                          `👉 Vui lòng gõ \`${prefix}thuebot giahan\` để tự gia hạn tự động và không bị ngắt quãng!`,
                          event.threadID
                        );
                      }
                    }
                  }
                } catch (err) {
                  console.error("Lỗi kiểm tra hạn thuê bot còn 3 ngày:", err);
                }
              }

              if (!commandText || commandText.toLowerCase() === "bot") {
                return sendHelpHint();
              }

              const args = [...rawArgs];
              const commandName = args.shift().toLowerCase();
              const command = resolveCommand(commandName);

              if (!command) {
                return api.sendMessage(
                  `❌ Lệnh không tồn tại: ${commandName}\n💡 Dùng ${prefix}help để xem danh sách lệnh.`,
                  event.threadID,
                  event.messageID,
                );
              }

              if (command) {
                try {
                  console.log(`🚀 [CMD] ${commandName} | UID: ${event.senderID}`);

                  const permCheck = await checkPermission(
                    event.threadID,
                    event.senderID,
                    api,
                    commandName,
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
                    await command.execute({ api, event, args, config: { ...config, prefix } });
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
              // Bỏ qua nếu tin nhắn được reply là của bot khác trong cùng box test
              if (event.messageReply?.senderID && String(event.messageReply.senderID) !== String(botID)) {
                return;
              }

              console.log("DBG message_reply event:", JSON.stringify({
                type: event.type,
                senderID: event.senderID,
                threadID: event.threadID,
                messageID: event.messageID,
                messageReply: event.messageReply ? {
                  messageID: event.messageReply.messageID,
                  senderID: event.messageReply.senderID,
                  body: event.messageReply.body
                } : null
              }, null, 2));
              const { checkRentalStatus } = require("./modules/utils/rental");
              const isRented = await checkRentalStatus(event.threadID);
              const adminList = Array.isArray(config?.adminIDs) ? config.adminIDs : (Array.isArray(global.config?.adminIDs) ? global.config.adminIDs : []);
              const isAdmin = adminList.includes(event.senderID) || String(event.senderID) === String(botID);
              const repliedText = String(event.messageReply?.body || "");
              const isThuebotMenuReply = repliedText.includes("BẢNG GIÁ THUÊ BOT") || repliedText.includes("DANH SÁCH NHÓM THUÊ BOT") || repliedText.includes("DANH SÁCH NHÓM") || repliedText.includes("LỊCH SỬ ĐƠN HÀNG");

              const permCheck = await checkPermission(event.threadID, event.senderID, api);

              if (global.commands && global.commands.size > 0) {
                const uniqueReplyCommands = new Set(global.commands.values());
                uniqueReplyCommands.forEach(async (cmd) => {
                  if (cmd && typeof cmd.handleReply === "function") {
                    let handleReplyObj = null;
                    if (global.client && Array.isArray(global.client.handleReply)) {
                      const index = global.client.handleReply.findIndex(
                        (item) => String(item.messageID) === String(event.messageReply?.messageID) && item.name === cmd.name
                      );
                      if (index !== -1) {
                        handleReplyObj = global.client.handleReply[index];
                      }
                    }

                    try {
                      if (!isRented && !isAdmin && !(isThuebotMenuReply && cmd.name === "thuebot") && cmd.name !== "help") {
                        return;
                      }
                      await cmd.handleReply({ api, event, config: { ...config, prefix }, handleReply: handleReplyObj });
                    } catch (e) {
                      console.error(`❌ Lỗi handleReply [${cmd.name}]:`, e);
                    }
                  }
                });
              }
            }

            // =================================================================
            // XỬ LÝ REACTION (Khai trừ thành viên spam, xỏ nút,...)
            // =================================================================
            if (event.type === "message_reaction" || event.type === "reaction") {
              if (global.client && Array.isArray(global.client.handleReaction)) {
                const index = global.client.handleReaction.findIndex(
                  (item) => String(item.messageID) === String(event.messageID)
                );
                if (index !== -1) {
                  const handleReactionObj = global.client.handleReaction[index];
                  const cmd = global.commands.get(handleReactionObj.name);
                  if (cmd && typeof cmd.handleReaction === "function") {
                    try {
                      await cmd.handleReaction({ api, event, config: { ...config, prefix }, handleReaction: handleReactionObj });
                    } catch (e) {
                      console.error(`❌ Lỗi handleReaction [${handleReactionObj.name}]:`, e);
                    }
                  }
                }
              }
            }

          });
        });
    }, idx * 2500);
  }
};

attemptLogin();
