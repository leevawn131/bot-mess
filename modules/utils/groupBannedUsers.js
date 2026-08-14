const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");
const BANNED_FILE = path.join(DATA_DIR, "group_banned_users.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BANNED_FILE)) {
    fs.writeFileSync(BANNED_FILE, JSON.stringify({}, null, 2));
  }
}

function readData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(BANNED_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    return {};
  }
}

function writeData(data) {
  ensureDataFile();
  fs.writeFileSync(BANNED_FILE, JSON.stringify(data, null, 2));
}

function isGroupBanned(threadID, userID) {
  if (!threadID || !userID) return false;
  const data = readData();
  const threadData = data[String(threadID)];
  if (!threadData || !Array.isArray(threadData)) return false;
  return threadData.some((item) => String(item.userID) === String(userID));
}

function banUserInGroup(threadID, userID, bannedBy = "") {
  if (!threadID || !userID) return false;
  const data = readData();
  const tid = String(threadID);
  if (!Array.isArray(data[tid])) data[tid] = [];

  const uid = String(userID);
  const exists = data[tid].some((item) => String(item.userID) === uid);
  if (!exists) {
    data[tid].push({
      userID: uid,
      bannedBy: String(bannedBy),
      bannedAt: new Date().toISOString(),
    });
    writeData(data);
  }
  return true;
}

function unbanUserInGroup(threadID, userID) {
  if (!threadID || !userID) return false;
  const data = readData();
  const tid = String(threadID);
  if (!Array.isArray(data[tid])) return false;

  const uid = String(userID);
  const initialLen = data[tid].length;
  data[tid] = data[tid].filter((item) => String(item.userID) !== uid);
  if (data[tid].length !== initialLen) {
    writeData(data);
    return true;
  }
  return false;
}

function getGroupBannedUsers(threadID) {
  if (!threadID) return [];
  const data = readData();
  return data[String(threadID)] || [];
}

module.exports = {
  isGroupBanned,
  banUserInGroup,
  unbanUserInGroup,
  getGroupBannedUsers,
};
