const fs = require("fs");
const path = require("path");

const HISTORY_PATH = path.join(__dirname, "../../cache/leave_history.json");
const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES_PER_THREAD = 1500;

function ensureHistoryDir() {
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
}

function readLeaveHistory() {
    try {
        if (!fs.existsSync(HISTORY_PATH)) return {};
        return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    } catch {
        return {};
    }
}

function writeLeaveHistory(history) {
    ensureHistoryDir();
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function getZonedParts(input = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
    const date = input instanceof Date ? input : new Date(input);
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });

    const parts = {};
    for (const part of formatter.formatToParts(date)) {
        if (part.type !== "literal") {
            parts[part.type] = part.value;
        }
    }

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second)
    };
}

function getWeekKey(year, month, day) {
    const weekDate = new Date(Date.UTC(year, month - 1, day));
    const weekDay = (weekDate.getUTCDay() + 6) % 7;
    weekDate.setUTCDate(weekDate.getUTCDate() - weekDay + 3);

    const firstThursday = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 4));
    const firstWeekDay = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekDay + 3);

    const weekNumber = 1 + Math.round((weekDate - firstThursday) / (7 * 24 * 60 * 60 * 1000));
    return `${weekDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function getTimeKeys(input = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
    const parts = getZonedParts(input, timeZone);
    const dayKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    const monthKey = `${parts.year}-${String(parts.month).padStart(2, "0")}`;
    const weekKey = getWeekKey(parts.year, parts.month, parts.day);

    return {
        dayKey,
        weekKey,
        monthKey
    };
}

function formatTimestamp(input, options = {}) {
    const { includeDate = true, includeSeconds = true, timeZone = DEFAULT_TIME_ZONE } = options;
    const parts = getZonedParts(input, timeZone);
    const datePart = `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
    const timePart = includeSeconds
        ? `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`
        : `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;

    return includeDate ? `${timePart} ${datePart}` : timePart;
}

function buildProfileLink(uid) {
    return `https://fb.com/${String(uid)}`;
}

function normalizeHistoryEntry(raw) {
    if (!raw || typeof raw !== "object") return null;

    const uid = String(raw.uid || "").trim();
    const leftAt = Number(raw.leftAt || Date.now());
    if (!uid || !Number.isFinite(leftAt)) return null;

    return {
        uid,
        name: String(raw.name || "Thành viên").trim() || "Thành viên",
        leftAt,
        action: raw.action === "kick" ? "kick" : "self",
        actorID: raw.actorID ? String(raw.actorID) : null
    };
}

function pruneEntries(entries, now = Date.now()) {
    return (Array.isArray(entries) ? entries : [])
        .map(normalizeHistoryEntry)
        .filter(Boolean)
        .filter((entry) => (now - entry.leftAt) <= MAX_AGE_MS)
        .sort((a, b) => b.leftAt - a.leftAt)
        .slice(0, MAX_ENTRIES_PER_THREAD);
}

function addLeaveHistoryEntry(threadID, entry) {
    const threadKey = String(threadID);
    const normalized = normalizeHistoryEntry(entry);
    if (!normalized) return null;

    const history = readLeaveHistory();
    const currentEntries = Array.isArray(history[threadKey]) ? history[threadKey] : [];
    const nextEntries = pruneEntries([normalized, ...currentEntries]);
    history[threadKey] = nextEntries;
    writeLeaveHistory(history);
    return normalized;
}

function removeLeaveHistoryEntries(threadID, uids) {
    const threadKey = String(threadID);
    const targetUIDs = new Set(
        (Array.isArray(uids) ? uids : [uids])
            .map((uid) => String(uid || "").trim())
            .filter(Boolean)
    );

    if (targetUIDs.size === 0) return 0;

    const history = readLeaveHistory();
    const currentEntries = Array.isArray(history[threadKey]) ? history[threadKey] : [];
    if (currentEntries.length === 0) return 0;

    const nextEntries = currentEntries.filter((entry) => !targetUIDs.has(String(entry?.uid || "")));
    const removedCount = currentEntries.length - nextEntries.length;

    if (removedCount > 0) {
        history[threadKey] = pruneEntries(nextEntries);
        writeLeaveHistory(history);
    }

    return removedCount;
}

function getLeaveHistoryByPeriod(threadID, period, now = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
    const threadKey = String(threadID);
    const history = readLeaveHistory();
    const currentEntries = Array.isArray(history[threadKey]) ? history[threadKey] : [];
    const entries = pruneEntries(currentEntries, now);
    const currentKeys = getTimeKeys(now, timeZone);

    if (entries.length !== currentEntries.length) {
        history[threadKey] = entries;
        writeLeaveHistory(history);
    }

    const periodKeyMap = {
        day: "dayKey",
        week: "weekKey",
        month: "monthKey"
    };

    const targetKeyName = periodKeyMap[period];
    if (!targetKeyName) return [];
    const targetValue = currentKeys[targetKeyName];

    return entries.filter((entry) => getTimeKeys(entry.leftAt, timeZone)[targetKeyName] === targetValue);
}

module.exports = {
    HISTORY_PATH,
    buildProfileLink,
    addLeaveHistoryEntry,
    formatTimestamp,
    getLeaveHistoryByPeriod,
    getTimeKeys,
    removeLeaveHistoryEntries,
    readLeaveHistory,
    writeLeaveHistory
};