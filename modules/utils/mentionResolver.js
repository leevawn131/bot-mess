const { getThreadInfoCached } = require("./threadInfo");

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s@._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getThreadMembers(threadInfo) {
  const members = Array.isArray(threadInfo?.userInfo) ? threadInfo.userInfo : [];
  return members
    .map((member) => {
      const id = String(member?.id || member?.userFbId || "").trim();
      if (!id) return null;

      return {
        id,
        name: String(member?.name || member?.fullName || "").trim(),
        nickname: String(member?.nickname || member?.alternateName || "").trim(),
      };
    })
    .filter(Boolean);
}

function resolveMentionsFromText(body, threadMembers) {
  const text = normalizeText(body);
  const matches = [];
  const seen = new Set();

  const candidates = [...threadMembers]
    .map((member) => {
      const names = [member.name, member.nickname]
        .map((value) => normalizeText(value))
        .filter((value) => value && value.length >= 2);
      const bestName = names[0] || "";

      return {
        ...member,
        bestName,
        score: Math.max(...names.map((value) => value.length), 0),
      };
    })
    .filter((member) => member.bestName)
    .sort((a, b) => b.score - a.score);

  for (const member of candidates) {
    if (seen.has(member.id)) continue;

    const nameMatches = [member.name, member.nickname]
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .some((value) => text.includes(value));

    if (!nameMatches) continue;

    matches.push(member);
    seen.add(member.id);
  }

  return matches;
}

async function quietGetThreadHistory(api, threadID, limit) {
  const originalError = console.error;
  console.error = () => {};
  try {
    return await api.getThreadHistory(threadID, limit);
  } finally {
    console.error = originalError;
  }
}

async function ensureMentionsFromHistory(api, event) {
  if (!event?.body || !event.body.includes("@")) return event;

  const currentMentions = event.mentions && typeof event.mentions === "object" ? event.mentions : {};
  if (Object.keys(currentMentions).length > 0) return event;

  try {
    const threadInfo = await getThreadInfoCached(api, event.threadID);
    const threadMembers = getThreadMembers(threadInfo);
    const matchedMembers = resolveMentionsFromText(event.body, threadMembers);

    if (matchedMembers.length > 0) {
      event.mentions = matchedMembers.reduce((acc, member) => {
        acc[member.id] = `@${member.name || member.nickname || member.id}`;
        return acc;
      }, {});
      return event;
    }
  } catch {}

  try {
    const history = await quietGetThreadHistory(api, event.threadID, 5);
    const originalMsg = history.find((item) => item.messageID === event.messageID);
    if (originalMsg?.mentions && Object.keys(originalMsg.mentions).length > 0) {
      event.mentions = originalMsg.mentions;
    }
  } catch {}

  return event;
}

module.exports = {
  ensureMentionsFromHistory,
};