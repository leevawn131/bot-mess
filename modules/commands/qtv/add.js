const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { getThreadInfoCached, clearThreadInfoCache } = require("../../utils/threadInfo");
const axios = require("axios");
const prefix = process.env.BOT_PREFIX;

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

  // Match profile URLs like facebook.com/username or facebook.com/profile.php?id=123 or facebook.com/en/username
  const numericPathMatch = input.match(
    /facebook\.com\/(?:[a-z]{2,5}\/)?(\d{6,})(?:[/?#]|$)/i,
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
        console.error(
          "[resolveUID] httpGet failed for authed HTML:",
          e?.message || String(e),
        );
      }

      normalized = normalizeFacebookUrlForLookup(page.finalUrl);
      const fromFinalUrl = extractUidFromInput(normalized);
      if (fromFinalUrl && !isBlockedResolvedUid(fromFinalUrl, blockedUIDs)) {
        return String(fromFinalUrl);
      }
    } catch (e) {
      console.error(
        "[resolveUID] fetchFacebookPage HTML parsing failed:",
        e?.message || String(e),
      );
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
    console.error(
      "[resolveUID] api.getUID failed for:",
      normalized,
      e?.message || String(e),
    );
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
    console.error(
      "[resolveUID] api.getUserID failed for:",
      normalized,
      e?.message || String(e),
    );
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
      console.error(
        "[resolveUID] vanity URL fetch failed for:",
        vanity,
        e?.message || String(e),
      );
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
    // httpPost can be callback-based or promise-based
    let raw;
    const result = api.httpPost(
      "https://www.facebook.com/messaging/send/",
      form,
    );
    
    if (result instanceof Promise) {
      raw = await result;
    } else {
      // If it's callback-based, wrap in Promise
      raw = await new Promise((resolve, reject) => {
        // If result is a string/object, assume it's the response
        if (typeof result === 'string' || typeof result === 'object') {
          resolve(result);
        } else {
          // Otherwise assume the call is async and we need to wait
          reject(new Error('httpPost returned unexpected result'));
        }
      });
    }
    
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
    console.error("[isProfessional]", e?.message || String(e));
  }

  return { detected: false, reason: null };
}

