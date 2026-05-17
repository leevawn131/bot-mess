const { execute, getConnection } = require("../../utils/database");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { checkCooldown } = require("../../utils/cooldown");
const {
  checkMinigameLimit,
  recordMinigameSuccess,
} = require("../../utils/minigameLimiter");
const { recordAction } = require("../../utils/questSystem");

const TAX_RATE = 0.05;
const AUTO_CLOSE_MS = 3 * 60 * 1000;

// Biến lưu trữ phiên (RAM)
global.baucuaSessions = global.baucuaSessions || {};
global.baucuaAutoCloseTimers = global.baucuaAutoCloseTimers || {};

// ID CỦA BOSS (NHÀ CÁI)
const BOSS_ID = "100037351338722";

const listBaucua = [
  { name: "bau", icon: "🍐" },
  { name: "cua", icon: "🦀" },
  { name: "tom", icon: "🦐" },
  { name: "ca", icon: "🐟" },
  { name: "ga", icon: "🐓" },
  { name: "nai", icon: "🦌" },
];

function getDBConfig() {
  try {
    const configPath = path.join(process.cwd(), "config.json");
    if (!fs.existsSync(configPath)) return null;
    const configFile = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const db = configFile.database;
    return {
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.name,
    };
  } catch (e) {
    return null;
  }
}

function resolveDBConfig(config) {
  const dbInfo = config?.database;
  if (dbInfo) {
    return {
      host: dbInfo.host,
      port: dbInfo.port,
      user: dbInfo.user,
      password: dbInfo.password,
      database: dbInfo.name,
    };
  }

  return getDBConfig();
}

function clearBaucuaTimer(threadID) {
  const key = String(threadID);
  const timer = global.baucuaAutoCloseTimers[key];
  if (timer) {
    clearTimeout(timer);
    delete global.baucuaAutoCloseTimers[key];
  }
}

async function finalizeBaucuaSession({
  api,
  threadID,
  dbConfig,
  autoClose = false,
}) {
  const key = String(threadID);
  const session = global.baucuaSessions[key];
  if (!session) return;
  if (session.status === "closing") return;
  session.status = "closing";

  const players = Object.values(session.players);
  if (players.length === 0) {
    clearBaucuaTimer(key);
    delete global.baucuaSessions[key];
    return api.sendMessage("⚠️ Phiên hủy do vắng khách.", key);
  }

  // LẮC XÚC XẮC
  const res = [];
  for (let i = 0; i < 3; i++) {
    res.push(crypto.randomInt(0, 6));
  }

  const resultIcons = res.map((i) => listBaucua[i].icon).join(" ");
  const resultNames = res.map((i) => listBaucua[i].name);

  const autoCloseText = autoClose ? "⏰ Hết 3 phút, bot tự xóc.\n" : "";
  let msg = `${autoCloseText}🎰 KẾT QUẢ (Phiên #${session.sessionID}): ${resultIcons}\n━━━━━━━━━━━━━━━━━━\n`;
  let totalBet = 0;
  let totalPay = 0;

  let connection;
  try {
    connection = await getConnection();
    for (const p of players) {
      totalBet += p.amount;

      const matchCount = resultNames.filter((name) => name === p.choice).length;

      if (matchCount > 0) {
        const grossWinAmount = p.amount * (matchCount + 1);
        const winProfit = p.amount * matchCount;
        const taxAmount = Math.floor(winProfit * TAX_RATE);
        const winAmount = grossWinAmount - taxAmount;
        const netProfit = Math.max(0, winProfit - taxAmount);
        totalPay += winAmount;

        await connection.execute(
          "UPDATE messenger_users SET credits = credits + ? WHERE psid = ?",
          [winAmount, p.id],
        );
        msg += `🟢 ${p.name}: ${p.choice.toUpperCase()} x${matchCount} (+${netProfit.toLocaleString()})\n`;
      } else {
        msg += `🔴 ${p.name}: ${p.choice.toUpperCase()} (-${p.amount.toLocaleString()})\n`;
      }
    }

    const netProfit = totalBet - totalPay;

    const [bossCheck] = await connection.execute(
      "SELECT credits FROM messenger_users WHERE psid = ?",
      [BOSS_ID],
    );
    if (bossCheck.length === 0) {
      const initialMoney = 1000000000 + netProfit;
      await connection.execute(
        "INSERT INTO messenger_users (psid, name, credits) VALUES (?, ?, ?)",
        [BOSS_ID, "BOSS NHÀ CÁI", initialMoney],
      );
    } else {
      await connection.execute(
        "UPDATE messenger_users SET credits = credits + ? WHERE psid = ?",
        [netProfit, BOSS_ID],
      );
    }
  } catch (e) {
    console.error(e);
    msg += "\n❌ Lỗi Database trả thưởng!";
  } finally {
    if (connection) connection.release();
  }

  clearBaucuaTimer(key);
  delete global.baucuaSessions[key];
  return api.sendMessage(msg, key);
}

