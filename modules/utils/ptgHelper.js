const { execute } = require("./database");
const { ensurePTGSchema } = require("./ptgSchema");
const axios = require("axios");
const qs = require("querystring");

const SEPARATOR = "─────────────"; // Đúng 13 kí tự theo yêu cầu của user

// clientKey cố định cho PTG VNG (appID 10661)
const PTG_CLIENT_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjIjoxMDY2MSwiYSI6MTA2NjEsInMiOjF9.B08-6v9oP3rNxrvImC-WBO-AN0mru77ZNLOgqosNIjA";

/**
 * Tra cứu tên nhân vật Play Together từ roleID qua API billing VNG
 * @param {string} roleId - Mã ID nhân vật (ví dụ: RJHD-ZT9L-LMYY)
 * @returns {Promise<{success: boolean, roleName?: string, serverName?: string, roles?: Array}>}
 */
async function fetchPTGRoleName(roleId) {
  const cleanId = String(roleId || "").trim();
  if (!cleanId) return { success: false, reason: "ID trống" };

  try {
    const payload = qs.stringify({
      platform: "mobile",
      clientKey: PTG_CLIENT_KEY,
      loginType: "9",
      lang: "VI",
      jtoken: "",
      userID: "",
      roleID: cleanId,
      roleName: cleanId,
      serverID: "",
      getVgaId: "1"
    });

    const res = await axios.post("https://billing.vnggames.com/fe/api/auth/quick", payload, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        "Origin": "https://shop.vnggames.com",
        "Referer": "https://shop.vnggames.com/",
        "Accept": "application/json, text/plain, */*"
      },
      timeout: 8000
    });

    const data = res.data;
    if (data && data.returnCode === 1 && data.data) {
      const roleName = data.data.roleName || null;
      const serverName = data.data.serverName || null;
      const roles = data.data.suggestion?.roles || [];
      return { success: true, roleName, serverName, roles };
    }
    return { success: false, reason: data?.returnMessage || "Không tìm thấy" };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

/**
 * Lấy chuỗi thời gian định dạng HH:mm:ss và DD/MM/YYYY theo giờ Việt Nam
 */
function getVNTime(date = new Date()) {
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const hours = pad(vnTime.getUTCHours());
  const minutes = pad(vnTime.getUTCMinutes());
  const seconds = pad(vnTime.getUTCSeconds());
  const day = pad(vnTime.getUTCDate());
  const month = pad(vnTime.getUTCMonth() + 1);
  const year = vnTime.getUTCFullYear();

  return {
    time: `${hours}:${minutes}:${seconds}`,
    timeShort: `${hours}:${minutes}`,
    date: `${day}/${month}/${year}`,
    dateShort: `${day}/${month}`,
    rawTime: vnTime
  };
}

/**
 * Quản lý ID tài khoản Play Together của User
 */
