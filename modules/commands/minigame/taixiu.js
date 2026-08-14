const { execute, getConnection } = require("../../utils/database");
const path = require("path");
const fs = require("fs");
const { checkCooldown } = require("../../utils/cooldown");
const {
  checkMinigameLimit,
  recordMinigameSuccess,
} = require("../../utils/minigameLimiter");
const { recordAction } = require("../../utils/questSystem");
const { parseMoneyAmount } = require("../../utils/parseMoney");
const prefix = process.env.BOT_PREFIX;

const TAX_RATE = 0.05;
const AUTO_CLOSE_MS = 3 * 60 * 1000;
const SOICAU_HISTORY_FILE = path.join(
  __dirname,
  "../../cache",
  "taixiu_soicau_history.json",
);
const MAX_SOICAU_PER_THREAD = 30;

// Biến lưu trữ phiên (RAM)
global.taixiuSessions = global.taixiuSessions || {};
global.taixiuSoiCauHistory = global.taixiuSoiCauHistory || null;
global.taixiuAutoCloseTimers = global.taixiuAutoCloseTimers || {};

// ID CỦA BOSS (NHÀ CÁI - Tiền vẫn chảy về đây ngầm)
const BOSS_ID = "100037351338722";
// Hàm normalize tiếng Việt (loại bỏ dấu)
function normalizeChoice(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}


// Hàm đọc config thủ công an toàn
function getDBConfig() {
  try {
    let configPath = path.join(process.cwd(), "config.json");
    if (!fs.existsSync(configPath)) {
      configPath = path.join(__dirname, "../../config.json");
    }
    if (!fs.existsSync(configPath)) return { type: "sqlite" };
    const configFile = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const db = configFile.database || {};
    return {
      host: db.host || "localhost",
      port: db.port || 3306,
      user: db.user || "root",
      password: db.password || "",
      database: db.name || "bot",
    };
  } catch (e) {
    return { type: "sqlite" };
  }
}

