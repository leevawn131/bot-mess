const { checkCooldown } = require("../../utils/cooldown");
const { ADMIN_BOT_UIDS } = require("../../utils/checkPermission");
const axios = require("axios");

function isNumericUid(value) {
  return /^\d{6,}$/.test(String(value || "").trim());
}

function extractUidFromInput(rawInput) {
  if (!rawInput) return null;

  const input = String(rawInput).trim();

  if (isNumericUid(input)) {
    return input;
  }

  const profileIdMatch =
    input.match(/(?:\?|&)id=(\d{6,})/i) ||
    input.match(/fb:\/\/profile\/(\d{6,})/i);
  if (profileIdMatch?.[1]) {
    return profileIdMatch[1];
  }

  const numericPathMatch = input.match(
    /facebook\.com\/(?:[a-z]{2,3}\/)?(\d{6,})(?:[/?#]|$)/i,
  );
  if (numericPathMatch?.[1]) {
    return numericPathMatch[1];
  }

  return null;
}

function normalizeFacebookUrlForLookup(rawInput) {
  try {
    const url = new URL(rawInput);
    if (!/facebook\.com$/i.test(url.hostname)) {
      return rawInput;
    }

    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch (e) {
    return rawInput;
  }
}

function extractVanityFromFacebookUrl(rawInput) {
  try {
    const url = new URL(rawInput);
    if (!/facebook\.com$/i.test(url.hostname)) {
      return null;
    }

    const firstSegment = (url.pathname || "").split("/").filter(Boolean)[0];

    if (!firstSegment) return null;
    if (
      [
        "profile.php",
        "share",
        "groups",
        "watch",
        "reel",
        "photo",
        "posts",
      ].includes(firstSegment.toLowerCase())
    ) {
      return null;
    }

    if (isNumericUid(firstSegment)) return firstSegment;
    return firstSegment;
  } catch (e) {
    return null;
  }
}

function pickBestUid(candidates, blockedUIDs = []) {
  const blocked = new Set((blockedUIDs || []).map((x) => String(x)));
  const score = new Map();

  for (const uid of candidates) {
    const key = String(uid || "").trim();
    if (!isNumericUid(key)) continue;
    if (blocked.has(key)) continue;
    score.set(key, (score.get(key) || 0) + 1);
  }

  if (score.size === 0) return null;

  let bestUid = null;
  let bestScore = -1;
  for (const [uid, value] of score.entries()) {
    if (value > bestScore) {
      bestUid = uid;
      bestScore = value;
    }
  }

  return bestUid;
}

function extractUidFromHtml(html, blockedUIDs = []) {
  const content = String(html || "");
  const candidates = [];

  // Ưu tiên lấy UID từ block GraphQL timeline query của profile đích.
  const timelineQueryPatterns = [
    /"queryName"\s*:\s*"ProfileCometTimelineFeedQuery"[\s\S]{0,6000}?"userID"\s*:\s*"(\d{6,})"/gi,
    /"userID"\s*:\s*"(\d{6,})"[\s\S]{0,6000}?"queryName"\s*:\s*"ProfileCometTimelineFeedQuery"/gi,
    /\\"queryName\\"\s*:\s*\\"ProfileCometTimelineFeedQuery\\"[\s\S]{0,6000}?\\"userID\\"\s*:\s*\\"(\d{6,})\\"/gi,
  ];

  for (const re of timelineQueryPatterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      if (m?.[1]) candidates.push(String(m[1]));
    }
  }

  const pickedFromTimelineQuery = pickBestUid(candidates, blockedUIDs);
  if (pickedFromTimelineQuery) return pickedFromTimelineQuery;

  const explicitPatterns = [
    /fb:\/\/profile\/(\d{6,})/gi,
    /fb:\\\/\\\/profile\\\/(\d{6,})/gi,
    /profile\.php\?id=(\d{6,})/gi,
  ];

  for (const re of explicitPatterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      if (m?.[1]) candidates.push(String(m[1]));
    }
  }

  const pickedExplicit = pickBestUid(candidates, blockedUIDs);
  if (pickedExplicit) return pickedExplicit;

  // Fallback yếu: chỉ dùng khi có đúng 1 userID duy nhất trong HTML.
  const idMatches = content.match(/"userID":"(\d{6,})"/g) || [];
  if (idMatches.length > 0) {
    const ids = idMatches
      .map((s) => (s.match(/\d{6,}/) || [null])[0])
      .filter(Boolean);

    const unique = [...new Set(ids)].filter(
      (uid) => !isBlockedResolvedUid(uid, blockedUIDs),
    );
    if (unique.length === 1) return unique[0];
  }

  return null;
}

function isBlockedResolvedUid(uid, blockedUIDs = []) {
  if (!uid) return false;
  const blocked = new Set((blockedUIDs || []).map((x) => String(x)));
  return blocked.has(String(uid));
}

async function fetchFacebookPage(url) {
  const response = await axios.get(url, {
    maxRedirects: 10,
    timeout: 15000,
    validateStatus: () => true,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
  });

  const result = {
    finalUrl: String(response?.request?.res?.responseUrl || url),
    html: String(response?.data || ""),
  };

  return result;
}

async function resolveUidFromLinkOrUsername(api, rawInput, options = {}) {
  if (!rawInput) return null;
  const blockedUIDs = options.blockedUIDs || [];

  const input = String(rawInput).trim();

  const directUid = extractUidFromInput(input);
  if (directUid && !isBlockedResolvedUid(directUid, blockedUIDs)) {
    return String(directUid);
  }

  const maybeUrl = /^https?:\/\//i.test(input);
  let normalized = input;

  if (maybeUrl) {
    try {
      const page = await fetchFacebookPage(input);
      const fromHtml = extractUidFromHtml(page.html, blockedUIDs);
      if (fromHtml && !isBlockedResolvedUid(fromHtml, blockedUIDs)) {
        return String(fromHtml);
      }

      // Fallback bằng phiên đã đăng nhập của bot khi HTML public thiếu metadata.
      try {
        if (typeof api.httpGet === "function") {
          const htmlAuthed = await api.httpGet(
            page.finalUrl,
            {},
            {},
            null,
            true,
          );
          const fromAuthed = extractUidFromHtml(htmlAuthed, blockedUIDs);
          if (fromAuthed && !isBlockedResolvedUid(fromAuthed, blockedUIDs)) {
            return String(fromAuthed);
          }
        }
      } catch (e) {
        // error handling
      }

      normalized = normalizeFacebookUrlForLookup(page.finalUrl);
      const fromFinalUrl = extractUidFromInput(normalized);
      if (fromFinalUrl && !isBlockedResolvedUid(fromFinalUrl, blockedUIDs)) {
        return String(fromFinalUrl);
      }
    } catch (e) {
      normalized = normalizeFacebookUrlForLookup(input);
    }
  }

  try {
    if (typeof api.getUID === "function") {
      const uid = await api.getUID(normalized);
      if (uid && !isBlockedResolvedUid(uid, blockedUIDs)) {
        return String(uid);
      }
    }
  } catch (e) {
    // error handling
  }

  try {
    if (typeof api.getUserID === "function") {
      const data = await api.getUserID(normalized);
      if (
        Array.isArray(data) &&
        data.length > 0 &&
        data[0].userID &&
        !isBlockedResolvedUid(data[0].userID, blockedUIDs)
      ) {
        return String(data[0].userID);
      }
    }
  } catch (e) {
    // error handling
  }

  const vanity = maybeUrl ? extractVanityFromFacebookUrl(normalized) : input;
  if (vanity && !isNumericUid(vanity)) {
    try {
      const page = await fetchFacebookPage(
        `https://www.facebook.com/${vanity}`,
      );
      const fromVanityPage = extractUidFromHtml(page.html, blockedUIDs);
      if (
        fromVanityPage &&
        !isBlockedResolvedUid(fromVanityPage, blockedUIDs)
      ) {
        return String(fromVanityPage);
      }
    } catch (e) {
      // error handling
    }
  }

  return null;
}

function isAddErrorResult(result) {
  if (!result || typeof result !== "object") return false;
  if (result.type === "error_gc") return true;
  if (typeof result.error === "string" && result.error.trim()) return true;
  if (typeof result.err === "string" && result.err.trim()) return true;
  return false;
}

function generateOfflineThreadingID() {
  const now = Date.now();
  const random = Math.floor(Math.random() * 4294967295);
  return String((BigInt(now) << 22n) | BigInt(random));
}

function generateThreadingID(currentUserID) {
  const k = Date.now();
  const l = Math.floor(Math.random() * 4294967295);
  return `<${k}:${l}-${currentUserID}@mail.projektitan.com>`;
}

async function addUserToGroupViaWeb(api, threadID, targetUID) {
  if (typeof api.httpPost !== "function") {
    return { ok: false, error: "httpPost not available" };
  }

  const actorID = String(api.getCurrentUserID());
  const messageAndOTID = generateOfflineThreadingID();
  const form = {
    client: "mercury",
    action_type: "ma-type:log-message",
    author: `fbid:${actorID}`,
    thread_id: "",
    timestamp: Date.now(),
    timestamp_absolute: "Today",
    timestamp_relative: "0 mins",
    timestamp_time_passed: "0",
    is_unread: false,
    is_cleared: false,
    is_forward: false,
    is_filtered_content: false,
    is_filtered_content_bh: false,
    is_filtered_content_account: false,
    is_spoof_warning: false,
    source: "source:chat:web",
    "source_tags[0]": "source:chat",
    log_message_type: "log:subscribe",
    status: "0",
    offline_threading_id: messageAndOTID,
    message_id: messageAndOTID,
    threading_id: generateThreadingID(actorID),
    manual_retry_cnt: "0",
    thread_fbid: String(threadID),
    "log_message_data[added_participants][0]": `fbid:${String(targetUID)}`,
  };

  try {
    const raw = await api.httpPost(
      "https://www.facebook.com/messaging/send/",
      form,
    );
    let parsed = null;
    try {
      parsed = JSON.parse(String(raw || "").replace(/^for \(;;\);/, ""));
    } catch (e) {
      // raw response can be non-json depending on fb side; keep parsed as null
    }

    if (parsed?.error) {
      return {
        ok: false,
        error: parsed.errorDescription || parsed.error || "web add error",
        raw,
        parsed,
      };
    }

    return { ok: true, raw, parsed };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function detectProfessionalOrPublicProfile(api, targetUID) {
  if (typeof api.getUserInfo !== "function")
    return { detected: false, reason: null };

  try {
    const info = await api.getUserInfo(String(targetUID), false);
    const headline = String(info?.headline || "").toLowerCase();
    const bio = String(info?.bio || "").toLowerCase();
    const type = String(info?.type || "").toLowerCase();

    const keywords = [
      "người sáng tạo nội dung",
      "content creator",
      "public figure",
      "professional",
      "chế độ chuyên nghiệp",
    ];

    const joined = `${headline} ${bio} ${type}`;
    const matched = keywords.find((k) => joined.includes(k));
    if (matched) {
      return { detected: true, reason: `matched:${matched}` };
    }
  } catch (e) {
    // error handling
  }

  return { detected: false, reason: null };
}

async function verifyMemberJoined(
  api,
  threadID,
  targetUID,
  retry = 5,
  delayMs = 1800,
) {
  for (let i = 0; i <= retry; i++) {
    try {
      const info = await api.getThreadInfo(threadID);
      const memberIds = (info?.participantIDs || []).map((id) => String(id));
      if (memberIds.includes(String(targetUID))) {
        return { joined: true, threadInfo: info };
      }
    } catch (e) {
      // error handling
    }

    if (i < retry) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { joined: false, threadInfo: null };
}

async function performAddToGroup({
  api,
  threadID,
  messageID,
  targetUID,
  threadInfo,
}) {
  const memberIds = (threadInfo.participantIDs || []).map((id) => String(id));
  if (memberIds.includes(String(targetUID))) {
    return api.sendMessage(
      "ℹ️ Người này đã ở trong nhóm rồi.",
      threadID,
      messageID,
    );
  }

  let addResult = null;
  let addMethod = null;
  if (typeof api.addUserToGroup === "function") {
    addMethod = "addUserToGroup";
    addResult = await api.addUserToGroup(String(targetUID), String(threadID));
  } else if (typeof api.addUsersToGroup === "function") {
    addMethod = "addUsersToGroup";
    addResult = await api.addUsersToGroup(
      [String(targetUID)],
      String(threadID),
    );
  } else if (typeof api.gcmember === "function") {
    addMethod = "gcmember";
    addResult = await api.gcmember(
      "add",
      [String(targetUID)],
      String(threadID),
    );
  } else {
    throw new Error("Library missing add group function");
  }

  if (isAddErrorResult(addResult)) {
    throw new Error(addResult.error || addResult.err || "add group failed");
  }

  const verify = await verifyMemberJoined(api, threadID, targetUID);
  if (verify.joined) {
    return api.sendMessage(
      `✅ Đã thêm UID ${targetUID} vào nhóm thành công.`,
      threadID,
      messageID,
    );
  }

  // Nhánh ws3-fca gcmember có thể chỉ publish MQTT rồi trả success sớm;
  // thử gửi lại 1 lần để tăng tỉ lệ vào nhóm thực tế.
  if (addMethod === "gcmember" && typeof api.gcmember === "function") {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const retryResult = await api.gcmember(
      "add",
      [String(targetUID)],
      String(threadID),
    );

    if (isAddErrorResult(retryResult)) {
      throw new Error(
        retryResult.error || retryResult.err || "gcmember retry failed",
      );
    }

    const verifyAfterRetry = await verifyMemberJoined(
      api,
      threadID,
      targetUID,
      3,
      2000,
    );
    if (verifyAfterRetry.joined) {
      return api.sendMessage(
        `✅ Đã thêm UID ${targetUID} vào nhóm thành công.`,
        threadID,
        messageID,
      );
    }

    // Fallback web-form add: thử endpoint messaging/send giống flow add truyền thống.
    const webFallback = await addUserToGroupViaWeb(api, threadID, targetUID);

    const verifyAfterWeb = await verifyMemberJoined(
      api,
      threadID,
      targetUID,
      3,
      2000,
    );
    if (verifyAfterWeb.joined) {
      return api.sendMessage(
        `✅ Đã thêm UID ${targetUID} vào nhóm thành công.`,
        threadID,
        messageID,
      );
    }
  }

  let latestThreadInfo = threadInfo;
  try {
    latestThreadInfo = await api.getThreadInfo(threadID);
  } catch (e) {
    // giữ threadInfo cũ nếu fetch mới thất bại
  }

  const approvalQueue = latestThreadInfo?.approvalQueue || [];
  const waitingApproval = approvalQueue.some(
    (q) => String(q?.requesterID) === String(targetUID),
  );

  if (waitingApproval || latestThreadInfo?.approvalMode) {
    return api.sendMessage(
      `⚠️ Đã gửi lời mời UID ${targetUID}, nhưng chưa vào nhóm ngay.\nCó thể đang chờ duyệt/chờ xác nhận lời mời.`,
      threadID,
      messageID,
    );
  }

  return api.sendMessage(
    `⚠️ Không thể add UID ${targetUID}.\nTài khoản này có thể đang bật chế độ chuyên nghiệp (trang cá nhân công khai) nên Facebook chặn thêm bằng API.`,
    threadID,
    messageID,
  );
}

module.exports = {
  name: "add",
  description: "Mời thành viên vào nhóm bằng UID hoặc link Facebook",
  usage: "[uid | link facebook]",
  execute: async ({ api, event, args }) => {
    const { threadID, messageID, senderID } = event;

    const cooldown = checkCooldown({
      command: "add",
      key: senderID,
      durationMs: 10000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    try {
      const threadInfo = await api.getThreadInfo(threadID);
      if (!threadInfo?.isGroup) {
        return api.sendMessage(
          "⚠️ Lệnh này chỉ dùng trong nhóm chat.",
          threadID,
          messageID,
        );
      }

      const adminIDs = (threadInfo.adminIDs || []).map((item) =>
        String(item.id),
      );
      const botID = String(api.getCurrentUserID());
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const isSenderBotAdmin = ADMIN_BOT_UIDS.includes(String(senderID));

      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage(
          "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được dùng lệnh add!",
          threadID,
          messageID,
        );
      }

      if (!adminIDs.includes(botID)) {
        return api.sendMessage(
          "❌ Bot cần quyền Quản Trị Viên để thêm thành viên vào nhóm!",
          threadID,
          messageID,
        );
      }

      const input = args.join(" ").trim();

      if (!input) {
        return api.sendMessage(
          "❌ Vui lòng nhập UID hoặc link Facebook của người cần thêm.",
          threadID,
          messageID,
        );
      }

      const explicitUid = extractUidFromInput(input);

      if (explicitUid && String(explicitUid) === botID) {
        return api.sendMessage(
          "⚠️ Không thể thêm chính bot vào nhóm này.",
          threadID,
          messageID,
        );
      }

      const targetUID = await resolveUidFromLinkOrUsername(api, input, {
        blockedUIDs: [botID],
      });

      if (!targetUID) {
        return api.sendMessage(
          "❌ Không tìm được UID hợp lệ từ dữ liệu bạn nhập. Hãy thử UID số hoặc link profile Facebook.",
          threadID,
          messageID,
        );
      }

      if (String(targetUID) === botID) {
        return api.sendMessage(
          "⚠️ Không thể thêm chính bot vào nhóm này.",
          threadID,
          messageID,
        );
      }

      return performAddToGroup({
        api,
        threadID,
        messageID,
        targetUID: String(targetUID),
        threadInfo,
      });
    } catch (e) {
      console.error("Lỗi add:", e);
      return api.sendMessage(
        "❌ Không thể thêm thành viên. Có thể do quyền riêng tư của tài khoản hoặc bot chưa đủ quyền.",
        threadID,
        messageID,
      );
    }
  },
};