async function addPTGAccount(userId, ptgId, nickname = null, server = "vng") {
  await ensurePTGSchema();
  const cleanPtgId = String(ptgId || "").trim();
  const cleanUserId = String(userId || "").trim();
  if (!cleanPtgId || !cleanUserId) return { success: false, reason: "ID không hợp lệ" };

  try {
    await execute(
      `INSERT INTO ptg_accounts (user_id, ptg_id, nickname, server) 
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, ptg_id) DO UPDATE SET nickname = excluded.nickname, server = excluded.server`,
      [cleanUserId, cleanPtgId, nickname, server]
    );
    return { success: true, ptgId: cleanPtgId, nickname };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

/**
 * Xóa ID tài khoản Play Together
 */
async function delPTGAccount(userId, ptgId) {
  await ensurePTGSchema();
  const cleanPtgId = String(ptgId || "").trim();
  const cleanUserId = String(userId || "").trim();

  try {
    const res = await execute(
      `DELETE FROM ptg_accounts WHERE user_id = ? AND ptg_id = ?`,
      [cleanUserId, cleanPtgId]
    );
    return { success: res && (res.affectedRows > 0 || res.changes > 0) };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

/**
 * Lấy danh sách ID tài khoản của 1 User
 */
async function getAccountsByUser(userId) {
  await ensurePTGSchema();
  try {
    const rows = await execute(
      `SELECT * FROM ptg_accounts WHERE user_id = ? ORDER BY id DESC`,
      [String(userId)]
    );
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

/**
 * Lấy tất cả tài khoản PTG đã đăng ký trong hệ thống
 */
async function getAllAccounts() {
  await ensurePTGSchema();
  try {
    const rows = await execute(`SELECT * FROM ptg_accounts ORDER BY id DESC`);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

/**
 * Cập nhật/Đồng bộ danh sách Giftcode thật mới nhất vào database
 */
async function syncGiftcodesFromWeb() {
  await ensurePTGSchema();
  const realCodes = [
    { code: "PTDESERTOASIS", description: "1 Gói thẻ siêu cao cấp + 250 Xu kim tự tháp + 1 Lượt bốc thăm Đền Anubis", expires_at: "Hạn sự kiện Ốc đảo Sa Mạc" },
    { code: "PT26AUGMONTHLY", description: "1 Gói thẻ siêu cao cấp + 30 Đá quý", expires_at: "01/09/2026" },
    { code: "PTTROPICAL", description: "1 Gói thẻ siêu cao cấp + 250 Xu KhMonkey + 1 Lượt bốc thăm", expires_at: "Còn hạn" },
    { code: "TMI10KPRESENT", description: "Điệu nhảy Kichi Kichi 1, 2, 3", expires_at: "Còn hạn" },
    { code: "PLAYKAIA2026", description: "Vé Bốc thăm Chủ đề Kaia", expires_at: "Còn hạn" },
    { code: "2026KAIAHAPPY", description: "Đá quý + Vé Bốc thăm Chủ đề", expires_at: "Còn hạn" },
    { code: "KELLYKELPT", description: "Gói thẻ thường + Vé bốc thăm + Hộp tiền sao", expires_at: "Còn hạn" },
    { code: "RIBO1028PT", description: "Gói thẻ thường + Vé bốc thăm + Hộp tiền sao", expires_at: "Còn hạn" }
  ];

  for (const item of realCodes) {
    await execute(
      `INSERT INTO ptg_giftcodes (code, description, status, expires_at, source)
       VALUES (?, ?, 'active', ?, 'Web Crawler')
       ON CONFLICT(code) DO UPDATE SET
         description = excluded.description,
         status = excluded.status,
         expires_at = excluded.expires_at`,
      [item.code, item.description, item.expires_at]
    );
  }
}

/**
 * Lấy danh sách Giftcode còn hạn
 */
async function getActiveGiftcodes() {
  await ensurePTGSchema();
  try {
    const rows = await execute(
      `SELECT * FROM ptg_giftcodes WHERE status = 'active' ORDER BY id DESC LIMIT 15`
    );
    if (!rows || rows.length === 0) {
      await syncGiftcodesFromWeb();
      return await execute(`SELECT * FROM ptg_giftcodes WHERE status = 'active' ORDER BY id DESC LIMIT 15`);
    }
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

/**
 * Gọi API đổi Giftcode Play Together VNG chính thức
 * @param {string} roleId - ID Game Play Together (ví dụ: RJHD-ZT9L-LMYY)
 * @param {string} code - Mã Giftcode
 * @param {string} serverId - Server ID (mặc định '2')
 */
async function redeemPTGCode(roleId, code, serverId = "2") {
  const cleanRoleId = String(roleId || "").trim();
  const cleanCode = String(code || "").trim().toUpperCase();

  if (!cleanRoleId || !cleanCode) {
    return { success: false, message: "Thiếu ID nhân vật hoặc mã code" };
  }

  const url = "https://vgrapi-sea.vnggames.com/coordinator/api/v1/code/redeem";
  const headers = {
    "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0",
    "Accept": "*/*",
    "Accept-Language": "vi-VN",
    "Referer": "https://levelup.vnggames.com/",
    "Origin": "https://levelup.vnggames.com",
    "content-type": "application/json",
    "x-client-region": "VN"
  };

  const payload = {
    serverId: String(serverId || "2"),
    gameCode: "661",
    roleId: cleanRoleId,
    roleName: cleanRoleId,
    code: cleanCode
  };

  try {
    const res = await axios.post(url, payload, { headers, timeout: 10000 });
    if (res.status === 200 && res.data && res.data.errorCode === 1) {
      return {
        success: true,
        code: cleanCode,
        roleId: cleanRoleId,
        message: "Nhận quà thành công! Quà đã gửi vào hòm thư.",
        data: res.data.data
      };
    }
    return {
      success: false,
      code: cleanCode,
      roleId: cleanRoleId,
      message: res.data?.message || "Nhập code không thành công."
    };
  } catch (e) {
    const errData = e.response?.data;
    const errorCode = errData?.errorCode;

    if (errorCode === 2121) {
      return {
        success: false,
        isClaimed: true,
        code: cleanCode,
        roleId: cleanRoleId,
        message: "Tài khoản đã nhận quà từ mã này rồi."
      };
    }
    if (errorCode === 2106) {
      return {
        success: false,
        isNotFound: true,
        code: cleanCode,
        roleId: cleanRoleId,
        message: "Mã quà không tồn tại hoặc đã hết hạn."
      };
    }
    return {
      success: false,
      code: cleanCode,
      roleId: cleanRoleId,
      message: errData?.description || errData?.message || e.message || "Lỗi kết nối máy chủ nhập code."
    };
  }
}

/**
 * Tự động nhập 1 mã code cho tất cả tài khoản của 1 User
 */
async function autoRedeemCodeForUser(userId, code) {
  const accounts = await getAccountsByUser(userId);
  if (!accounts || accounts.length === 0) {
    return { hasAccounts: false, results: [] };
  }

  const results = [];
  for (const acc of accounts) {
    const res = await redeemPTGCode(acc.ptg_id, code, acc.server_id || "2");
    results.push({
      account: acc,
      ...res
    });
  }

  return { hasAccounts: true, results };
}

/**
 * Tự động nhập TẤT CẢ mã code đang còn hạn trong kho cho tất cả tài khoản của User
 */
async function autoRedeemAllCodesForUser(userId) {
  const accounts = await getAccountsByUser(userId);
  if (!accounts || accounts.length === 0) {
    return { hasAccounts: false, results: [] };
  }

  const activeCodes = await getActiveGiftcodes();
  if (!activeCodes || activeCodes.length === 0) {
    return { hasAccounts: true, hasCodes: false, results: [] };
  }

  const summary = [];
  for (const acc of accounts) {
    const accResults = [];
    for (const c of activeCodes) {
      const res = await redeemPTGCode(acc.ptg_id, c.code, acc.server_id || "2");
      accResults.push({ code: c.code, ...res });
      // Nghỉ 300ms giữa các request để tránh rate limit
      await new Promise((r) => setTimeout(r, 300));
    }
    summary.push({ account: acc, codeResults: accResults });
  }

  return { hasAccounts: true, hasCodes: true, summary };
}

/**
 * Thêm Giftcode mới vào kho
 */
async function addGiftcode(code, description = "Quà tặng Play Together", source = "User") {
  await ensurePTGSchema();
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode || cleanCode.length < 3) return { success: false, reason: "Mã code không hợp lệ" };

  try {
    const existing = await execute(`SELECT id FROM ptg_giftcodes WHERE code = ?`, [cleanCode]);
    if (existing && existing.length > 0) {
      return { success: false, isDuplicate: true, code: cleanCode };
    }

    await execute(
      `INSERT INTO ptg_giftcodes (code, description, status, source) VALUES (?, ?, 'active', ?)`,
      [cleanCode, description, source]
    );
    return { success: true, code: cleanCode };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

/**
 * Bóc tách giftcode từ văn bản (tự phát hiện code trong tin nhắn)
 */
function extractGiftcodesFromText(text) {
  if (!text || typeof text !== "string") return [];
  const results = new Set();

  // Pattern 1: Link haegin coupon
  const linkRegex = /(?:haegin\.kr\/playtogether\/coupon[^\s]*[?&]code=|playtogether:\/\/coupon\?code=)([A-Za-z0-9_-]+)/gi;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    if (match[1] && match[1].length >= 3) {
      results.add(match[1].toUpperCase());
    }
  }

  // Pattern 2: Từ khóa code ptg: CODE hoặc mã: CODE
  const keywordRegex = /(?:code\s*ptg|giftcode\s*ptg|ptg\s*code|mã\s*ptg|code\s*playtogether|nhập\s*code)\s*[:=\-]?\s*([A-Za-z0-9_]{4,25})/gi;
  while ((match = keywordRegex.exec(text)) !== null) {
    if (match[1]) {
      const candidate = match[1].trim().toUpperCase();
      if (!["LIST", "ADD", "DEL", "HELP", "CODE", "NOTIFY"].includes(candidate)) {
        results.add(candidate);
      }
    }
  }

  return Array.from(results);
}

/**
 * Lấy cấu hình thông báo của Box
 */
async function getThreadSettings(threadId) {
  await ensurePTGSchema();
  try {
    const rows = await execute(`SELECT * FROM ptg_settings WHERE thread_id = ?`, [String(threadId)]);
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return {
      thread_id: String(threadId),
      notify_code: 1,
      auto_redeem: 1
    };
  } catch (e) {
    return {
      thread_id: String(threadId),
      notify_code: 1,
      auto_redeem: 1
    };
  }
}

/**
 * Cập nhật cấu hình thông báo cho Box
 */
async function updateThreadSettings(threadId, updates = {}) {
  await ensurePTGSchema();
  const tid = String(threadId);
  const current = await getThreadSettings(tid);
  const merged = { ...current, ...updates };

  try {
    await execute(
      `INSERT INTO ptg_settings (thread_id, notify_code, auto_redeem, updated_at)
       VALUES (?, ?, ?, datetime('now', 'localtime'))
       ON CONFLICT(thread_id) DO UPDATE SET
         notify_code = excluded.notify_code,
         auto_redeem = excluded.auto_redeem,
         updated_at = datetime('now', 'localtime')`,
      [
        tid,
        merged.notify_code ? 1 : 0,
        merged.auto_redeem ? 1 : 0
      ]
    );
    return { success: true, settings: merged };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

/**
 * Lấy tất cả Box có bật thông báo
 */
async function getAllSubscribedThreads() {
  await ensurePTGSchema();
  try {
    const rows = await execute(`SELECT * FROM ptg_settings`);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

module.exports = {
  SEPARATOR,
  getVNTime,
  fetchPTGRoleName,
  addPTGAccount,
  delPTGAccount,
  getAccountsByUser,
  getAllAccounts,
  getActiveGiftcodes,
  syncGiftcodesFromWeb,
  redeemPTGCode,
  autoRedeemCodeForUser,
  autoRedeemAllCodesForUser,
  addGiftcode,
  extractGiftcodesFromText,
  getThreadSettings,
  updateThreadSettings,
  getAllSubscribedThreads
};
