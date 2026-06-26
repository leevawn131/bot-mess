const { getThreadInfoCached } = require("./threadInfo");
const fs = require("fs");
const path = require("path");

// No mention overrides: prefer authoritative mapping and deterministic inference

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

function getUniqueUIDFromCandidates(candidates) {
  if (!candidates || candidates.size !== 1) return null;
  return String([...candidates][0] || "").trim() || null;
}

function splitMentionLabelQualifier(rawLabel) {
  const label = String(rawLabel || "").trim();
  const match = label.match(/^(.*?)(?:\s*\(([^()]+)\))\s*$/);
  if (!match) {
    return { baseLabel: label, qualifier: "" };
  }

  return {
    baseLabel: String(match[1] || "").trim(),
    qualifier: String(match[2] || "").trim().toLowerCase(),
  };
}

function pickUIDByQualifier(candidates, qualifier) {
  const list = Array.from(candidates || [])
    .map((uid) => String(uid || "").trim())
    .filter(Boolean);

  if (list.length === 0) return null;
  if (list.length === 1) return list[0];

  const normalized = String(qualifier || "").trim().toLowerCase();
  if (!normalized) return list[0];

  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized) - 1;
    return list[index] || null;
  }

  const letter = normalized.charCodeAt(0);
  if (letter >= 97 && letter <= 122) {
    const index = letter - 97;
    return list[index] || null;
  }

  return list[0];
}

async function getAuthoritativeThreadHistory(api, threadID, limit) {
  if (api && typeof api.getThreadHistory === "function") {
    try {
      return await api.getThreadHistory(threadID, limit, null);
    } catch (e) {}
  }

  if (typeof global._quietGetThreadHistory === "function") {
    try {
      return await global._quietGetThreadHistory(api, threadID, limit);
    } catch (e) {}
  }

  return null;
}

function findUniqueMemberUIDByLabel(threadInfo, rawLabel) {
  const { baseLabel, qualifier } = splitMentionLabelQualifier(rawLabel);
  const normalizedLabel = normalizeMentionLabel(baseLabel);
  if (!normalizedLabel) return null;

  const memberInfo = Array.isArray(threadInfo?.userInfo) ? threadInfo.userInfo : [];

  const exactMatches = memberInfo
    .map((user) => ({
      uid: String(user?.id || "").trim(),
      label: normalizeMentionLabel(user?.name || ""),
    }))
    .filter((item) => item.uid && item.label === normalizedLabel);



  if (exactMatches.length === 1) {
    return exactMatches[0].uid;
  }

  if (exactMatches.length > 1) {
    if (qualifier) {
      return pickUIDByQualifier(exactMatches.map((item) => item.uid), qualifier);
    }
    return null;
  }

  const labelToUIDs = indexMembersForLookup(threadInfo);

  if (normalizedLabel.length < 4) return null;

  const partialMatches = new Set();
  for (const [label, uids] of labelToUIDs.entries()) {
    if (!label || label.length < 4) continue;
    if (label.includes(normalizedLabel) || normalizedLabel.includes(label)) {
      for (const uid of uids) partialMatches.add(String(uid));
    }
  }

  return partialMatches.size === 1 ? [...partialMatches][0] : null;
}

async function remapMentionsByThreadInfo(api, threadID, entries, body) {
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
      // If multiple candidates, attempt qualifier-based disambiguation.
      if (candidates && candidates.size > 1) {
        // Check if the tag itself contains a qualifier like "Name (2)".
        const { qualifier, baseLabel } = splitMentionLabelQualifier(tag);
        let chosen = null;
        if (qualifier) {
          chosen = pickUIDByQualifier(candidates, qualifier);
        }

        // If not found in tag, try to locate a qualifier in the raw message body after the mention text.
        if (!chosen && typeof body === "string" && body.length > 0) {
          try {
            const esc = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const baseNoAt = String(baseLabel || "").replace(/^@+/, "").trim();
            const regex = new RegExp("@?" + esc(baseNoAt) + "\\s*\\(([^)]+)\\)", "i");
            const m = body.match(regex);
            if (m && m[1]) {
              chosen = pickUIDByQualifier(candidates, String(m[1] || "").trim().toLowerCase());
            }
          } catch (e) {}
        }

        if (chosen) return { id: String(chosen), tag };
      }
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
  const inferred = [];

  for (const rawLabel of labels) {
    const uid = findUniqueMemberUIDByLabel(threadInfo, rawLabel);
    if (!uid) continue;

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

  // Authoritative path: if the live event lost mention metadata, look up the
  // original message in thread history, where ws3-fca preserves entity.id.
  if (entries.length === 0) {
    try {
      const history = await getAuthoritativeThreadHistory(api, String(event.threadID || ""), 25);
      const original = findOriginalMessageFromHistory(history, event);
      if (original && original.mentions && Object.keys(original.mentions).length > 0) {
        event.mentions = mentionEntriesToMap(uniqueMentions(mentionMapToEntries(original.mentions)));
        entries = mentionMapToEntries(event.mentions || {});
      }
    } catch (e) {}
  }

  // Normalize mention keys if they look like numeric indices (some delta paths use indices)
  try {
    const rawMentions = event.mentions || {};
    const keys = Object.keys(rawMentions || {});
    const hasNonUidKey = keys.some((k) => !/^\d{6,}$/.test(k));
    if (keys.length > 0 && hasNonUidKey && threadInfo) {
      const participantIDs = Array.isArray(threadInfo.participantIDs)
        ? threadInfo.participantIDs
        : (Array.isArray(threadInfo.userInfo) ? threadInfo.userInfo.map((u) => String(u.id)) : []);
      if (participantIDs && participantIDs.length > 0) {
        const remapped = {};
        for (const [k, v] of Object.entries(rawMentions)) {
          if (/^\d+$/.test(k)) {
            const idx = Number(k);
            const uid = participantIDs[idx] || participantIDs[Number(k) - 1] || null;
            if (uid) remapped[String(uid)] = String(v || "");
            else remapped[String(k)] = String(v || "");
          } else {
            remapped[String(k)] = String(v || "");
          }
        }
        event.mentions = remapped;
      }
    }
  } catch (e) {}

  // Rebuild entries in case we changed event.mentions
  entries = mentionMapToEntries(event.mentions || {});

  if (entries.length === 0) {
    // Some ws3-fca builds expose getThreadHistory with a broken ctx binding.
    // Avoid calling it here; fall back to body/thread member inference only.
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
        console.log("[mentionResolver DEBUG] event:", JSON.stringify({
          messageID: event.messageID,
          threadID: event.threadID,
          senderID: event.senderID,
          body: event.body,
          mentions: event.mentions,
        }, null, 2));
        console.log("[mentionResolver DEBUG] threadInfo:", JSON.stringify(threadInfo || {}, null, 2));
        console.log("[mentionResolver DEBUG] parsed labels:", JSON.stringify(parseMentionLabelsFromBody(event.body), null, 2));
      } catch (e) {
        console.log("[mentionResolver DEBUG] debug dump failed", e);
      }
    }

    return event;
  }

  const remapped = threadInfo
    ? await remapMentionsByThreadInfo(api, event.threadID, entries, String(event.body || ""))
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