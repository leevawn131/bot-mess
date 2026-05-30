const { getThreadInfoCached } = require("./threadInfo");

function normalizeMentionLabel(text) {
  const raw = String(text || "").replace(/^@+/, "").replace(/\u200b/g, "");
  // Decompose accents, remove combining marks, normalize Vietnamese đ/Đ to d/D,
  // then collapse spaces and lowercase for comparison.
  try {
    const decomposed = raw.normalize("NFD").replace(/\p{M}/gu, "");
    const mapped = decomposed.replace(/\u0111/g, "d").replace(/\u0110/g, "D");
    return String(mapped).replace(/\s+/g, " ").trim().toLowerCase();
  } catch (e) {
    // Fallback for environments without Unicode property escapes
    const fallback = raw.replace(/[\u0300-\u036f]/g, "").replace(/\u0111/g, "d").replace(/\u0110/g, "D");
    return String(fallback).replace(/\s+/g, " ").trim().toLowerCase();
  }
}

function toTagText(rawTag, fallbackLabel = "") {
  const text = String(rawTag || "").trim();
  if (!text) {
    return fallbackLabel ? `@${String(fallbackLabel).trim()}` : "";
  }
  return text.startsWith("@") ? text : `@${text}`;
}

function extractMentionEntries(inputMentions) {
  if (!inputMentions) return [];

  if (Array.isArray(inputMentions)) {
    return inputMentions
      .map((item) => {
        const id = String(
          item?.id || item?.userID || item?.uid || item?.threadFbId || "",
        ).trim();
        const tag = toTagText(item?.tag || item?.text || item?.name || "");
        return { id, tag };
      })
      .filter((item) => item.id);
  }

  if (typeof inputMentions === "object") {
    return Object.entries(inputMentions)
      .map(([id, tag]) => ({
        id: String(id || "").trim(),
        tag: toTagText(tag),
      }))
      .filter((item) => item.id);
  }

  return [];
}

function mentionMapToEntries(mentions) {
  return extractMentionEntries(mentions);
}

function mentionEntriesToMap(entries) {
  const output = {};
  for (const item of entries) {
    if (!item?.id) continue;
    output[String(item.id)] = item?.tag || "";
  }
  return output;
}

function uniqueMentions(entries) {
  const seen = new Set();
  const output = [];

  for (const item of entries || []) {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({ id, tag: String(item?.tag || "") });
  }

  return output;
}

function addLabelIndex(labelMap, rawLabel, uid) {
  const label = normalizeMentionLabel(rawLabel);
  if (!label) return;

  if (!labelMap.has(label)) {
    labelMap.set(label, new Set());
  }
  labelMap.get(label).add(String(uid));
}

async function remapMentionsByThreadInfo(api, threadID, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return entries;

  let threadInfo = null;
  try {
    threadInfo = await getThreadInfoCached(api, threadID);
  } catch (e) {}

  if (!threadInfo || typeof threadInfo !== "object") return entries;

  const memberInfo = Array.isArray(threadInfo.userInfo) ? threadInfo.userInfo : [];
  const nicknames = threadInfo.nicknames && typeof threadInfo.nicknames === "object"
    ? threadInfo.nicknames
    : {};

  const labelToUIDs = new Map();
  for (const user of memberInfo) {
    const uid = String(user?.id || "").trim();
    if (!uid) continue;

    addLabelIndex(labelToUIDs, user?.name, uid);
    addLabelIndex(labelToUIDs, nicknames[uid], uid);
  }

  return entries.map((item) => {
    const uid = String(item?.id || "").trim();
    const tag = String(item?.tag || "").trim();
    if (!uid) return item;

    const normalizedTag = normalizeMentionLabel(tag);
    if (!normalizedTag) return { id: uid, tag };

    const candidates = labelToUIDs.get(normalizedTag);
    if (!candidates || candidates.size !== 1) {
      return { id: uid, tag };
    }

    const resolvedUID = [...candidates][0];
    return { id: String(resolvedUID), tag };
  });
}