function ensureSoiCauStore() {
  if (global.taixiuSoiCauHistory) return global.taixiuSoiCauHistory;

  try {
    const dirPath = path.dirname(SOICAU_HISTORY_FILE);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    if (!fs.existsSync(SOICAU_HISTORY_FILE)) {
      fs.writeFileSync(
        SOICAU_HISTORY_FILE,
        JSON.stringify({}, null, 2),
        "utf8",
      );
    }

    const raw = fs.readFileSync(SOICAU_HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    global.taixiuSoiCauHistory =
      typeof parsed === "object" && parsed ? parsed : {};
  } catch (e) {
    global.taixiuSoiCauHistory = {};
  }

  return global.taixiuSoiCauHistory;
}

function saveSoiCauStore(store) {
  try {
    const dirPath = path.dirname(SOICAU_HISTORY_FILE);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(
      SOICAU_HISTORY_FILE,
      JSON.stringify(store, null, 2),
      "utf8",
    );
  } catch (e) {
    console.error("[taixiu] Không lưu được lịch sử soi cầu:", e);
  }
}

function addSoiCauHistory(threadID, entry) {
  const store = ensureSoiCauStore();
  const key = String(threadID);

  if (!Array.isArray(store[key])) {
    store[key] = [];
  }

  store[key].push(entry);
  if (store[key].length > MAX_SOICAU_PER_THREAD) {
    store[key] = store[key].slice(-MAX_SOICAU_PER_THREAD);
  }

  saveSoiCauStore(store);
}

function formatSoiCauLine(index, item) {
  const round = `#${index.toString().padStart(2, "0")}`;
  const result = String(item.result || "").toLowerCase();
  const resultLabel =
    result === "tai" ? "TAI" : result === "xiu" ? "XIU" : result === "bao" ? "BAO" : "KHAC";
  const d1 = Number(item.dice1) || 0;
  const d2 = Number(item.dice2) || 0;
  const d3 = Number(item.dice3) || 0;
  const total = Number(item.total) || d1 + d2 + d3;
  const sessionText = item.sessionID ? ` | Phien #${item.sessionID}` : "";

  return `${round}${sessionText}: ${resultLabel} (${d1}-${d2}-${d3}) = ${total}`;
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

function clearTaixiuTimer(threadID) {
  const key = String(threadID);
  const timer = global.taixiuAutoCloseTimers[key];
  if (timer) {
    clearTimeout(timer);
    delete global.taixiuAutoCloseTimers[key];
  }
}

async function finalizeTaixiuSession({
  api,
  threadID,
  dbConfig,
  autoClose = false,
}) {
  const key = String(threadID);
  const session = global.taixiuSessions[key];
  if (!session) return;
  if (session.status === "closing") return;
  session.status = "closing";

  const players = Object.values(session.players);

  if (players.length === 0) {
    clearTaixiuTimer(key);
    delete global.taixiuSessions[key];
    return api.sendMessage("⚠️ Phiên hủy do không ai chơi.", key);
  }

  // TUNG XÚC XẮC
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const d3 = Math.floor(Math.random() * 6) + 1;
  const total = d1 + d2 + d3;

  const diceIcons = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  const resultIcon = `${diceIcons[d1 - 1]} ${diceIcons[d2 - 1]} ${diceIcons[d3 - 1]}`;

  const isBao = d1 === d2 && d2 === d3;
  let resultText = "thua";
  if (isBao) {
    resultText = "bao";
  } else if (total >= 4 && total <= 10) {
    resultText = "xiu";
  } else if (total >= 11 && total <= 17) {
    resultText = "tai";
  }

  addSoiCauHistory(key, {
    sessionID: session.sessionID,
    result: resultText,
    total,
    dice1: d1,
    dice2: d2,
    dice3: d3,
    createdAt: Date.now(),
  });

  // TÍNH TIỀN
  let totalBet = 0;
  let totalPay = 0;
  const autoCloseText = autoClose ? "⏰ Hết 3 phút, bot tự xóc.\n" : "";
  let msg = "";
  if (isBao) {
    msg += `💥💥💥 BÃO !!! BÃO TO CẬN CẢNH !!! 💥💥💥\n`;
    msg += `🎰 KẾT QUẢ (Phiên #${session.sessionID}): [ ${resultIcon} ]\n`;
    msg += `🎲 Cả 3 xúc xắc đều ra mặt: ${d1} (Tổng: ${total})\n`;
    msg += `🔥 TẤT CẢ CÁC CỬA TÀI & XỈU ĐỀU BỊ NHÀ CÁI NUỐT SẠCH! 🔥\n`;
  } else {
    msg += `${autoCloseText}🎰 KẾT QUẢ (Phiên #${session.sessionID}): ${resultIcon}\nTổng: ${total} - ${resultText.toUpperCase()}\n`;
  }
  msg += `━━━━━━━━━━━━━\n`;

  let connection;
  try {
    connection = await getConnection();

    for (const p of players) {
      totalBet += p.amount;

      // Check VIP va lucky cua nguoi choi
      const [userCheck] = await connection.execute(
        "SELECT vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?",
        [key, p.id],
      );
      const hasVIP =
        userCheck[0]?.vip_until &&
        new Date(userCheck[0].vip_until) > new Date();

      const [luckyCheck] = await connection.execute(
        'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "luck" AND uses_left > 0',
        [p.id],
      );
      const hasLucky = luckyCheck.length > 0;

      const isWin = p.choice === resultText;
      let statusIcon = "🔴";
      let changeText = `-${p.amount.toLocaleString('vi-VN')}`;

      if (isWin) {
        statusIcon = "🟢";
        const grossPayout = p.amount * 2;
        const winProfit = p.amount;
        const taxAmount = Math.floor(winProfit * TAX_RATE);
        const payout = grossPayout - taxAmount;
        const netProfit = Math.max(0, winProfit - taxAmount);
        changeText = `+${netProfit.toLocaleString('vi-VN')}`;
        totalPay += payout;

        await connection.execute(
          "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
          [payout, key, p.id],
        );

        // Tru lucky uses
        if (hasLucky) {
          await connection.execute(
            'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "luck"',
            [p.id],
          );
        }
      } else {
        // Thua, VIP hoan 5%
        let refund = 0;
        if (hasVIP) {
          const grossRefund = Math.floor(p.amount * 0.05);
          const refundTax = Math.floor(grossRefund * TAX_RATE);
          refund = Math.max(0, grossRefund - refundTax);
          await connection.execute(
            "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
            [refund, key, p.id],
          );
          totalPay += refund;
        }

        // Tru lucky uses du thua
        if (hasLucky) {
          await connection.execute(
            'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "luck"',
            [p.id],
          );
        }
      }

      let extraInfo = "";
      if (hasLucky) extraInfo += " 🍀";
      if (hasVIP && !isWin) {
        const grossRefund = Math.floor(p.amount * 0.05);
        const refundTax = Math.floor(grossRefund * TAX_RATE);
        const netRefund = Math.max(0, grossRefund - refundTax);
        extraInfo += ` (+${netRefund.toLocaleString('vi-VN')})`;
      }

      msg += `${statusIcon} ${p.name}: ${p.choice.toUpperCase()} (${changeText})${extraInfo}\n`;
    }

    // Xoa lucky het luot
    await connection.execute("DELETE FROM active_effects WHERE uses_left <= 0");

    // --- XỬ LÝ TIỀN BOSS (CHẠY NGẦM) ---
    const netProfit = totalBet - totalPay;

    const [bossCheck] = await connection.execute(
      "SELECT credits FROM messenger_users WHERE thread_id = ? AND psid = ?",
      [key, BOSS_ID],
    );

    if (bossCheck.length === 0) {
      const initialMoney = 1000000000 + netProfit;
      await connection.execute(
        "INSERT INTO messenger_users (thread_id, psid, name, credits) VALUES (?, ?, ?, ?)",
        [key, BOSS_ID, "BOSS NHÀ CÁI", initialMoney],
      );
    } else {
      await connection.execute(
        "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
        [netProfit, key, BOSS_ID],
      );
    }
  } catch (e) {
    console.error(e);
    msg += "\n❌ Lỗi Database!";
  } finally {
    if (connection) connection.release();
  }

  clearTaixiuTimer(key);
  delete global.taixiuSessions[key];
  if (typeof api.sendMessageEffect === "function") {
    return api.sendMessageEffect({ body: msg, effect: "GIFTWRAP" }, key);
  }
  return api.sendMessage(msg, key);
}

function scheduleTaixiuAutoClose({ api, threadID, config }) {
  const key = String(threadID);
  clearTaixiuTimer(key);

  global.taixiuAutoCloseTimers[key] = setTimeout(async () => {
    try {
      const session = global.taixiuSessions[key];
      if (!session || session.status !== "open") return;
      const dbConfig = resolveDBConfig(config);
      if (!dbConfig) {
        clearTaixiuTimer(key);
        delete global.taixiuSessions[key];
        return api.sendMessage("❌ Lỗi cấu hình Database!", key);
      }

      await finalizeTaixiuSession({
        api,
        threadID: key,
        dbConfig,
        autoClose: true,
      });
    } catch (e) {
      console.error("[taixiu] Lỗi tự kết phiên:", e);
    }
  }, AUTO_CLOSE_MS);
}

module.exports = {
  name: "taixiu",
  description: "Tài Xỉu (Anti-Spam Edition)",
  usage: `\n${prefix}taixiu → Mở sòng Tài Xỉu mới\n${prefix}taixiu xoc → Xóc đĩa kết thúc phiên (chủ sòng)\n${prefix}taixiu soicau → Xem lịch sử kết quả gần nhất\n━━━━━━━━━━━━━\n🎲 Cược: Reply tin nhắn sòng + [tài/xỉu] [số_tiền]\n💰 Thuế thắng: 5% | Tự đóng sau 3 phút\n💡 Ví dụ: reply → tai 50000`,

  execute: async ({ api, event, args, config }) => {
    const { threadID, senderID } = event;
    const command = args[0]?.toLowerCase();
    const prefix = config?.prefix || "!";

    // --- LỆNH: !taixiu soicau (XEM LỊCH SỬ BÀN) ---
    if (command === "soicau") {
      const store = ensureSoiCauStore();
      const history = Array.isArray(store[String(threadID)])
        ? store[String(threadID)]
        : [];

      if (history.length === 0) {
        return api.sendMessage(
          "📉 Bàn này chưa có dữ liệu soi cầu. Hãy chơi vài phiên rồi thử lại.",
          threadID,
        );
      }

      const recent = history.slice(-15);
      const lines = recent.map((item, idx) => formatSoiCauLine(idx + 1, item));
      const msg = `📊 SOI CẦU TÀI XỈU (15 phiên gần nhất)\nBàn: ${threadID}\n━━━━━━━━━━━━━\n${lines.join("\n")}\n\n⏰ Tin nhắn này sẽ tự động gỡ sau 45s.`;
      
      try {
        const info = await api.sendMessage(msg, threadID);
        setTimeout(async () => {
          try {
            await api.unsendMessage(info.messageID);
          } catch (_) {}
        }, 45000);
      } catch (e) {
        console.error("[taixiu] Lỗi gửi tin soi cầu:", e);
      }
      return;
    }

    // Cooldown 10s - CHỈ cho lệnh mở phiên hoặc chốt phiên
    const cooldown = checkCooldown({
      command: "taixiu",
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

    const key = String(threadID);

    // --- LỆNH: !taixiu xoc (CHỐT PHIÊN) ---
    if (command === "xoc" || command === "so") {
      if (!global.taixiuSessions[key])
        return api.sendMessage("❌ Chưa mở phiên nào.", key);

      return finalizeTaixiuSession({
        api,
        threadID: key,
        dbConfig,
        autoClose: false,
      });
    }

    // --- LỆNH: !taixiu (MỞ PHIÊN) ---
    else {
      if (global.taixiuSessions[key])
        return api.sendMessage(
          `⚠️ Đang có phiên rồi! Gõ ${prefix}taixiu xoc để chốt.`,
          key,
        );

      // ANTI-SPAM: Tạo ID phiên ngẫu nhiên
      const sessionID = Math.floor(Math.random() * 9999);
      const openMsg = `🎲 SÒNG BẠC ONLINE! (Phiên #${sessionID})\n👑 Nhà cái: LeVan\n\nCách chơi: Reply (Trả lời) tin nhắn này:\n[Tai/Xiu] [Số tiền]\n${prefix}taixiu xoc để xóc\n⏰ Tự xóc sau 3 phút nếu chưa ai chốt.`;

      // Tạo session ngay lập tức để tránh mất session nếu api.sendMessage gặp lỗi nhẹ hay trả về undefined info
      global.taixiuSessions[key] = {
        status: "open",
        sessionID: sessionID,
        author: senderID,
        messageID: null,
        players: {},
      };

      try {
        const info = await api.sendMessage(openMsg, key);
        if (info && info.messageID) {
          global.taixiuSessions[key].messageID = info.messageID;
        }
        scheduleTaixiuAutoClose({ api, threadID: key, config });
      } catch (e) {
        if (e.error === 1390008) {
          delete global.taixiuSessions[key];
          console.error("🔴 Bot bị chặn Spam (1390008). Hãy nghỉ ngơi.");
        } else {
          console.error("Lỗi gửi tin nhắn mở sòng:", e);
          scheduleTaixiuAutoClose({ api, threadID: key, config });
        }
      }
    }
  },

  // 2. XỬ LÝ REPLY
  handleReply: async ({ api, event, config }) => {
    const prefix = config?.prefix || "!";
    const { threadID, senderID, body, messageReply, messageID } = event;
    const key = String(threadID);

    if (!global.taixiuSessions[key]) return;
    if (!messageReply) return;

    const session = global.taixiuSessions[key];
    if (session.status !== "open") return;

    const isSessionReply =
      (session.messageID && String(messageReply.messageID) === String(session.messageID)) ||
      (messageReply.body && messageReply.body.includes("SÒNG BẠC ONLINE"));

    if (!isSessionReply) return;

    if (senderID === BOSS_ID)
      return api.sendMessage("❌ Boss không được cược!", threadID, messageID);

    const limitCheck = checkMinigameLimit(senderID);
    if (!limitCheck.allowed) {
      return api.sendMessage(limitCheck.message, threadID, messageID);
    }

    let cleanBody = (body || "").trim();
    // Strip leading prefix and command name if user included them in reply (e.g. /taixiu tai 5000, !taixiu tài 50k)
    cleanBody = cleanBody.replace(/^[\/!.]?(taixiu|tx)\s+/i, "");

    const args = cleanBody.split(/\s+/);
    const normalizedChoice = normalizeChoice(args[0] || "");
    if (!["tai", "xiu"].includes(normalizedChoice)) return;

    let amountStr = args[1];

    const dbConfig = getDBConfig();
    if (!dbConfig) return;

    let connection;
    try {
      connection = await getConnection();

      const [rows] = await connection.execute(
        "SELECT credits, name, vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?",
        [String(threadID), senderID],
      );
      if (rows.length === 0)
        return api.sendMessage(
          `❌ Bạn chưa có tài khoản\n(dùng ${prefix}tien để tạo TK).`,
          threadID,
          messageID,
        );

      const userBalance = parseInt(rows[0].credits);
      const userName = rows[0].name;

      // Check VIP
      const hasVIP =
        rows[0].vip_until && new Date(rows[0].vip_until) > new Date();

      // Check lucky
      const [luckyCheck] = await connection.execute(
        'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "luck" AND uses_left > 0',
        [senderID],
      );
      const hasLucky = luckyCheck.length > 0;

      let betAmount = 0;
      if (amountStr === "all" || amountStr === "tat") {
        betAmount = userBalance;
      } else if (amountStr && typeof amountStr === "string" && amountStr.endsWith("%")) {
        const percentStr = amountStr.slice(0, -1);
        const percent = parseFloat(percentStr);
        if (!isNaN(percent) && percent > 0 && percent <= 100) {
          betAmount = Math.floor((userBalance * percent) / 100);
        } else {
          return api.sendMessage("⚠️ Phần trăm cược không hợp lệ (phải từ 1% đến 100%).", threadID, messageID);
        }
      } else {
        betAmount = parseMoneyAmount(amountStr);
      }

      if (isNaN(betAmount) || betAmount <= 0)
        return api.sendMessage("⚠️ Tiền cược không hợp lệ. Ví dụ reply tin nhắn sòng: tai 5000 hoặc xiu 50k", threadID, messageID);
      if (userBalance < betAmount)
        return api.sendMessage(`💸 Không đủ tiền!`, threadID, messageID);
      if (session.players[senderID])
        return api.sendMessage("⚠️ Bạn đã cược rồi!", threadID, messageID);

      // Chặn cược > 500k nếu đang trong tù
      const [jailRows] = await connection.execute(
        "SELECT jail_until FROM user_jail WHERE thread_id = ? AND psid = ? AND jail_until > datetime('now', 'localtime')",
        [String(threadID), senderID],
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
        "SELECT principal, taken_at, due_days FROM bank_loans WHERE thread_id = ? AND psid = ?",
        [String(threadID), senderID],
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
            `⚠️ BẠN ĐANG NỢ TIỀN!\n━━━━━━━━━━━━━\n Nợ quá hạn: ${daysOverdue} ngày\n💰 Số tiền vay: ${parseInt(loan.principal).toLocaleString('vi-VN')}\n📉 Cược tối đa: 200k (phục vụ trả nợ)\n━━━━━━━━━━━━━\n💡 Trả nợ để cược bình thường!`,
            threadID,
            messageID,
          );
        }
      }

      // Trừ tiền
      await connection.execute(
        "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
        [betAmount, String(threadID), senderID],
      );

      const minigameState = recordMinigameSuccess(senderID);

      try {
        recordAction(senderID, "bet_count", 1);
        recordAction(senderID, "bet_amount", betAmount);
      } catch (_) {}

      // Tăng games_played nếu cược >= 50k
      if (betAmount >= 50000) {
        await connection.execute(
          "UPDATE messenger_users SET games_played = games_played + 1 WHERE thread_id = ? AND psid = ?",
          [String(threadID), senderID],
        );
      }

      session.players[senderID] = {
        id: senderID,
        name: userName,
        choice: normalizedChoice,
        amount: betAmount,
        hasVIP: hasVIP,
        hasLucky: hasLucky,
      };

      let reactionMsg = "✅";
      if (hasLucky) reactionMsg = "🍀";
      if (hasVIP) reactionMsg = "👑";

      api.setMessageReaction(reactionMsg, messageID, () => {}, true);

      if (minigameState.locked) {
        api.sendMessage(minigameState.message, threadID, messageID);
      }
    } catch (e) {
      console.error(e);
      return api.sendMessage("❌ Lỗi CSDL tài xỉu.", threadID);
    } finally {
      if (connection) connection.release();
    }
  },
};