function scheduleBaucuaAutoClose({ api, threadID, config }) {
  const key = String(threadID);
  clearBaucuaTimer(key);

  global.baucuaAutoCloseTimers[key] = setTimeout(async () => {
    try {
      const session = global.baucuaSessions[key];
      if (!session || session.status !== "open") return;

      const dbConfig = resolveDBConfig(config);
      if (!dbConfig) {
        clearBaucuaTimer(key);
        delete global.baucuaSessions[key];
        return api.sendMessage("❌ Lỗi cấu hình Database!", key);
      }

      await finalizeBaucuaSession({
        api,
        threadID: key,
        dbConfig,
        autoClose: true,
      });
    } catch (e) {
      console.error("[baucua] Lỗi tự kết phiên:", e);
    }
  }, AUTO_CLOSE_MS);
}

module.exports = {
  name: "baucua",
  description: "Bầu Cua",
  usage: "\n!baucua → Mở sòng Bầu Cua mới\n!baucua lac → Lắc đĩa kết thúc phiên (chủ sòng)\n━━━━━━━━━━━━━━━━━━\n🎲 Cược: Reply tin nhắn sòng + [bầu/cua/tôm/cá/gà/nai] [số_tiền]\n💰 Thuế thắng: 5% | Tự đóng sau 3 phút\n💡 Ví dụ: reply → cua 30000",

  execute: async ({ api, event, args, config }) => {
    const threadID = String(event.threadID);
    const senderID = String(event.senderID);
    const command = args[0]?.toLowerCase();

    // Cooldown 10s
    const cooldown = checkCooldown({
      command: "baucua",
      key: threadID,
      durationMs: 10000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi chơi tiếp!`,
        threadID,
      );
    }

    const dbConfig = resolveDBConfig(config);

    if (!dbConfig)
      return api.sendMessage("❌ Lỗi cấu hình Database!", threadID);

    // --- LỆNH: !baucua xoc (CHỐT PHIÊN) ---
    if (command === "xoc" || command === "so") {
      if (!global.baucuaSessions[threadID])
        return api.sendMessage("❌ Chưa mở phiên nào.", threadID);

      return finalizeBaucuaSession({
        api,
        threadID,
        dbConfig,
        autoClose: false,
      });
    }

    // --- LỆNH: !baucua (MỞ PHIÊN) ---
    else {
      if (global.baucuaSessions[threadID])
        return api.sendMessage(
          "⚠️ Đang có phiên rồi! Gõ !baucua xoc để chốt.",
          threadID,
        );

      // ANTI-SPAM: Tạo ID phiên ngẫu nhiên để nội dung tin nhắn luôn khác nhau
      const sessionID = Math.floor(Math.random() * 9999);
      const openMsg = `🎲 BẦU CUA OPEN! (Phiên #${sessionID})\n👑 Nhà cái: LeVan\n\nCách chơi: Reply (Trả lời) tin nhắn này:\n[Tên linh vật] [Tiền cược]\n\nLinh vật: bau, cua, tom, ca, ga, nai\n⏰ Tự xóc sau 3 phút nếu chưa ai chốt.`;

      try {
        const info = await api.sendMessage(openMsg, threadID);

        global.baucuaSessions[threadID] = {
          status: "open",
          sessionID: sessionID, // Lưu ID phiên
          messageID: info.messageID,
          players: {},
        };

        scheduleBaucuaAutoClose({ api, threadID, config });
      } catch (e) {
        // Bắt lỗi Spam Block 1390008
        if (e.error === 1390008) {
          console.error(
            "🔴 ACC BỊ BLOCK SPAM RỒI! Đợi 1-2 tiếng sau hãy chạy lại.",
          );
        } else {
          console.error("Lỗi gửi tin mở sòng:", e);
        }
      }
    }
  },

  handleReply: async ({ api, event }) => {
    const threadID = String(event.threadID);
    const senderID = String(event.senderID);
    const { body, messageReply, messageID } = event;

    if (!global.baucuaSessions[threadID]) return;
    if (!messageReply) return;

    if (String(messageReply.senderID) !== String(api.getCurrentUserID()))
      return;

    const session = global.baucuaSessions[threadID];
    if (session.status !== "open") return;

    if (senderID === BOSS_ID)
      return api.sendMessage("❌ Boss không được cược!", threadID, messageID);

    const limitCheck = checkMinigameLimit(senderID);
    if (!limitCheck.allowed) {
      return api.sendMessage(limitCheck.message, threadID, messageID);
    }

    const args = body.trim().split(/\s+/);
    const choice = args[0]?.toLowerCase();
    let amountStr = args[1];

    const validMascots = listBaucua.map((i) => i.name);
    if (!validMascots.includes(choice)) return;

    const dbConfig = getDBConfig();
    if (!dbConfig) return;

    let connection;
    try {
      connection = await getConnection();

      const [rows] = await connection.execute(
        "SELECT credits, name FROM messenger_users WHERE psid = ?",
        [senderID],
      );
      if (rows.length === 0)
        return api.sendMessage(
          "❌ Bạn chưa có tài khoản.",
          threadID,
          messageID,
        );

      const userBalance = parseInt(rows[0].credits);
      const userName = rows[0].name;

      let betAmount = 0;
      if (amountStr === "all" || amountStr === "tat") betAmount = userBalance;
      else betAmount = parseInt(amountStr);

      if (isNaN(betAmount) || betAmount <= 0)
        return api.sendMessage(
          "⚠️ Tiền cược không hợp lệ.",
          threadID,
          messageID,
        );
      if (userBalance < betAmount)
        return api.sendMessage(`💸 Không đủ tiền!`, threadID, messageID);
      if (session.players[senderID])
        return api.sendMessage("⚠️ Bạn đã cược rồi!", threadID, messageID);

      // Chặn cược > 500k nếu đang trong tù
      const [jailRows] = await connection.execute(
        "SELECT jail_until FROM user_jail WHERE psid = ? AND jail_until > NOW()",
        [senderID],
      );
      if (jailRows.length > 0 && betAmount > 500000) {
        const remainingMs = new Date(jailRows[0].jail_until) - new Date();
        const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const timeStr = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
        return api.sendMessage(
          `🔒 Bạn đang trong tù, chỉ được cược tối đa 500k.\n⏰ Còn lại: ${timeStr}`,
          threadID,
          messageID,
        );
      }

      // Giới hạn cược 200k nếu nợ quá hạn
      const [loanRows] = await connection.execute(
        "SELECT principal, taken_at, due_days FROM bank_loans WHERE psid = ?",
        [senderID],
      );
      const now = new Date();
      if (loanRows.length > 0) {
        const loan = loanRows[0];
        const takenAt = new Date(loan.taken_at);
        const dueDate = new Date(
          takenAt.getTime() + loan.due_days * 24 * 60 * 60 * 1000,
        );

        if (now > dueDate && betAmount > 200000) {
          const daysOverdue = Math.floor(
            (now - dueDate) / (1000 * 60 * 60 * 24),
          );
          return api.sendMessage(
            `⚠️ BẠN ĐANG NỢ TIỀN!\n━━━━━━━━━━━━━━━━━━\n Nợ quá hạn: ${daysOverdue} ngày\n💰 Số tiền vay: ${parseInt(loan.principal).toLocaleString()}\n📉 Cược tối đa: 200k (phục vụ trả nợ)\n━━━━━━━━━━━━━━━━━━\n💡 Trả nợ để cược bình thường!`,
            threadID,
            messageID,
          );
        }
      }

      await connection.execute(
        "UPDATE messenger_users SET credits = credits - ? WHERE psid = ?",
        [betAmount, senderID],
      );

      const minigameState = recordMinigameSuccess(senderID);

      try {
        recordAction(senderID, "bet_count", 1);
        recordAction(senderID, "bet_amount", betAmount);
      } catch (_) {}

      // Tăng games_played nếu cược >= 50k
      if (betAmount >= 50000) {
        await connection.execute(
          "UPDATE messenger_users SET games_played = games_played + 1 WHERE psid = ?",
          [senderID],
        );
      }

      session.players[senderID] = {
        id: senderID,
        name: userName,
        choice: choice,
        amount: betAmount,
      };

      api.setMessageReaction("✅", messageID, () => {}, true);

      if (minigameState.locked) {
        api.sendMessage(minigameState.message, threadID, messageID);
      }
    } catch (e) {
      console.error("Lỗi Baucua Reply:", e);
    } finally {
      if (connection) await connection.end();
    }
  },
};