function parseMentionLabelsFromBody(body) {
  const text = String(body || "");
  const labels = [];

  const mentionPattern = /@([^@\n]+)/g;
  let match;
  while ((match = mentionPattern.exec(text)) !== null) {
    const label = String(match[1] || "")
      .replace(/[.,!?;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (label) labels.push(label);
  }

  return labels;
}

function indexMembersForLookup(threadInfo) {
  const memberInfo = Array.isArray(threadInfo?.userInfo) ? threadInfo.userInfo : [];
  const nicknames =
    threadInfo?.nicknames && typeof threadInfo.nicknames === "object"
      ? threadInfo.nicknames
      : {};

  const labelToUIDs = new Map();
  for (const user of memberInfo) {
    const uid = String(user?.id || "").trim();
    if (!uid) continue;

    addLabelIndex(labelToUIDs, user?.name, uid);
    addLabelIndex(labelToUIDs, nicknames[uid], uid);
  }

  return labelToUIDs;
}

function inferMentionEntriesFromBody(threadInfo, body) {
  const labels = parseMentionLabelsFromBody(body);
  if (labels.length === 0) return [];

  const labelToUIDs = indexMembersForLookup(threadInfo);
  const inferred = [];

  for (const rawLabel of labels) {
    const normalized = normalizeMentionLabel(rawLabel);
    if (!normalized) continue;

    const candidates = labelToUIDs.get(normalized);
    if (!candidates || candidates.size !== 1) continue;

    const uid = [...candidates][0];
    inferred.push({
      id: String(uid),
      tag: toTagText(rawLabel),
    });
  }

  return inferred;
}

function findOriginalMessageFromHistory(history, event) {
  if (!Array.isArray(history) || !event) return null;

  const byMessageId = history.find(
    (item) => String(item?.messageID || "") === String(event.messageID || ""),
  );
  if (byMessageId) return byMessageId;

  const targetBody = String(event.body || "").trim();
  const targetSender = String(event.senderID || "");
  if (!targetBody || !targetSender) return null;

  return history.find(
    (item) =>
      String(item?.senderID || "") === targetSender &&
      String(item?.body || "").trim() === targetBody,
  );
}

async function ensureMentionsFromHistory(api, event) {
  try {
    console.log("[mentionResolver ENTRY]", JSON.stringify({ messageID: event?.messageID, threadID: event?.threadID, body: event?.body?.slice(0, 200) }, null, 2));
  } catch (e) {}

  if (!event?.body || !event.body.includes("@")) return event;

  let entries = mentionMapToEntries(event.mentions || {});

  let threadInfo = null;
  try {
    threadInfo = await getThreadInfoCached(api, event.threadID);
  } catch (e) {}

  if (entries.length === 0) {
    try {
      const history = await api.getThreadHistory(event.threadID, 15);
      const originalMsg = findOriginalMessageFromHistory(history, event);
      entries = mentionMapToEntries(originalMsg?.mentions || {});
    } catch (e) {}
  }

  if (entries.length === 0 && threadInfo) {
    entries = inferMentionEntriesFromBody(threadInfo, event.body);
  }

  if (entries.length === 0) {
    const shouldDebug =
      String(event.threadID || "") === "844251878447942" &&
      String(event.body || "").includes("Do Phuong");

    if (shouldDebug) {
      try {
        const history = await api.getThreadHistory(event.threadID, 15);
        console.log("[mentionResolver DEBUG] event:", JSON.stringify({
          messageID: event.messageID,
          threadID: event.threadID,
          senderID: event.senderID,
          body: event.body,
          mentions: event.mentions,
        }, null, 2));
        console.log("[mentionResolver DEBUG] threadInfo:", JSON.stringify(threadInfo || {}, null, 2));
        console.log(
          "[mentionResolver DEBUG] history:",
          JSON.stringify(
            (history || []).map((h) => ({ messageID: h.messageID, senderID: h.senderID, body: h.body, mentions: h.mentions })),
            null,
            2,
          ),
        );
      } catch (e) {
        console.log("[mentionResolver DEBUG] failed to fetch history for debug", e);
      }
    }

    return event;
  }

  const remapped = threadInfo
    ? await remapMentionsByThreadInfo(api, event.threadID, entries)
    : entries;
  event.mentions = mentionEntriesToMap(uniqueMentions(remapped));
  return event;
}

module.exports = {
  ensureMentionsFromHistory,
  // Exported for use by commands as a fallback when resolver didn't map mentions
  inferMentionEntriesFromBody,
  parseMentionLabelsFromBody,
};