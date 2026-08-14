process.env.TZ = "Asia/Ho_Chi_Minh";
process.on('unhandledRejection', (reason, promise) => {
  console.error('[⚠️] Unhandled Promise Rejection caught:', reason?.message || reason);
});
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const login = require("./includes/f");
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

    const checkPath = fs.existsSync(APPSTATE_PATH) ? APPSTATE_PATH : LEGACY_APPSTATE_PATH;
    if (fs.existsSync(checkPath)) {
      const content = fs.readFileSync(checkPath, "utf8").trim();
      if (content && content !== "[]" && content !== "{}") {
        JSON.parse(content);
        return true;
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

  // 🚀 KHỞI ĐỘNG CÁC WORKER (CÁC CỤM)
  const activeProfiles = accountProfilesManager.getActiveProfilesToRun();
  accountProfilesManager.loadConfig();
  const clusters = accountProfilesManager.config.clusters || [];

  function spawnWorkerForCluster(clusterId, profileName) {
    console.log(`[MASTER] Đang khởi tạo luồng con cho Cụm ${clusterId} (Profile: ${profileName})...`);
    const worker = new Worker(__filename, { workerData: { clusterId, profileName } });

    activeWorkers[clusterId] = worker;

    worker.on('message', (msg) => {
      if (msg.type === "log") console.log(`[WORKER CỤM ${clusterId}] ${msg.text}`);
    });

    worker.on('exit', (code) => {
      console.log(`[MASTER] ⚠️ Worker Cụm ${clusterId} đã thoát (code ${code}). Tự động khởi động lại sau 5s...`);
      delete activeWorkers[clusterId];
      setTimeout(() => {
        // Lấy lại cấu hình phòng trường hợp Master đã cập nhật lại active_profile qua tính năng Xoay vòng (nếu có, tuy nhiên worker sẽ tự xử lý xoay vòng)
        accountProfilesManager.loadConfig();
        const currentConfig = accountProfilesManager.config.clusters.find(c => c.cluster_id === clusterId);
        if (currentConfig) spawnWorkerForCluster(clusterId, currentConfig.active_profile);
      }, 5000);
    });
  }

  // 🚀 BỘ ĐẾM GIỜ LUÂN PHIÊN CA LÀM VIỆC
  const clusterTimers = {};
  
  function scheduleClusterRotation(clusterId) {
    // Sinh số ngẫu nhiên từ 3,600,000 ms (1h) đến 10,800,000 ms (3h)
    const MIN_MS = 3600000;
    const MAX_MS = 10800000;
    const delay = Math.floor(Math.random() * (MAX_MS - MIN_MS + 1)) + MIN_MS;
    
    const h = Math.floor(delay / 3600000);
    const m = Math.floor((delay % 3600000) / 60000);
    const s = Math.floor((delay % 60000) / 1000);
    console.log(`[MASTER] ⏳ Cụm ${clusterId} sẽ đổi ca làm việc sau: ${h}h ${m}m ${s}s`);

    clusterTimers[clusterId] = setTimeout(() => {
       console.log(`[MASTER] ⏰ Đã đến giờ xoay ca làm việc cho Cụm ${clusterId}!`);
       const newProfile = accountProfilesManager.rotateClusterProfile(clusterId);
       if (newProfile) {
         if (activeWorkers[clusterId]) {
           console.log(`[MASTER] Đang tắt luồng Cụm ${clusterId} để nhường phiên cho ${newProfile}...`);
           activeWorkers[clusterId].terminate(); 
           // Sự kiện 'exit' của worker sẽ tự động khởi động lại luồng với profile mới sau 5s
         }
       }
       // Tiếp tục hẹn giờ cho lần đổi ca tiếp theo
       scheduleClusterRotation(clusterId);
    }, delay);
  }

  const spawnedProfiles = new Set();
  for (const c of clusters) {
    if (activeProfiles.includes(c.active_profile)) {
      if (!spawnedProfiles.has(c.active_profile)) {
        spawnedProfiles.add(c.active_profile);
        spawnWorkerForCluster(c.cluster_id, c.active_profile);
        scheduleClusterRotation(c.cluster_id);
      } else {
        console.warn(`[MASTER] ⚠️ Bỏ qua Cụm ${c.cluster_id}: Profile "${c.active_profile}" đã được chạy bởi một Cụm khác để tránh xung đột session!`);
      }
    }
  }



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
    runAutoExtractor(targetProfile);
    scheduleLoginRetry(`đang chờ cập nhật appstate mới từ trình duyệt cho ${targetProfile}`, 10000);
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
      login(
        { appState: cred.appState },
        fcaOptions,
        async (err, api) => {
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
                console.log(`[🗑️] Đã xóa appstate hỏng của Profile "${cred.profileName}" để chờ lấy mới.`);
              } catch (e) { }
            }

            accountProfilesManager.loadConfig();
            let myClusterId = 1;
            for (const c of accountProfilesManager.config.clusters || []) {
              if (c.profiles && c.profiles.includes(cred.profileName)) {
                myClusterId = c.cluster_id;
                break;
              }
            }

            console.warn(`[🚨 CẢNH BÁO] Profile "${cred.profileName}" (Cụm ${myClusterId}) bị dính đăng xuất/checkpoint. Tiến hành xoay vòng sang acc dự phòng Cụm ${myClusterId}...`);
            await accountProfilesManager.switchProfileOnCheckpoint(cred.profileName, myClusterId);
            scheduleLoginRetry(`chuyển sang acc dự phòng Cụm ${myClusterId}`, 5000);
            return;
          }

          if (typeof api.setOptions === "function") {
            api.setOptions(fcaOptions);
          }

          const botID = api.getCurrentUserID();
          console.log(`✅ [Profile ${cred.profileName}] Đăng nhập thành công ID: ${botID}`);

          if (!global.api_instance) global.api_instance = api;
          if (!global.botID) global.botID = botID;

          // Đồng bộ phân bổ rải nhóm thuê adminbot & tự đếm/rời nhóm thừa (Slot Tracker)
          try {
            await accountProfilesManager.registerActiveAccount(cred.profileName, botID);
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
                  accountProfilesManager.loadConfig();
                  let myClusterId = 1;
                  for (const c of accountProfilesManager.config.clusters || []) {
                    if (c.profiles && c.profiles.includes(cred.profileName)) {
                      myClusterId = c.cluster_id;
                      break;
                    }
                  }
                  await accountProfilesManager.switchProfileOnCheckpoint(cred.profileName, myClusterId);
                  console.log(`[🔄] Đã tự động xoay vòng active_profile Cụm ${myClusterId} sang nick dự phòng do bị Facebook Block Action.`);
                } catch (e) {
                  console.error("❌ Lỗi khi xoay profile do block action:", e);
                } finally {
                  setTimeout(() => {
                    process.exit(0);
                  }, 1000);
                }
              })();

              return true;
            }
            return false;
          };

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

              if (typeof callback === "function") {
                const wrappedCallback = (err, messageInfo) => {
                  if (err && handleAccountBlocked(err)) return;
                  callback(err, messageInfo);
                };
                try {
                  return originalSendMessage.call(api, msg, threadID, wrappedCallback, replyToMessage);
                } catch (e) {
                  if (handleAccountBlocked(e)) return;
                  throw e;
                }
              } else {
                return new Promise((resolve, reject) => {
                  const wrappedCallback = (err, messageInfo) => {
                    if (err && handleAccountBlocked(err)) return reject(err);
                    if (err) return reject(err);
                    resolve(messageInfo || {});
                  };
                  try {
                    originalSendMessage.call(api, msg, threadID, wrappedCallback, replyToMessage);
                  } catch (e) {
                    if (handleAccountBlocked(e)) return reject(e);
                    reject(e);
                  }
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

              if (typeof callback === "function") {
                const wrappedCallback = (err, messageInfo) => {
                  if (err && handleAccountBlocked(err)) return;
                  callback(err, messageInfo);
                };
                try {
                  return originalSendMessageEffect.call(api, msg, threadID, wrappedCallback, replyToMessage);
                } catch (e) {
                  if (handleAccountBlocked(e)) return;
                  throw e;
                }
              } else {
                return new Promise((resolve, reject) => {
                  const wrappedCallback = (err, messageInfo) => {
                    if (err && handleAccountBlocked(err)) return reject(err);
                    if (err) return reject(err);
                    resolve(messageInfo || {});
                  };
                  try {
                    originalSendMessageEffect.call(api, msg, threadID, wrappedCallback, replyToMessage);
                  } catch (e) {
                    if (handleAccountBlocked(e)) return reject(e);
                    reject(e);
                  }
                });
              }
            };
          }

          // Tự động thêm UID đăng nhập vào adminIDs trong config.json nếu chưa có
          try {
            const configPath = path.join(__dirname, "config.json");
            if (fs.existsSync(configPath)) {
              const configContent = fs.readFileSync(configPath, "utf8");
              const configJson = JSON.parse(configContent);
              if (!configJson.adminIDs) {
                configJson.adminIDs = [];
              }
              if (!configJson.adminIDs.includes(botID)) {
                configJson.adminIDs.push(botID);
                fs.writeFileSync(configPath, JSON.stringify(configJson, null, 2), "utf8");
                console.log(`✏️ Đã tự động thêm ID bot ${botID} vào adminIDs trong config.json`);
                // Cập nhật lại config object trong memory
                config.adminIDs = configJson.adminIDs;
              }
            }
          } catch (err) {
            console.error("❌ Lỗi tự động cập nhật adminIDs trong config.json:", err);
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

          // Hàm lấy ngày theo Việt Nam (UTC+7)
          const getDateStamp = (date) => {
            const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
            const y = vnTime.getUTCFullYear();
            const m = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
            const d = String(vnTime.getUTCDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
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
              lastStreakResetDate !== currentDate
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
            const stats = {};
            if (fs.existsSync(statsPath)) {
              try {
                Object.assign(stats, JSON.parse(fs.readFileSync(statsPath, "utf8")));
              } catch (e) {}
            }

            // Kiểm tra gửi top ngày lúc 6:00 sáng (chỉ gửi 1 lần mỗi ngày)
            if (
              (hours > 6 || (hours === 6 && minutes >= 0)) &&
              lastDailyCheckDate !== currentDate
            ) {
              console.log("dt Đang gửi TOP 10 tương tác ngày cho tất cả nhóm chưa nhận...");
              lastDailyCheckDate = currentDate; // Đánh dấu trước để tránh gọi lặp lại
              writeLastTopCheckState(currentDate, undefined, undefined);
              await sendDailyTop10ToAllGroups(api);
            }

            // Kiểm tra gửi top tháng lúc 6:00 sáng vào NGÀY MÙNG 1 ĐẦU THÁNG (chỉ gửi 1 lần mỗi tháng)
            if (
              currentDay === 1 &&
              (hours > 6 || (hours === 6 && minutes >= 0)) &&
              lastMonthlyCheckDate !== currentDate
            ) {
              console.log("dt Đang gửi TOP 10 tương tác tháng cho tất cả nhóm chưa nhận...");
              lastMonthlyCheckDate = currentDate;
              writeLastTopCheckState(undefined, currentDate, undefined);
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

          const performDailyStreakReset = async (api) => {
            try {
              const stats = {};
              if (fs.existsSync(statsPath)) {
                Object.assign(stats, JSON.parse(fs.readFileSync(statsPath, "utf8")));
              }

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

                  const userMap = new Map(
                    (threadInfo.userInfo || []).map((u) => [String(u.id), u.name]),
                  );

                  for (const uid of Object.keys(threadStats)) {
                    if (!/^\d+$/.test(uid)) continue;
                    if (!participantSet.has(uid)) continue;

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
                      }
                    }
                  }

                  state[threadID + "_lostUsers"] = lostUsers;
                } catch (err) {
                  console.error(`❌ Lỗi reset chuỗi cho nhóm ${threadID}:`, err.message);
                }
              }

              fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
              writeDailyTopState(state);
              console.log("✅ Hoàn thành quét reset chuỗi tương tác hàng ngày.");
            } catch (e) {
              console.error("❌ Lỗi quét reset chuỗi tương tác hàng ngày:", e);
            }
          };

          const sendDailyTop10ToAllGroups = async (api) => {
            try {
              const stats = {};
              if (fs.existsSync(statsPath)) {
                const data = JSON.parse(fs.readFileSync(statsPath, "utf8"));
                Object.assign(stats, data);
              }

              const yesterdayKey = getPreviousDayKey();
              const todayKey = getTimeKeys().dayKey;
              const state = readDailyTopState();

              for (const threadID of Object.keys(stats)) {
                if (state[threadID] === yesterdayKey) continue;

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
                  if (!threadInfo.isGroup) continue;

                  const userMap = new Map(
                    (threadInfo.userInfo || []).map((u) => [String(u.id), u.name]),
                  );

                  const lines = [
                    `📊 TOP 10 TƯƠNG TÁC NGÀY ${formatDayLabel(yesterdayKey)}`,
                    "━".repeat(13),
                    ...ranked.slice(0, 10).map((item, idx) => {
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

                  await new Promise((resolve, reject) => {
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

                  state[threadID] = yesterdayKey;
                  writeDailyTopState(state);
                  console.log(`✅ Đã gửi TOP 10 tương tác ngày cho nhóm ${threadID}`);

                  // Delay 2 giây giữa các nhóm để tránh bị Facebook throttle
                  await new Promise((r) => setTimeout(r, 2000));
                } catch (e) {
                  console.error(`❌ Lỗi gửi TOP 10 cho nhóm ${threadID}:`, e.message);
                  state[threadID] = yesterdayKey;
                  writeDailyTopState(state);
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

                // Skip sending monthly stats if the group's rental has expired
                try {
                  const { checkRentalStatus } = require("./modules/utils/rental");
                  const isRented = await checkRentalStatus(threadID);
                  if (!isRented) continue;
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
                  if (!threadInfo.isGroup) continue;

                  const userMap = new Map(
                    (threadInfo.userInfo || []).map((u) => [String(u.id), u.name]),
                  );

                  const lines = [
                    `📊 TOP 10 TƯƠNG TÁC THÁNG ${formatMonthLabel(previousMonthKey)}`,
                    "━".repeat(13),
                    ...ranked.slice(0, 10).map((item, idx) => {
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
                    rankedStreaks.slice(0, 10).forEach((item, idx) => {
                      const name = userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
                      lines.push(`${idx + 1}. ${name} — ${item.longest} ngày`);
                    });
                  }

                  await new Promise((resolve, reject) => {
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

                  // Reset brokenCount cho toàn bộ thành viên nhóm sau khi báo cáo tháng
                  for (const uid of Object.keys(threadStats)) {
                    if (/^\d+$/.test(uid)) {
                      if (stats[threadID][uid] && stats[threadID][uid].streak) {
                        stats[threadID][uid].streak.brokenCount = 0;
                      }
                    }
                  }

                  state[threadID] = previousMonthKey;
                  writeMonthlyTopState(state);
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
                  state[threadID] = previousMonthKey;
                  writeMonthlyTopState(state);
                }
              }

              fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
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

          const updateMessageStats = (senderID, threadID, event = null, isRented = true) => {
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
              const errMessage = String(err.error || err.message || err);
              const isRealCheckpoint = errMessage.includes('Not logged in') || errMessage.includes('Account blocked') || errMessage.includes('checkpoint') || errMessage.includes('1357004') || errMessage.includes('đóng và mở lại cửa sổ trình duyệt');

              if (isRealCheckpoint) {
                console.error(`❌ Listen Error (Checkpoint/Logout/Phiên lỗi 1357004) cho Profile "${cred.profileName}":`, errMessage);

                try {
                  if (fs.existsSync(APPSTATE_PATH)) fs.unlinkSync(APPSTATE_PATH);
                  if (fs.existsSync(LEGACY_APPSTATE_PATH)) fs.unlinkSync(LEGACY_APPSTATE_PATH);
                } catch (e) {}

                accountProfilesManager.loadConfig();
                let myClusterId = 1;
                for (const c of accountProfilesManager.config.clusters || []) {
                  if (c.profiles && c.profiles.includes(cred.profileName)) {
                    myClusterId = c.cluster_id;
                    break;
                  }
                }

                console.warn(`[🚨 CẢNH BÁO] Profile "${cred.profileName}" (Cụm ${myClusterId}) bị văng checkpoint/lỗi phiên. Tiến hành xoay vòng sang acc dự phòng Cụm ${myClusterId}...`);
                await accountProfilesManager.switchProfileOnCheckpoint(cred.profileName, myClusterId);
                scheduleLoginRetry(`chuyển sang acc dự phòng Cụm ${myClusterId}`, 5000);
                return;
              }

              // Gián đoạn MQTT tạm thời (Server unavailable / Connection lost / stop_listen) -> Thử kết nối lại mà không xoay vần acc
              console.warn(`[⚠️] Kết nối MQTT của Profile "${cred.profileName}" bị gián đoạn tạm thời (${errMessage}). Đang tự động kết nối lại sau 5 giây...`);
              scheduleLoginRetry(`kết nối lại MQTT cho ${cred.profileName}`, 5000);
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
                      assignedClusterId = 1; // Inbox riêng tư mặc định cho Cụm 1
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
                clearThreadInfoCache(event.threadID);
                if (
                  ["log:thread-admins", "log:thread-name", "log:thread-image", "log:user-nickname"].includes(event.logMessageType) ||
                  event.type === "change_thread_image"
                ) {
                  setTimeout(() => clearThreadInfoCache(event.threadID), 2000);
                  setTimeout(() => clearThreadInfoCache(event.threadID), 5000);
                  setTimeout(() => clearThreadInfoCache(event.threadID), 10000);
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
                  } catch (e) { }
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
                  } catch (e) { }
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
                          const userName = userMap.get(event.senderID) || "Người dùng";
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
                      const history = await _quietGetThreadHistory(
                        api,
                        event.threadID,
                        15,
                      );
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
            const { getCustomPrefix } = require("./modules/utils/customPrefix");
            const customPrefix = await getCustomPrefix(threadID);
            const prefix = customPrefix || config.prefix || "!";

            if (body) {
              console.log(
                `📩 [MSG] type=${event.type || "unknown"} tid=${threadID} sid=${senderID} body=${body.slice(0, 120)} tags=${JSON.stringify(event.tags || [])}`,
              );
            }

            const isBotSender = senderID === String(botID);
            const isInbox = threadID && senderID && threadID === senderID;
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
              if (!isAdmin) {
                const isRented = await checkRentalStatus(event.threadID);
                if (!isRented) return sendRentalNotice();
              }
              return sendHelpHint();
            }

            if (normalizedBody === "prefix") {
              if (!isAdmin) {
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
              const isFreeCommand = ["thuebot", "adminbot", "gopy"].includes(firstWord);

              if (!isAdmin && !isFreeCommand) {
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
              const isThuebotMenuReply = repliedText.includes("BẢNG GIÁ THUÊ BOT");

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