async function verifyMemberJoined(
  api,
  threadID,
  targetUID,
  retry = 5,
  delayMs = 800,
) {
  for (let i = 0; i <= retry; i++) {
    try {
      clearThreadInfoCache(threadID);
      const info = await getThreadInfoCached(api, threadID);
      const memberIds = (info?.participantIDs || []).map((id) => String(id));
      console.log(
        `[verifyMember] attempt ${i}/${retry}: participantIDs count=${memberIds.length}, target in list=${memberIds.includes(String(targetUID))}`,
      );

      if (memberIds.includes(String(targetUID))) {
        console.log(`[verifyMember] ✅ Tìm thấy target UID trong nhóm!`);
        return { joined: true, threadInfo: info };
      }

      // Log approval queue và other relevant data
      const approvalQueue = info?.approvalQueue || [];
      if (approvalQueue.length > 0) {
        console.log(
          `[verifyMember] approval queue:`,
          approvalQueue.map((q) => ({
            requesterID: q?.requesterID,
            status: q?.status,
          })),
        );
      }
    } catch (e) {
      console.error(
        `[verifyMember] attempt ${i}/${retry} failed:`,
        e?.message || String(e),
      );
    }

    if (i < retry) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  console.log(`[verifyMember] ❌ Sau ${retry + 1} lần thử, user không vào nhóm`);
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
  let targetUserInfo = null;
  
  console.log(`[performAdd] Bắt đầu add UID ${targetUID} vào nhóm ${threadID}`);

  // **WARM-UP**: Fetch user profile HTML trước (giống như tự add bằng tay)
  // Điều này trigger Facebook cache user info và tăng tỉ lệ add thành công
  try {
    console.log(`[performAdd] Pre-fetching user profile để warm-up...`);
    const profileUrl = `https://www.facebook.com/${targetUID}`;
    const profileFetch = await fetchFacebookPage(profileUrl);
    console.log(`[performAdd] ✓ Profile fetched, finalUrl=${profileFetch.finalUrl}`);
    
    // Thêm delay để Facebook process
    await new Promise((resolve) => setTimeout(resolve, 800));
  } catch (e) {
    console.log(`[performAdd] Profile fetch fail (non-critical):`, e?.message);
  }

  // Try to get user info to check privacy settings and friendship
  try {
    if (typeof api.getUserInfo === "function") {
      const userInfo = await api.getUserInfo(String(targetUID));
      if (userInfo && userInfo[String(targetUID)]) {
        targetUserInfo = userInfo[String(targetUID)];
        console.log(
          `[performAdd] Target user info: name="${targetUserInfo.name}", isFriend=${targetUserInfo.isFriend}, gender=${targetUserInfo.gender}, type=${targetUserInfo.type}`,
        );
        
        // Check if user is friend
        if (!targetUserInfo.isFriend) {
          console.log(`[performAdd] ⚠️ WARNING: User không phải friend của bot! Có thể cần friend request trước.`);
        }
      }
    }
  } catch (e) {
    console.error(
      `[performAdd] Cannot get user info:`,
      e?.message || String(e),
    );
  }
  
    // **FAST-TRACK**: Try add immediately after profile warm-up (bypass friend requirement)
    if (typeof api.gcmember === "function") {
      console.log(`[performAdd] Fast-track: Thử add ngay sau warm-up...`);
      try {
        const fastAddResult = await api.gcmember(
          "add",
          [String(targetUID)],
          String(threadID),
        );
        console.log(`[performAdd] Fast-track result:`, fastAddResult);
      
        if (!isAddErrorResult(fastAddResult)) {
          // Verify fast-track success
          const fastVerify = await verifyMemberJoined(
            api,
            threadID,
            targetUID,
            3,
            600,
          );
          if (fastVerify.joined) {
            console.log(`[performAdd] ✅ Fast-track thành công!`);
            return api.sendMessage(
              `✅ Đã thêm UID ${targetUID} vào nhóm thành công.`,
              threadID,
              messageID,
            );
          }
        }
      } catch (e) {
        console.log(`[performAdd] Fast-track fail:`, e?.message);
      }
    }

  if (typeof api.addUserToGroup === "function") {
    addMethod = "addUserToGroup";
    console.log(`[performAdd] Đang thử method: ${addMethod}`);
    addResult = await api.addUserToGroup(String(targetUID), String(threadID));
    console.log(`[performAdd] Kết quả ${addMethod}:`, addResult);
  } else if (typeof api.addUsersToGroup === "function") {
    addMethod = "addUsersToGroup";
    console.log(`[performAdd] Đang thử method: ${addMethod}`);
    addResult = await api.addUsersToGroup(
      [String(targetUID)],
      String(threadID),
    );
    console.log(`[performAdd] Kết quả ${addMethod}:`, addResult);
  } else if (typeof api.gcmember === "function") {
    addMethod = "gcmember";
    console.log(`[performAdd] Đang thử method: ${addMethod}`);
    addResult = await api.gcmember(
      "add",
      [String(targetUID)],
      String(threadID),
    );
    console.log(`[performAdd] Kết quả ${addMethod}:`, addResult);
  } else if (typeof api.addUserToGroupChat === "function") {
    addMethod = "addUserToGroupChat";
    console.log(`[performAdd] Đang thử method: ${addMethod}`);
    addResult = await api.addUserToGroupChat(String(targetUID), String(threadID));
    console.log(`[performAdd] Kết quả ${addMethod}:`, addResult);
  } else {
    throw new Error("Library missing add group function");
  }

  if (isAddErrorResult(addResult)) {
    console.log(`[performAdd] ❌ ${addMethod} trả về error:`, addResult);
    throw new Error(addResult.error || addResult.err || "add group failed");
  }

  console.log(`[performAdd] ✓ ${addMethod} thành công, đang verify...`);
  const verify = await verifyMemberJoined(api, threadID, targetUID);
  if (verify.joined) {
    console.log(`[performAdd] ✅ User đã join nhóm!`);
    return api.sendMessage(
      `✅ Đã thêm UID ${targetUID} vào nhóm thành công.`,
      threadID,
      messageID,
    );
  }

  console.log(
    `[performAdd] ⚠️ ${addMethod} success nhưng verify fail, thử gcmember retry...`,
  );

  // Nhánh ws3-fca gcmember có thể chỉ publish MQTT rồi trả success sớm;
  // thử gửi lại 1 lần để tăng tỉ lệ vào nhóm thực tế.
  if (addMethod === "gcmember" && typeof api.gcmember === "function") {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(`[performAdd] Retry gcmember...`);
    const retryResult = await api.gcmember(
      "add",
      [String(targetUID)],
      String(threadID),
    );
    console.log(`[performAdd] Kết quả retry:`, retryResult);

    if (isAddErrorResult(retryResult)) {
      console.log(`[performAdd] ❌ Retry thất bại:`, retryResult);
      throw new Error(
        retryResult.error || retryResult.err || "gcmember retry failed",
      );
    }

    const verifyAfterRetry = await verifyMemberJoined(
      api,
      threadID,
      targetUID,
      5,
      1000,
    );
    if (verifyAfterRetry.joined) {
      console.log(`[performAdd] ✅ Retry thành công!`);
      return api.sendMessage(
        `✅ Đã thêm UID ${targetUID} vào nhóm thành công.`,
        threadID,
        messageID,
      );
    }

    // Fallback web-form add: thử endpoint messaging/send giống flow add truyền thống.
    console.log(`[performAdd] Thử web fallback method...`);
    const webFallback = await addUserToGroupViaWeb(api, threadID, targetUID);
    console.log(`[performAdd] Web fallback result:`, webFallback);
    
    if (webFallback.ok) {
      console.log(`[performAdd] Web fallback ok, verifying...`);
      const verifyAfterWeb = await verifyMemberJoined(
        api,
        threadID,
        targetUID,
        5,
        1000,
      );
      if (verifyAfterWeb.joined) {
        console.log(`[performAdd] ✅ Web fallback thành công!`);
        return api.sendMessage(
          `✅ Đã thêm UID ${targetUID} vào nhóm thành công.`,
          threadID,
          messageID,
        );
      }
      console.log(`[performAdd] Web fallback verify fail`);
    } else {
      console.log(`[performAdd] Web fallback error:`, webFallback.error);
    }
  }

  let latestThreadInfo = threadInfo;
  try {
    clearThreadInfoCache(threadID);
    latestThreadInfo = await getThreadInfoCached(api, threadID);
    console.log(
      `[performAdd] latestThreadInfo: participantIDs count=${latestThreadInfo?.participantIDs?.length || 0}, approvalQueue=${latestThreadInfo?.approvalQueue?.length || 0}, approvalMode=${latestThreadInfo?.approvalMode}`,
    );
  } catch (e) {
    console.error(`[performAdd] getThreadInfo error:`, e?.message);
    // giữ threadInfo cũ nếu fetch mới thất bại
  }

  const approvalQueue = latestThreadInfo?.approvalQueue || [];
  console.log(`[performAdd] approval queue:`, JSON.stringify(approvalQueue));

  const waitingApproval = approvalQueue.some(
    (q) => String(q?.requesterID) === String(targetUID),
  );

  if (waitingApproval || latestThreadInfo?.approvalMode) {
    console.log(
      `[performAdd] ⚠️ User pending approval: waitingApproval=${waitingApproval}, approvalMode=${latestThreadInfo?.approvalMode}`,
    );
    return api.sendMessage(
      `⚠️ Đã gửi lời mời UID ${targetUID}, nhưng chưa vào nhóm ngay.\nCó thể đang chờ duyệt/chờ xác nhận lời mời.`,
      threadID,
      messageID,
    );
  }

  console.log(`[performAdd] ❌ Tất cả method đều fail, tài khoản bị chặn`);
  
  // Better error message based on user info
  let errorMsg = `⚠️ Không thể add UID ${targetUID}.\n\n🔍 Có thể nguyên nhân:\n• Tài khoản bật chế độ chuyên nghiệp\n• Cấu hình quyền riêng tư cao\n• Chặn nhóm chat từ người lạ\n\n💡 Hãy thử:\n1. Kết bạn trực tiếp với user trước\n2. Kiểm tra privacy settings của user\n3. Thêm thủ công qua Facebook`;
  return api.sendMessage(errorMsg, threadID, messageID);
}

module.exports = {
  name: "add",
  description: "Mời thành viên vào nhóm bằng UID hoặc link Facebook",
  usage: `\n${prefix}add [uid] → Thêm bằng User ID\n${prefix}add [link Facebook] → Thêm bằng link profile\n━━━━━━━━━━━━━\n📌 Hỗ trợ link dạng: facebook.com/username hoặc fb://profile/id\n⚠️ Bot cần quyền QTV nhóm để thêm thành viên\n💡 Ví dụ: ${prefix}add 100012345678`,
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
      const threadInfo = await getThreadInfoCached(api, threadID);
      if (!threadInfo?.isGroup) {
        return api.sendMessage(
          "⚠️ Lệnh này chỉ dùng trong nhóm chat.",
          threadID,
          messageID,
        );
      }

      const adminIDs = toAdminIdList(threadInfo);
      const botID = String(api.getCurrentUserID());
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const adminBotUIDs = getAdminBotUIDs();
      const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

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

      console.log(
        `[add cmd] Execute bắt đầu: sender=${senderID}, group=${threadID}, input="${input}"`,
      );

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
        console.log(`[add cmd] Không resolve được UID từ input: ${input}`);
        return api.sendMessage(
          "❌ Không tìm được UID hợp lệ từ dữ liệu bạn nhập. Hãy thử UID số hoặc link profile Facebook.",
          threadID,
          messageID,
        );
      }

      console.log(
        `[add cmd] Resolve thành công: input="${input}" → UID=${targetUID}`,
      );

      if (String(targetUID) === botID) {
        return api.sendMessage(
          "⚠️ Không thể thêm chính bot vào nhóm này.",
          threadID,
          messageID,
        );
      }

      console.log(`[add cmd] Gọi performAddToGroup cho UID ${targetUID}`);
      return performAddToGroup({
        api,
        threadID,
        messageID,
        targetUID: String(targetUID),
        threadInfo,
      });
    } catch (e) {
      console.error(
        "[add cmd] Lỗi execute:",
        e?.message || String(e),
        "stack:",
        e?.stack,
      );
      return api.sendMessage(
        "❌ Không thể thêm thành viên. Có thể do quyền riêng tư của tài khoản hoặc bot chưa đủ quyền.",
        threadID,
        messageID,
      );
    }
  },
};
