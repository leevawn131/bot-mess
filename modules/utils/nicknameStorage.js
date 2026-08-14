const fs = require("fs");
const path = require("path");

const DATA_PATH = path.resolve(__dirname, "../data/memberNicknames.json");

// Đảm bảo thư mục cha tồn tại
const dir = path.dirname(DATA_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Đọc dữ liệu biệt danh từ file JSON.
 * @returns {object} Dữ liệu biệt danh
 */
function readNicknames() {
  try {
    if (!fs.existsSync(DATA_PATH)) return {};
    const content = fs.readFileSync(DATA_PATH, "utf8").trim();
    if (!content) return {};
    return JSON.parse(content);
  } catch (err) {
    console.error("❌ Lỗi khi đọc file memberNicknames.json:", err);
    return {};
  }
}

/**
 * Ghi dữ liệu biệt danh vào file JSON.
 * @param {object} data - Dữ liệu biệt danh
 */
function writeNicknames(data) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 4), "utf8");
  } catch (err) {
    console.error("❌ Lỗi khi ghi file memberNicknames.json:", err);
  }
}

/**
 * Lưu hoặc cập nhật biệt danh của một thành viên trong nhóm.
 * @param {string} threadID - ID nhóm
 * @param {string} userID - ID người dùng
 * @param {string} nickname - Biệt danh mới
 */
async function saveNickname(threadID, userID, nickname) {
  try {
    const data = readNicknames();
    const threadKey = String(threadID);
    const userKey = String(userID);
    const cleanNickname = nickname ? String(nickname).trim() : "";

    if (!data[threadKey]) {
      data[threadKey] = {};
    }

    data[threadKey][userKey] = cleanNickname;
    writeNicknames(data);
  } catch (err) {
    console.error(`❌ Lỗi khi lưu biệt danh cho user ${userID} tại thread ${threadID}:`, err);
  }
}

/**
 * Lưu hoặc cập nhật biệt danh hàng loạt từ đối tượng nicknames của nhóm.
 * @param {string} threadID - ID nhóm
 * @param {object} nicknamesObj - Object dạng { [userID]: nickname }
 */
async function saveAllNicknames(threadID, nicknamesObj) {
  if (!nicknamesObj || typeof nicknamesObj !== "object") return;
  try {
    const data = readNicknames();
    const threadKey = String(threadID);

    if (!data[threadKey]) {
      data[threadKey] = {};
    }

    let hasChange = false;
    for (const [userID, nickname] of Object.entries(nicknamesObj)) {
      if (nickname && String(nickname).trim() !== "") {
        data[threadKey][String(userID)] = String(nickname).trim();
        hasChange = true;
      }
    }

    if (hasChange) {
      writeNicknames(data);
    }
  } catch (err) {
    console.error(`❌ Lỗi khi lưu danh sách biệt danh của thread ${threadID}:`, err);
  }
}

/**
 * Lấy biệt danh đã lưu của một thành viên trong nhóm.
 * @param {string} threadID - ID nhóm
 * @param {string} userID - ID người dùng
 * @returns {Promise<string|null>} Biệt danh hoặc null nếu không có
 */
async function getNickname(threadID, userID) {
  try {
    const data = readNicknames();
    const threadKey = String(threadID);
    const userKey = String(userID);

    if (data[threadKey] && data[threadKey][userKey]) {
      return data[threadKey][userKey];
    }
    return null;
  } catch (err) {
    console.error(`❌ Lỗi khi lấy biệt danh cho user ${userID} tại thread ${threadID}:`, err);
    return null;
  }
}

/**
 * Kiểm tra xem người dùng có dữ liệu tương tác trong nhóm hay không.
 * @param {string} threadID - ID nhóm
 * @param {string} userID - ID người dùng
 * @returns {Promise<boolean>} Có tương tác hay không
 */
async function hasInteraction(threadID, userID) {
  try {
    const threadKey = String(threadID);
    const userKey = String(userID);

    // 1. Kiểm tra trong memberNicknames.json (nếu có biệt danh đã lưu -> là thành viên cũ)
    const nicknamesData = readNicknames();
    if (nicknamesData[threadKey] && nicknamesData[threadKey][userKey]) {
      return true;
    }

    // 2. Kiểm tra trong message_stats.json (thống kê tin nhắn)
    const statsPath = path.resolve(__dirname, "../../message_stats.json");
    if (fs.existsSync(statsPath)) {
      try {
        const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
        const threadStats = stats[threadKey];
        if (threadStats && threadStats[userKey]) {
          const userStats = threadStats[userKey];
          if (typeof userStats === "object" && Number(userStats.total || 0) > 0) return true;
          if (typeof userStats === "number" && userStats > 0) return true;
        }
      } catch (e) {}
    }

    // 3. Kiểm tra trong SQLite Database (messenger_users)
    try {
      const { execute } = require("./database");
      const rows = await execute(
        "SELECT id, total_exp, credits FROM messenger_users WHERE thread_id = ? AND psid = ?",
        [threadKey, userKey]
      );
      if (rows && rows.length > 0) {
        if (Number(rows[0].total_exp || 0) > 0 || Number(rows[0].credits || 0) !== 10000) {
          return true;
        }
      }
    } catch (e) {}

    return false;
  } catch (err) {
    console.error("❌ Lỗi khi kiểm tra tương tác người dùng:", err);
    return false;
  }
}

module.exports = {
  saveNickname,
  saveAllNicknames,
  getNickname,
  hasInteraction
};
