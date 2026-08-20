const { saveAllNicknames } = require("./nicknameStorage");
const { execute } = require("./database");

const _threadInfoCache = new Map();
const _pendingFetches = new Map(); // In-flight request deduplication
const _rateLimitedCooldowns = new Map(); // threadID -> expiryTimestamp (Circuit Breaker)
const _sessionSyncedThreads = new Set(); // Theo dõi các nhóm đã được query FB 1 lần trong phiên chạy bot hiện tại
const THREAD_INFO_TTL = 10 * 60 * 1000; // 10 phút trên RAM
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000; // Đóng băng 15 phút khi bị Rate Limit

let isTableInitialized = false;

/**
 * Khởi tạo bảng lưu trữ ThreadInfo trong SQLite
 */
async function initThreadInfoTable() {
  if (isTableInitialized) return;
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS thread_info_cache (
        thread_id TEXT PRIMARY KEY,
        thread_name TEXT,
        is_group INTEGER DEFAULT 1,
        admin_ids TEXT,
        user_info TEXT,
        participant_ids TEXT,
        nicknames TEXT,
        extra_data TEXT,
        updated_at INTEGER
      )
    `);
    isTableInitialized = true;
  } catch (err) {
    console.error("❌ Lỗi khởi tạo bảng thread_info_cache:", err.message);
  }
}

// Gọi khởi tạo bảng khi module được nạp
initThreadInfoTable().catch(() => {});

/**
 * Lưu threadInfo vào SQLite Database (bất đồng bộ, không block)
 */
async function saveThreadInfoToDb(threadID, info) {
  if (!info || typeof info !== "object") return;
  try {
    await initThreadInfoTable();
    const threadIdStr = String(threadID);
    const threadName = info.threadName || info.name || "";
    const isGroup = info.isGroup !== false ? 1 : 0;
    
    // Rút gọn adminIds chỉ lưu { id } sạch
    const cleanAdminIds = Array.isArray(info.adminIDs)
      ? info.adminIDs.map(a => ({ id: String(a.id || a || "").trim() })).filter(a => a.id)
      : [];
    
    // Rút gọn userInfo chỉ lưu đúng { id, name }, loại bỏ 100% link CDN rác (thumbSrc, profileUrl)
    const cleanUserInfo = Array.isArray(info.userInfo)
      ? info.userInfo.map(u => ({ id: String(u.id || "").trim(), name: u.name || "Người dùng Facebook" })).filter(u => u.id)
      : [];
      
    // Rút gọn participantIds chỉ lưu mảng ID chuỗi
    const cleanParticipantIds = Array.isArray(info.participantIDs)
      ? info.participantIDs.map(id => String(id || "").trim()).filter(Boolean)
      : [];

    const adminIds = JSON.stringify(cleanAdminIds);
    const userInfo = JSON.stringify(cleanUserInfo);
    const participantIds = JSON.stringify(cleanParticipantIds);
    const nicknames = JSON.stringify(info.nicknames && typeof info.nicknames === "object" ? info.nicknames : {});
    
    const extraData = JSON.stringify({
      emoji: info.emoji || "",
      color: info.color || "",
      imageSrc: info.imageSrc || "",
      approvalMode: !!info.approvalMode
    });
    const updatedAt = Date.now();

    await execute(`
      INSERT INTO thread_info_cache (thread_id, thread_name, is_group, admin_ids, user_info, participant_ids, nicknames, extra_data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        thread_name = CASE WHEN excluded.thread_name != '' THEN excluded.thread_name ELSE thread_info_cache.thread_name END,
        is_group = excluded.is_group,
        admin_ids = CASE WHEN excluded.admin_ids != '[]' THEN excluded.admin_ids ELSE thread_info_cache.admin_ids END,
        user_info = CASE WHEN excluded.user_info != '[]' THEN excluded.user_info ELSE thread_info_cache.user_info END,
        participant_ids = CASE WHEN excluded.participant_ids != '[]' THEN excluded.participant_ids ELSE thread_info_cache.participant_ids END,
        nicknames = CASE WHEN excluded.nicknames != '{}' THEN excluded.nicknames ELSE thread_info_cache.nicknames END,
        extra_data = CASE WHEN excluded.extra_data != '{}' THEN excluded.extra_data ELSE thread_info_cache.extra_data END,
        updated_at = excluded.updated_at
    `, [threadIdStr, threadName, isGroup, adminIds, userInfo, participantIds, nicknames, extraData, updatedAt]);
  } catch (err) {
    // Không crash bot nếu lỗi ghi SQLite
  }
}

/**
 * Đọc threadInfo từ SQLite Database khi Facebook API bị lỗi
 */
async function loadThreadInfoFromDb(threadID) {
  try {
    await initThreadInfoTable();
    const threadIdStr = String(threadID);
    const rows = await execute("SELECT * FROM thread_info_cache WHERE thread_id = ?", [threadIdStr]);
    if (!rows || rows.length === 0) {
      // Nếu chưa có trong cache, thử tạo khung từ bảng messenger_users nếu có dữ liệu nhóm này
      try {
        const uRows = await execute("SELECT psid, name FROM messenger_users WHERE thread_id = ?", [threadIdStr]);
        if (uRows && uRows.length > 0) {
          const userInfo = uRows.map(u => ({ id: String(u.psid), name: u.name || "Người dùng Facebook" }));
          const participantIDs = uRows.map(u => String(u.psid));
          return {
            threadID: threadIdStr,
            threadName: "",
            name: "",
            isGroup: true,
            adminIDs: [],
            userInfo: userInfo,
            participantIDs: participantIDs,
            nicknames: {},
            emoji: "",
            color: "",
            imageSrc: "",
            approvalMode: false,
            _fromPersistentDb: true
          };
        }
      } catch (e) {}
      return null;
    }

    const row = rows[0];
    let adminIDs = [];
    let userInfo = [];
    let participantIDs = [];
    let nicknames = {};
    let extra = {};

    try { adminIDs = JSON.parse(row.admin_ids || "[]"); } catch (e) {}
    try { userInfo = JSON.parse(row.user_info || "[]"); } catch (e) {}
    try { participantIDs = JSON.parse(row.participant_ids || "[]"); } catch (e) {}
    try { nicknames = JSON.parse(row.nicknames || "{}"); } catch (e) {}
    try { extra = JSON.parse(row.extra_data || "{}"); } catch (e) {}

    // Bổ sung tự động danh sách thành viên & tên từ bảng messenger_users nếu userInfo bị thiếu
    if (userInfo.length === 0 || participantIDs.length === 0) {
      try {
        const uRows = await execute("SELECT psid, name FROM messenger_users WHERE thread_id = ?", [threadIdStr]);
        if (uRows && uRows.length > 0) {
          const uMap = new Map(userInfo.map(u => [String(u.id), u]));
          for (const u of uRows) {
            const pId = String(u.psid);
            if (!participantIDs.includes(pId)) participantIDs.push(pId);
            if (!uMap.has(pId) && u.name) {
              userInfo.push({ id: pId, name: u.name });
            }
            if (global.data && global.data.userName && u.name) {
              global.data.userName.set(pId, u.name);
            }
          }
        }
      } catch (e) {}
    }

    return {
      threadID: threadIdStr,
      threadName: row.thread_name || "",
      name: row.thread_name || "",
      isGroup: row.is_group === 1,
      adminIDs: Array.isArray(adminIDs) ? adminIDs : [],
      userInfo: Array.isArray(userInfo) ? userInfo : [],
      participantIDs: Array.isArray(participantIDs) ? participantIDs : [],
      nicknames: nicknames,
      emoji: extra.emoji || "",
      color: extra.color || "",
      imageSrc: extra.imageSrc || "",
      approvalMode: !!extra.approvalMode,
      _fromPersistentDb: true
    };
  } catch (err) {
    return null;
  }
}

/**
 * Fallback lấy thông tin nhóm thông qua api.getThreadList khi getThreadInfo bị chặn GraphQL
 */
async function _fallbackGetThreadFromList(api, threadID) {
  if (!api || typeof api.getThreadList !== "function") return null;
  try {
    const list = await new Promise((resolve, reject) => {
      api.getThreadList(50, null, ["INBOX"], (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
    if (Array.isArray(list)) {
      const target = list.find(t => String(t.threadID) === String(threadID));
      if (target && target.isGroup) {
        return {
          threadID: String(threadID),
          threadName: target.name || "",
          name: target.name || "",
          isGroup: true,
          adminIDs: Array.isArray(target.adminIDs) ? target.adminIDs.map(id => ({ id: String(id) })) : [],
          userInfo: Array.isArray(target.participants) ? target.participants.map(p => ({ id: String(p.userID), name: p.name })) : [],
          participantIDs: Array.isArray(target.participantIDs) ? target.participantIDs.map(String) : [],
          nicknames: {},
          emoji: target.emoji || "",
          color: target.color || "",
          imageSrc: target.imageSrc || "",
          approvalMode: !!target.approvalMode
        };
      }
    }
  } catch (e) {}
  return null;
}

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

/**
 * Kiểm tra xem một nhóm có đang trong thời gian tạm ngưng (Rate-limit Cooldown) hay không
 */
function isThreadRateLimited(threadID) {
  const key = String(threadID);
  const expiry = _rateLimitedCooldowns.get(key);
  if (!expiry) return false;
  if (Date.now() >= expiry) {
    _rateLimitedCooldowns.delete(key);
    return false;
  }
  return true;
}

/**
 * Xóa trạng thái Rate-limit Cooldown của một nhóm (khi cần ép thử lại)
 */
function clearRateLimitCooldown(threadID) {
  const key = String(threadID);
  _rateLimitedCooldowns.delete(key);
}

/**
 * Kiểm tra xem dữ liệu trả về từ Facebook có phải là một đối tượng threadInfo hợp lệ hay không
 */
function isValidThreadInfo(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.error || (obj.error_results !== undefined && obj.error_results !== 0)) return false;
  // Bắt buộc phải có threadID hoặc isGroup hoặc participantIDs hoặc threadName
  if (obj.isGroup === undefined && !obj.participantIDs && !obj.threadName && !obj.name) return false;
  return true;
}

/**
 * Lấy threadInfo:
 * - Khi bot mới restart / mới lấy appstate: Gọi Facebook 1 lần đầu tiên cho thread đó để sync vào SQLite DB.
 * - Sau khi đã sync 1 lần trong phiên chạy: Ưu tiên 100% lấy từ SQLite Database & RAM Cache (0ms, 0 network call).
 * - Realtime events tiếp tục tự động cập nhật SQLite Database.
 * @param {object} api - Facebook API instance
 * @param {string} threadID - ID nhóm
 * @param {boolean} [forceRefresh=false] - Ép buộc query lại từ Facebook (nếu muốn làm mới)
 */
async function getThreadInfoCached(api, threadID, forceRefresh = false) {
  const key = String(threadID);
  const hasSyncedThisSession = _sessionSyncedThreads.has(key);

  // 1. Nếu ĐÃ ĐƯỢC SYNC 1 lần trong phiên chạy này -> Đọc thẳng từ RAM hoặc SQLite Database
  if (hasSyncedThisSession && !forceRefresh) {
    // 1.1 Kiểm tra RAM Cache
    const cached = _threadInfoCache.get(key);
    if (cached && Date.now() - cached.ts < THREAD_INFO_TTL && cached.data?.isGroup) {
      return cached.data;
    }

    // 1.2 ƯU TIÊN DATABASE SQLITE
    const dbInfo = await loadThreadInfoFromDb(key);
    if (dbInfo && dbInfo.isGroup) {
      _threadInfoCache.set(key, { data: dbInfo, ts: Date.now() });
      return dbInfo;
    }
  }

  // 2. CIRCUIT BREAKER: Kiểm tra xem nhóm có đang bị Rate Limit đóng băng không
  if (isThreadRateLimited(key)) {
    _sessionSyncedThreads.add(key);
    if (_threadInfoCache.has(key)) return _threadInfoCache.get(key).data;
    const dbInfo = await loadThreadInfoFromDb(key);
    if (dbInfo) {
      _threadInfoCache.set(key, { data: dbInfo, ts: Date.now() });
      return dbInfo;
    }
    return null;
  }

  // 3. Request Deduplication: Nếu đang có request chờ Facebook phản hồi, chia sẻ Promise
  if (_pendingFetches.has(key)) {
    return _pendingFetches.get(key);
  }

  const fetchPromise = (async () => {
    try {
      if (api && typeof api.getThreadInfo === "function") {
        let info = await _quietGetThreadInfo(api, key);

        // Nếu getThreadInfo bị chặn GraphQL hoặc không có adminIDs, gọi fallback getThreadList
        if (!isValidThreadInfo(info) || !Array.isArray(info.adminIDs) || info.adminIDs.length === 0) {
          const listFallback = await _fallbackGetThreadFromList(api, key);
          if (listFallback && listFallback.isGroup) {
            info = listFallback;
          }
        }

        if (isValidThreadInfo(info)) {
          // Thành công: Đánh dấu đã sync 1 lần trong phiên này
          _rateLimitedCooldowns.delete(key);
          _sessionSyncedThreads.add(key);
          _threadInfoCache.set(key, { data: info, ts: Date.now() });

          // Lưu Persistent SQLite bất đồng bộ
          saveThreadInfoToDb(key, info).catch(() => {});

          if (info.nicknames && typeof info.nicknames === "object") {
            saveAllNicknames(key, info.nicknames).catch(err => {
              console.error("❌ Lỗi tự động lưu danh sách biệt danh:", err);
            });
          }
          return info;
        } else {
          // Facebook trả về error object (bị rate-limit hoặc chặn GraphQL)
          throw new Error(info?.error || "Invalid threadInfo response from Facebook");
        }
      }
    } catch (err) {
      // Facebook GraphQL Rate-limit hoặc lỗi kết nối -> Kích hoạt Circuit Breaker
      const nextRetry = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      _rateLimitedCooldowns.set(key, nextRetry);
      _sessionSyncedThreads.add(key); // Đánh dấu để các lệnh sau đọc từ DB, không spam FB
      console.log(`⚠️ [RATE LIMIT BREAKER] Nhóm ${key} bị Facebook Rate-Limit. Tạm ngưng gửi request lên Facebook trong 15 phút (Đọc thẳng từ SQLite Database).`);
    }

    // Fallback: Trả về Persistent Cache từ SQLite Database
    const dbInfo = await loadThreadInfoFromDb(key);
    if (dbInfo) {
      _threadInfoCache.set(key, { data: dbInfo, ts: Date.now() });
      return dbInfo;
    }

    return null;
  })();

  _pendingFetches.set(key, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    _pendingFetches.delete(key);
  }
}

/**
 * Xóa trạng thái session sync (ví dụ khi reload appstate mới cần sync lại 1 lần từ FB)
 */
function resetSessionSyncedThreads(threadID = null) {
  if (threadID) {
    _sessionSyncedThreads.delete(String(threadID));
  } else {
    _sessionSyncedThreads.clear();
  }
}

/**
 * Cập nhật Realtime danh sách Admin (khi nhận event log:thread-admins)
 */
async function syncThreadAdminRealtime(threadID, targetID, action) {
  const key = String(threadID);
  const targetIdStr = String(targetID);
  
  let data = _threadInfoCache.get(key)?.data;
  if (!data) {
    data = await loadThreadInfoFromDb(key);
  }
  if (!data) {
    data = { threadID: key, isGroup: true, adminIDs: [], participantIDs: [], userInfo: [] };
  }

  let adminIDs = Array.isArray(data.adminIDs) ? [...data.adminIDs] : [];
  
  if (action === "add_admin" || action === "addAdmin") {
    const exists = adminIDs.some(item => String(item.id || item) === targetIdStr);
    if (!exists) {
      adminIDs.push({ id: targetIdStr });
    }
  } else if (action === "remove_admin" || action === "removeAdmin") {
    adminIDs = adminIDs.filter(item => String(item.id || item) !== targetIdStr);
  }

  data.adminIDs = adminIDs;
  _threadInfoCache.set(key, { data, ts: Date.now() });
  await saveThreadInfoToDb(key, data).catch(() => {});
  console.log(`[syncThreadAdminRealtime] Đã cập nhật QTV cho nhóm ${key}: ${action} UID ${targetIdStr} (Tổng QTV: ${adminIDs.length})`);
}

/**
 * Cập nhật Realtime tên nhóm (khi nhận event log:thread-name)
 */
async function syncThreadNameRealtime(threadID, newName) {
  const key = String(threadID);
  let data = _threadInfoCache.get(key)?.data;
  if (!data) {
    data = await loadThreadInfoFromDb(key);
  }
  if (!data) {
    data = { threadID: key, isGroup: true, adminIDs: [], participantIDs: [], userInfo: [] };
  }

  data.threadName = newName;
  data.name = newName;
  _threadInfoCache.set(key, { data, ts: Date.now() });
  saveThreadInfoToDb(key, data).catch(() => {});
}

/**
 * Cập nhật Realtime biệt danh (khi nhận event log:user-nickname)
 */
async function syncThreadNicknameRealtime(threadID, targetID, nickname) {
  const key = String(threadID);
  let data = _threadInfoCache.get(key)?.data;
  if (!data) {
    data = await loadThreadInfoFromDb(key);
  }
  if (!data) {
    data = { threadID: key, isGroup: true, adminIDs: [], participantIDs: [], userInfo: [] };
  }

  if (!data.nicknames || typeof data.nicknames !== "object") {
    data.nicknames = {};
  }
  data.nicknames[String(targetID)] = nickname;
  _threadInfoCache.set(key, { data, ts: Date.now() });
  saveThreadInfoToDb(key, data).catch(() => {});
}

/**
 * Cập nhật Realtime thành viên ra/vào (khi nhận event log:subscribe / log:unsubscribe)
 */
async function syncThreadParticipantRealtime(threadID, participantData, action) {
  const key = String(threadID);
  let data = _threadInfoCache.get(key)?.data;
  if (!data) {
    data = await loadThreadInfoFromDb(key);
  }
  if (!data) {
    data = { threadID: key, isGroup: true, adminIDs: [], participantIDs: [], userInfo: [] };
  }

  let participantIDs = Array.isArray(data.participantIDs) ? [...data.participantIDs] : [];
  let userInfo = Array.isArray(data.userInfo) ? [...data.userInfo] : [];
  let adminIDs = Array.isArray(data.adminIDs) ? [...data.adminIDs] : [];

  if (action === "add" && Array.isArray(participantData)) {
    for (const p of participantData) {
      const uid = String(p.userFbId || p.id || "");
      if (uid && !participantIDs.includes(uid)) {
        participantIDs.push(uid);
      }
      if (uid && !userInfo.some(u => String(u.id) === uid)) {
        userInfo.push({ id: uid, name: p.fullName || p.name || "Người dùng Facebook" });
      }
    }
  } else if (action === "remove") {
    const leftUid = String(participantData);
    participantIDs = participantIDs.filter(id => id !== leftUid);
    userInfo = userInfo.filter(u => String(u.id) !== leftUid);
    adminIDs = adminIDs.filter(item => String(item.id || item) !== leftUid);
    data.adminIDs = adminIDs;
  }

  data.participantIDs = participantIDs;
  data.userInfo = userInfo;
  _threadInfoCache.set(key, { data, ts: Date.now() });
  saveThreadInfoToDb(key, data).catch(() => {});
}

/**
 * Cập nhật Realtime ảnh nhóm (khi nhận event change_thread_image / log:thread-image)
 */
async function syncThreadImageRealtime(threadID, imageUrl) {
  const key = String(threadID);
  let data = _threadInfoCache.get(key)?.data;
  if (!data) {
    data = await loadThreadInfoFromDb(key);
  }
  if (!data) return;

  data.imageSrc = imageUrl || "";
  _threadInfoCache.set(key, { data, ts: Date.now() });
  saveThreadInfoToDb(key, data).catch(() => {});
}

/**
 * Cập nhật Realtime màu sắc / emoji nhóm
 */
async function syncThreadThemeRealtime(threadID, themeData) {
  const key = String(threadID);
  let data = _threadInfoCache.get(key)?.data;
  if (!data) {
    data = await loadThreadInfoFromDb(key);
  }
  if (!data) return;

  if (themeData && themeData.emoji) data.emoji = themeData.emoji;
  if (themeData && themeData.color) data.color = themeData.color;
  _threadInfoCache.set(key, { data, ts: Date.now() });
  saveThreadInfoToDb(key, data).catch(() => {});
}

function clearThreadInfoCache(threadID) {
  const key = String(threadID);
  _threadInfoCache.delete(key);
}

module.exports = {
  getThreadInfoCached,
  clearThreadInfoCache,
  saveThreadInfoToDb,
  loadThreadInfoFromDb,
  syncThreadAdminRealtime,
  syncThreadNameRealtime,
  syncThreadNicknameRealtime,
  syncThreadParticipantRealtime,
  syncThreadImageRealtime,
  syncThreadThemeRealtime,
  isThreadRateLimited,
  clearRateLimitCooldown,
  resetSessionSyncedThreads
};
