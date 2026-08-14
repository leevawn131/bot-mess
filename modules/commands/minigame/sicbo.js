const { execute, getConnection } = require("../../utils/database");
const path = require("path");
const fs = require("fs");
const { checkCooldown } = require("../../utils/cooldown");
const {
  checkMinigameLimit,
  recordMinigameSuccess,
} = require("../../utils/minigameLimiter");
const { recordAction } = require("../../utils/questSystem");
const prefix = process.env.BOT_PREFIX || "!";

const TAX_RATE = 0.05;
const AUTO_CLOSE_MS = 3 * 60 * 1000;
const SOICAU_HISTORY_FILE = path.join(
  __dirname,
  "../../cache",
  "sicbo_soicau_history.json",
);
const MAX_SOICAU_PER_THREAD = 30;

// Biến lưu trữ phiên (RAM)
global.sicboSessions = global.sicboSessions || {};
global.sicboSoiCauHistory = global.sicboSoiCauHistory || null;
global.sicboAutoCloseTimers = global.sicboAutoCloseTimers || {};

// ID CỦA BOSS (NHÀ CÁI)
const BOSS_ID = "100037351338722";

// Hàm normalize tiếng Việt
function normalizeChoice(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

// Bộ phân tích cửa cược Sic Bo
function parseChoice(choiceStr) {
  const s = normalizeChoice(choiceStr).trim();

  // 1. Tài / Xỉu
  if (s === "tai" || s === "over" || s === "t") {
    return { type: "tai", label: "TÀI" };
  }
  if (s === "xiu" || s === "under" || s === "x") {
    return { type: "xiu", label: "XỈU" };
  }

  // 2. Chẵn / Lẻ
  if (s === "chan" || s === "even" || s === "c") {
    return { type: "chan", label: "CHẴN" };
  }
  if (s === "le" || s === "odd" || s === "l") {
    return { type: "le", label: "LẺ" };
  }

  // 3. Bão bất kỳ
  if (s === "bao" || s === "baotat") {
    return { type: "bao_any", label: "BÃO BẤT KỲ" };
  }

  // 4. Bão cụ thể (bao1, bao2, ..., bao6)
  if (s.startsWith("bao") && s.length === 4) {
    const num = parseInt(s.charAt(3));
    if (num >= 1 && num <= 6) {
      return { type: "bao_specific", value: num, label: `BÃO ${num}` };
    }
  }

  // 5. Cược Đôi Cụ Thể (doi1, doi2, ..., doi6 hoặc d1, d2, ..., d6)
  if (s.startsWith("doi") || s.startsWith("d")) {
    const numStr = s.replace("doi", "").replace("d", "");
    const num = parseInt(numStr);
    if (num >= 1 && num <= 6) {
      return { type: "double", value: num, label: `ĐÔI ${num}` };
    }
  }

  // 6. Cược Tổng Điểm (tong4, tong5, ..., tong17 hoặc t4, t5, ..., t17)
  if (s.startsWith("tong") || s.startsWith("t")) {
    const numStr = s.replace("tong", "").replace("t", "");
    const num = parseInt(numStr);
    if (num >= 4 && num <= 17) {
      return { type: "sum", value: num, label: `TỔNG ĐIỂM ${num}` };
    }
  }

  // 7. Cược Cặp (cap12, c12, cap13, c13, ..., cap56, c56)
  if (s.startsWith("cap") || s.startsWith("c")) {
    const numStr = s.replace("cap", "").replace(/^c/, "");
    if (numStr.length === 2) {
      const num1 = parseInt(numStr.charAt(0));
      const num2 = parseInt(numStr.charAt(1));
      if (num1 >= 1 && num1 <= 6 && num2 >= 1 && num2 <= 6 && num1 !== num2) {
        const low = Math.min(num1, num2);
        const high = Math.max(num1, num2);
        return { type: "pair", value: [low, high], label: `CẶP ${low}-${high}` };
      }
    }
  }

  // 8. Cược Số (so1, so2, ..., so6 hoặc raw numbers 1, 2, ..., 6)
  if (s.startsWith("so") && s.length === 3) {
    const num = parseInt(s.charAt(2));
    if (num >= 1 && num <= 6) {
      return { type: "number", value: num, label: `SỐ ${num}` };
    }
  }
  
  // Tránh trùng lặp với cược số: 
  // - Nếu điền 1 chữ số (1-6) -> Cược Số
  // - Nếu điền 2 chữ số (7-17) -> Cược Tổng Điểm
  if (s.length === 1) {
    const num = parseInt(s);
    if (num >= 1 && num <= 6) {
      return { type: "number", value: num, label: `SỐ ${num}` };
    }
  }
  
  if (s.length === 2) {
    const num = parseInt(s);
    // Nếu điền số từ 7 đến 17 -> Cược Tổng Điểm (Ví dụ: 10 50k, 17 50k)
    if (num >= 7 && num <= 17) {
      return { type: "sum", value: num, label: `TỔNG ĐIỂM ${num}` };
    }
    
    // Nếu điền 2 số khác nhau từ 1 đến 6 (ví dụ: 12, 56) -> Cược Cặp raw
    const num1 = parseInt(s.charAt(0));
    const num2 = parseInt(s.charAt(1));
    if (num1 >= 1 && num1 <= 6 && num2 >= 1 && num2 <= 6 && num1 !== num2) {
      const low = Math.min(num1, num2);
      const high = Math.max(num1, num2);
      return { type: "pair", value: [low, high], label: `CẶP ${low}-${high}` };
    }
  }

  return null;
}

// Kiểm tra kết quả cược
function checkBetResult(parsedBet, dice) {
  const d1 = dice[0];
  const d2 = dice[1];
  const d3 = dice[2];
  const total = d1 + d2 + d3;
  const isTriple = d1 === d2 && d2 === d3;

  switch (parsedBet.type) {
    case "tai":
      if (total >= 11 && total <= 17 && !isTriple) {
        return { won: true, payoutMultiplier: 1 };
      }
      return { won: false };
    case "xiu":
      if (total >= 4 && total <= 10 && !isTriple) {
        return { won: true, payoutMultiplier: 1 };
      }
      return { won: false };
    case "chan":
      if (total % 2 === 0 && !isTriple) {
        return { won: true, payoutMultiplier: 1 };
      }
      return { won: false };
    case "le":
      if (total % 2 !== 0 && !isTriple) {
        return { won: true, payoutMultiplier: 1 };
      }
      return { won: false };
    case "bao_any":
      if (isTriple) {
        return { won: true, payoutMultiplier: 30 };
      }
      return { won: false };
    case "bao_specific":
      if (isTriple && d1 === parsedBet.value) {
        return { won: true, payoutMultiplier: 180 }; // 180:1
      }
      return { won: false };
    case "double":
      const doubleMatches = dice.filter((x) => x === parsedBet.value).length;
      if (doubleMatches >= 2) {
        return { won: true, payoutMultiplier: 11 }; // Cược đôi 11:1
      }
      return { won: false };
    case "sum":
      if (total === parsedBet.value) {
        const sumMultipliers = {
          4: 60, 17: 60,
          5: 20, 16: 20,
          6: 18, 15: 18,
          7: 12, 14: 12,
          8: 8, 13: 8,
          9: 6, 10: 6, 11: 6, 12: 6
        };
        return { won: true, payoutMultiplier: sumMultipliers[total] || 1 };
      }
      return { won: false };
    case "number":
      const matches = dice.filter((x) => x === parsedBet.value).length;
      if (matches > 0) {
        return { won: true, payoutMultiplier: matches }; // 1 viên: 1x, 2 viên: 2x, 3 viên: 3x
      }
      return { won: false };
    case "pair":
      const [n1, n2] = parsedBet.value;
      if (dice.includes(n1) && dice.includes(n2)) {
        return { won: true, payoutMultiplier: 6 }; // Cặp: 6:1
      }
      return { won: false };
  }
  return { won: false };
}

// Đọc cấu hình database
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

// Đọc/lưu lịch sử soi cầu
function ensureSoiCauStore() {
  if (global.sicboSoiCauHistory) return global.sicboSoiCauHistory;

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
    global.sicboSoiCauHistory =
      typeof parsed === "object" && parsed ? parsed : {};
  } catch (e) {
    global.sicboSoiCauHistory = {};
  }

  return global.sicboSoiCauHistory;
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
    console.error("[sicbo] Không lưu được lịch sử soi cầu:", e);
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
  const result = String(item.result || "").toUpperCase();
  const d1 = Number(item.dice1) || 0;
  const d2 = Number(item.dice2) || 0;
  const d3 = Number(item.dice3) || 0;
  const total = Number(item.total) || d1 + d2 + d3;
  const sessionText = item.sessionID ? ` | Phien #${item.sessionID}` : "";

  return `${round}${sessionText}: ${result} (${d1}-${d2}-${d3}) = ${total}`;
}

function clearSicboTimer(threadID) {
  const key = String(threadID);
  const timer = global.sicboAutoCloseTimers[key];
  if (timer) {
    clearTimeout(timer);
    delete global.sicboAutoCloseTimers[key];
  }
}

// Xử lý chung kết thúc phiên Sic Bo
async function finalizeSicboSession({
  api,
  threadID,
  dbConfig,
  autoClose = false,
}) {
  const key = String(threadID);
  const session = global.sicboSessions[key];
  if (!session) return;
  if (session.status === "closing") return;
  session.status = "closing";

  // Gỡ tin nhắn mở sòng
  const originalMessageID = session.messageID;
  if (originalMessageID) {
    try {
      await api.unsendMessage(originalMessageID);
    } catch (err) {
      console.error("[sicbo] Không thể gỡ tin nhắn mở sòng:", err);
    }
  }

  const players = Object.values(session.players);

  if (players.length === 0) {
    clearSicboTimer(key);
    delete global.sicboSessions[key];
    return api.sendMessage("⚠️ Phiên Sic Bo hủy do không ai chơi.", key);
  }

  // LẮC XÚC XẮC
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const d3 = Math.floor(Math.random() * 6) + 1;
  const total = d1 + d2 + d3;

  const diceIcons = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  const resultIcon = `${diceIcons[d1 - 1]} ${diceIcons[d2 - 1]} ${diceIcons[d3 - 1]}`;

  let resultText = "XIU";
  const isTriple = d1 === d2 && d2 === d3;
  if (isTriple) {
    resultText = "BÃO";
  } else if (total >= 11 && total <= 17) {
    resultText = "TÀI";
  }

  // Ghi nhận soi cầu
  addSoiCauHistory(key, {
    sessionID: session.sessionID,
    result: resultText,
    total,
    dice1: d1,
    dice2: d2,
    dice3: d3,
    createdAt: Date.now(),
  });

  let totalBet = 0;
  let totalPay = 0;
  const autoCloseText = autoClose ? "⏰ Hết 3 phút, bot tự xóc.\n" : "";
  let msg = `${autoCloseText}🎰 KẾT QUẢ SIC BO (Phiên #${session.sessionID}): ${resultIcon}\nTổng: ${total} - ${resultText}\n━━━━━━━━━━━━━\n`;

  let connection;
  try {
    connection = await getConnection();

    for (const p of players) {
      // Kiểm tra VIP
      const [userCheck] = await connection.execute(
        "SELECT vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?",
        [key, p.id],
      );
      const hasVIP =
        userCheck[0]?.vip_until &&
        new Date(userCheck[0].vip_until) > new Date();

      // Kiểm tra Lucky
      const [luckyCheck] = await connection.execute(
        'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "luck" AND uses_left > 0',
        [p.id],
      );
      const hasLucky = luckyCheck.length > 0;

      let userTotalBet = 0;
      let userTotalWinPayout = 0;
      let userTotalRefund = 0;
      let userNetProfitChange = 0;

      let betDetailsMsg = [];

      for (const bet of p.bets) {
        userTotalBet += bet.amount;
        totalBet += bet.amount;

        const checkResult = checkBetResult(bet.parsedChoice, [d1, d2, d3]);
        const isWin = checkResult.won;

        if (isWin) {
          const multiplier = checkResult.payoutMultiplier;
          const grossPayout = bet.amount * (multiplier + 1);
          const winProfit = bet.amount * multiplier;
          const taxAmount = Math.floor(winProfit * TAX_RATE);
          const payout = grossPayout - taxAmount;
          const netProfit = Math.max(0, winProfit - taxAmount);

          userTotalWinPayout += payout;
          userNetProfitChange += netProfit;

          betDetailsMsg.push(`🟢 ${bet.parsedChoice.label}: +${netProfit.toLocaleString('vi-VN')}`);
        } else {
          // Thua, VIP hoàn 5%
          let refund = 0;
          if (hasVIP) {
            const grossRefund = Math.floor(bet.amount * 0.05);
            const refundTax = Math.floor(grossRefund * TAX_RATE);
            refund = Math.max(0, grossRefund - refundTax);
            userTotalRefund += refund;
          }
          userNetProfitChange -= bet.amount;

          let refundText = refund > 0 ? ` (VIP +${refund.toLocaleString('vi-VN')})` : "";
          betDetailsMsg.push(`🔴 ${bet.parsedChoice.label}: -${bet.amount.toLocaleString('vi-VN')}${refundText}`);
        }
      }

      // Cập nhật credits người chơi
      const finalPayout = userTotalWinPayout + userTotalRefund;
      totalPay += finalPayout;

      if (finalPayout > 0) {
        await connection.execute(
          "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
          [finalPayout, key, p.id],
        );
      }

      if (hasLucky) {
        await connection.execute(
          'UPDATE active_effects SET uses_left = uses_left - 1 WHERE psid = ? AND effect_type = "luck"',
          [p.id],
        );
      }

      let extraInfo = "";
      if (hasLucky) extraInfo += " 🍀";

      const changeSign = userNetProfitChange >= 0 ? "+" : "";
      msg += `👤 ${p.name}${extraInfo}:\n   ${betDetailsMsg.join("\n   ")}\n   👉 Tổng: ${changeSign}${userNetProfitChange.toLocaleString('vi-VN')}\n━━━━━━━━━━━━━\n`;
    }

    // Xóa hiệu ứng lucky hết lượt
    await connection.execute("DELETE FROM active_effects WHERE uses_left <= 0");

    // Xử lý tiền Boss
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
    console.error("[sicbo] Lỗi database:", e);
    msg += "\n❌ Lỗi Database khi tổng kết phiên!";
  } finally {
    if (connection) connection.release();
  }

  clearSicboTimer(key);
  delete global.sicboSessions[key];
  return api.sendMessage(msg, key);
}

function scheduleSicboAutoClose({ api, threadID, config }) {
  const key = String(threadID);
  clearSicboTimer(key);

  global.sicboAutoCloseTimers[key] = setTimeout(async () => {
    try {
      const session = global.sicboSessions[key];
      if (!session || session.status !== "open") return;
      const dbConfig = resolveDBConfig(config);
      if (!dbConfig) {
        clearSicboTimer(key);
        delete global.sicboSessions[key];
        return api.sendMessage("❌ Lỗi cấu hình Database!", key);
      }

      await finalizeSicboSession({
        api,
        threadID: key,
        dbConfig,
        autoClose: true,
      });
    } catch (e) {
      console.error("[sicbo] Lỗi tự kết phiên:", e);
    }
  }, AUTO_CLOSE_MS);
}

module.exports = {
  name: "sicbo",
  description: "Minigame Sic Bo chuyên nghiệp (Tài Xỉu đầy đủ)",
  usage: `\n${prefix}sicbo → Mở sòng Sic Bo mới\n${prefix}sicbo xoc → Lắc xúc xắc kết thúc phiên\n${prefix}sicbo soicau → Xem lịch sử kết quả gần nhất\n━━━━━━━━━━━━━\n🎲 Cách cược: Reply tin nhắn sòng theo dạng:\n[Loại_cược] [Số_tiền]\n\n📝 Các cửa cược:\n- tai / xiu (Tài / Xỉu) | Tỷ lệ 1:1\n- chan / le (Chẵn / Lẻ) | Tỷ lệ 1:1\n- [1-6] hoặc so [1-6] (Cược số) | Tỷ lệ 1:1, 2:1, 3:1\n- [2 số] hoặc cap [2 số] (Cặp khác nhau, vd: 12) | Tỷ lệ 6:1\n- doi[1-6] hoặc d[1-6] (Cặp đôi giống nhau, vd: doi2) | Tỷ lệ 11:1\n- [7-17] hoặc tong[4-17] (Cược tổng điểm) | Tỷ lệ 6:1 đến 60:1\n- bao (Bão bất kỳ) | Tỷ lệ 30:1\n- bao[1-6] (Bão cụ thể, vd: bao6) | Tỷ lệ 180:1\n\n💡 Ví dụ: Reply sòng → tai 50000 | 12 10000 | doi6 5000 | 10 20000`,

  execute: async ({ api, event, args, config }) => {
    const { threadID, senderID } = event;
    const command = args[0]?.toLowerCase();

    // 1. Xem soi cầu
    if (command === "soicau") {
      const store = ensureSoiCauStore();
      const history = Array.isArray(store[String(threadID)])
        ? store[String(threadID)]
        : [];

      if (history.length === 0) {
        return api.sendMessage(
          "📉 Bàn này chưa có dữ liệu soi cầu Sic Bo. Hãy chơi vài phiên rồi thử lại.",
          threadID,
        );
      }

      const recent = history.slice(-15);
      const lines = recent.map((item, idx) => formatSoiCauLine(idx + 1, item));
      const msg = `📊 SOI CẦU SIC BO (15 phiên gần nhất)\nBàn: ${threadID}\n━━━━━━━━━━━━━\n${lines.join("\n")}\n\n⏰ Tin nhắn này sẽ tự động gỡ sau 45s.`;
      
      try {
        const info = await api.sendMessage(msg, threadID);
        setTimeout(async () => {
          try {
            await api.unsendMessage(info.messageID);
          } catch (_) {}
        }, 45000);
      } catch (e) {
        console.error("[sicbo] Lỗi gửi tin soi cầu:", e);
      }
      return;
    }

    // Cooldown 10s
    const cooldown = checkCooldown({
      command: "sicbo",
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

    // 2. Chốt phiên
    if (command === "xoc" || command === "so") {
      if (!global.sicboSessions[key])
        return api.sendMessage("❌ Chưa mở phiên Sic Bo nào.", key);

      return finalizeSicboSession({
        api,
        threadID: key,
        dbConfig,
        autoClose: false,
      });
    }

    // 3. Mở phiên mới
    else {
      if (global.sicboSessions[key])
        return api.sendMessage(
          `⚠️ Đang có phiên rồi! Gõ ${prefix}sicbo xoc để chốt.`,
          key,
        );

      const sessionID = Math.floor(Math.random() * 9999);
      const openMsg = `🎲 SÒNG BẠC SIC BO CHUYÊN NGHIỆP! (Phiên #${sessionID})
👑 Nhà cái: LeVan

👉 HƯỚNG DẪN ĐẶT CƯỢC (Reply tin nhắn này):
Cú pháp cược: [Cửa_cược] [Số_tiền]
(Mẹo: Bạn có thể cược nhiều cửa cùng lúc bằng cách dùng dấu "|" hoặc ",")

━━━━━━━━━━━━━━━━━━━━
📝 CÁC CỬA CƯỢC & VÍ DỤ CỤ THỂ:

1. TÀI / XỈU (Tỷ lệ 1:1 - Bão thua)
   👉 Gõ: tai hoặc xiu (Ví dụ: tai 50000)
2. CHẴN / LẺ (Tỷ lệ 1:1 - Bão thua)
   👉 Gõ: chan hoặc le (Ví dụ: le 30000)
3. CƯỢC SỐ (Ăn 1x/2x/3x tùy số lượng xúc xắc khớp)
   👉 Gõ: Số từ 1 đến 6 (Ví dụ: 3 50000 - cược số 3)
4. CƯỢC CẶP SỐ (Ăn 6:1 - Ra cả 2 số khác nhau)
   👉 Gõ: cap[2 số], c[2 số] hoặc ghép 2 số (Ví dụ: c12 50000 hoặc 12 50000)
5. CƯỢC ĐÔI (Ăn 11:1 - Ra ít nhất 2 số giống nhau)
   👉 Gõ: doi[1-6] hoặc d[1-6] (Ví dụ: doi6 20000 - cược đôi 6)
6. BÃO BẤT KỲ (Ăn 30:1 - Ra 3 số giống nhau bất kỳ)
   👉 Gõ: bao hoặc baotat (Ví dụ: bao 10000)
7. BÃO CỤ THỂ (Ăn 180:1 - Ra 3 số giống nhau xác định)
   👉 Gõ: bao[1-6] (Ví dụ: bao6 10000 - cược bão 6)
8. TỔNG ĐIỂM CỤ THỂ (Ăn 6:1 đến 60:1 tùy điểm)
   👉 Gõ: Điểm từ 7 đến 17 (Ví dụ: 10 20000 - cược tổng 10)
   👉 Với tổng 4, 5, 6: Gõ t4, t5, t6 (Ví dụ: t4 10000)

━━━━━━━━━━━━━━━━━━━━
💡 Ví dụ cược nhiều cửa cùng lúc:
Reply sòng gõ: tai 50000 | 12 20000 | doi6 10000

⏰ Tự xóc sau 3 phút. Gõ "${prefix}sicbo xoc" để lắc xúc xắc.`;

      global.sicboSessions[key] = {
        status: "open",
        sessionID: sessionID,
        author: senderID,
        messageID: null,
        players: {},
      };

      try {
        const info = await api.sendMessage(openMsg, key);
        if (info && info.messageID) {
          global.sicboSessions[key].messageID = info.messageID;
        }
        scheduleSicboAutoClose({ api, threadID: key, config });
      } catch (e) {
        if (e.error === 1390008) {
          delete global.sicboSessions[key];
          console.error("🔴 Bot bị chặn Spam (1390008).");
        } else {
          console.error("Lỗi gửi tin mở sòng Sic Bo:", e);
          scheduleSicboAutoClose({ api, threadID: key, config });
        }
      }
    }
  },

  handleReply: async ({ api, event, config }) => {
    const { threadID, senderID, body, messageReply, messageID } = event;

    if (!global.sicboSessions[threadID]) return;
    if (!messageReply) return;

    const session = global.sicboSessions[threadID];
    if (session.status !== "open") return;

    const isSessionReply =
      (session.messageID && String(messageReply.messageID) === String(session.messageID)) ||
      (messageReply.body && messageReply.body.includes("SIC BO"));

    if (!isSessionReply) return;

    if (senderID === BOSS_ID)
      return api.sendMessage("❌ Boss không được cược!", threadID, messageID);

    const limitCheck = checkMinigameLimit(senderID);
    if (!limitCheck.allowed) {
      return api.sendMessage(limitCheck.message, threadID, messageID);
    }

    // Tách các cửa cược trong tin nhắn bằng dấu |, dấu phẩy, dấu chấm phẩy hoặc xuống dòng
    const parts = body
      .split(/[|,\n;]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (parts.length === 0) return;

    const parsedBets = [];
    for (const part of parts) {
      const args = part.split(/\s+/);
      if (args.length < 2) {
        return api.sendMessage(
          `⚠️ Cú pháp cược "${part}" không hợp lệ. Vui lòng cược theo dạng: [Cửa_cược] [Số_tiền]`,
          threadID,
          messageID,
        );
      }
      const choiceInput = args[0];
      const amountStr = args[1];

      const parsedChoice = parseChoice(choiceInput);
      if (!parsedChoice) {
        return api.sendMessage(
          `⚠️ Cửa cược "${choiceInput}" không tồn tại hoặc viết sai!`,
          threadID,
          messageID,
        );
      }

      parsedBets.push({ choiceInput, amountStr, parsedChoice });
    }

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
          `❌ Bạn chưa có tài khoản (dùng ${prefix}tien để tạo).`,
          threadID,
          messageID,
        );

      let userBalance = parseInt(rows[0].credits);
      const userName = rows[0].name;
      const hasVIP =
        rows[0].vip_until && new Date(rows[0].vip_until) > new Date();

      // Kiểm tra Luck
      const [luckyCheck] = await connection.execute(
        'SELECT * FROM active_effects WHERE psid = ? AND effect_type = "luck" AND uses_left > 0',
        [senderID],
      );
      const hasLucky = luckyCheck.length > 0;

      // Phân tích và khấu trừ giả định các cửa cược
      let tempBalance = userBalance;
      const betsToPlace = [];

      for (const item of parsedBets) {
        const { choiceInput, amountStr, parsedChoice } = item;
        let betAmount = 0;

        if (amountStr === "all" || amountStr === "tat") {
          betAmount = tempBalance;
        } else if (
          amountStr &&
          typeof amountStr === "string" &&
          amountStr.endsWith("%")
        ) {
          const percentStr = amountStr.slice(0, -1);
          const percent = parseFloat(percentStr);
          if (!isNaN(percent) && percent > 0 && percent <= 100) {
            betAmount = Math.floor((tempBalance * percent) / 100);
          } else {
            return api.sendMessage(
              `⚠️ Phần tích hợp cược "${amountStr}" không hợp lệ.`,
              threadID,
              messageID,
            );
          }
        } else {
          betAmount = parseInt(amountStr);
        }

        if (isNaN(betAmount) || betAmount <= 0) {
          return api.sendMessage(
            `⚠️ Số tiền cược "${amountStr}" không hợp lệ.`,
            threadID,
            messageID,
          );
        }

        if (tempBalance < betAmount) {
          return api.sendMessage(
            `💸 Không đủ tiền cược cửa "${parsedChoice.label}" (Cần thêm ${(betAmount - tempBalance).toLocaleString('vi-VN')} credits).`,
            threadID,
            messageID,
          );
        }

        tempBalance -= betAmount;
        betsToPlace.push({
          choiceInput,
          parsedChoice,
          amount: betAmount,
        });
      }

      // Lấy danh sách cược hiện tại trong phiên của người chơi này
      const currentBets = session.players[senderID]?.bets || [];

      // Kiểm tra trùng cửa cược (cộng gộp cả cược cũ nếu có)
      const allBets = [...currentBets];
      for (const bet of betsToPlace) {
        const isDuplicate = allBets.some(
          (b) =>
            b.parsedChoice.type === bet.parsedChoice.type &&
            JSON.stringify(b.parsedChoice.value) ===
              JSON.stringify(bet.parsedChoice.value),
        );
        if (isDuplicate) {
          return api.sendMessage(
            `⚠️ Cửa ${bet.parsedChoice.label} đã được cược rồi (hoặc cược trùng trong tin nhắn)!`,
            threadID,
            messageID,
          );
        }
        allBets.push(bet);
      }

      // Tổng cược toàn bộ phiên
      const totalSessionBet = allBets.reduce((sum, b) => sum + b.amount, 0);

      // Chặn cược > 500k nếu đang trong tù
      const [jailRows] = await connection.execute(
        "SELECT jail_until FROM user_jail WHERE thread_id = ? AND psid = ? AND jail_until > datetime('now', 'localtime')",
        [senderID],
      );
      if (jailRows.length > 0 && totalSessionBet > 500000) {
        const remainingMs = new Date(jailRows[0].jail_until) - new Date();
        const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const timeStr = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
        return api.sendMessage(
          `🔒 Bạn đang trong tù, chỉ được cược tổng cộng tối đa 500k.\n⏰ Còn lại: ${timeStr}`,
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

        if (now > dueDate && totalSessionBet > 200000) {
          const daysOverdue = Math.floor(
            (now - dueDate) / (1000 * 60 * 60 * 24),
          );
          return api.sendMessage(
            `⚠️ BẠN ĐANG NỢ TIỀN!\n━━━━━━━━━━━━━\n Nợ quá hạn: ${daysOverdue} ngày\n💰 Số tiền vay: ${parseInt(loan.principal).toLocaleString('vi-VN')}\n📉 Tổng cược tối đa: 200k (phục vụ trả nợ)\n━━━━━━━━━━━━━\n💡 Trả nợ để cược bình thường!`,
            threadID,
            messageID,
          );
        }
      }

      // Thực tế khấu trừ tiền cược
      const totalNewBetAmount = betsToPlace.reduce((sum, b) => sum + b.amount, 0);
      await connection.execute(
        "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
        [totalNewBetAmount, String(threadID), senderID],
      );

      const minigameState = recordMinigameSuccess(senderID);

      try {
        recordAction(senderID, "bet_count", betsToPlace.length);
        recordAction(senderID, "bet_amount", totalNewBetAmount);
      } catch (_) {}

      // Tăng games_played nếu tổng tiền cược ván này chạm mốc 50k
      if (totalNewBetAmount >= 50000) {
        await connection.execute(
          "UPDATE messenger_users SET games_played = games_played + 1 WHERE thread_id = ? AND psid = ?",
          [String(threadID), senderID],
        );
      }

      // Ghi nhận cược mới vào list
      if (!session.players[senderID]) {
        session.players[senderID] = {
          id: senderID,
          name: userName,
          bets: [],
          hasVIP: hasVIP,
          hasLucky: hasLucky,
        };
      }

      session.players[senderID].bets.push(...betsToPlace);

      let reactionMsg = "✅";
      if (hasLucky) reactionMsg = "🍀";
      if (hasVIP) reactionMsg = "👑";

      api.setMessageReaction(reactionMsg, messageID, () => {}, true);

      // Phản hồi tin nhắn liệt kê các cửa đã nhận cược thành công
      const listPlaced = betsToPlace
        .map((b) => `• ${b.parsedChoice.label}: ${b.amount.toLocaleString('vi-VN')} credits`)
        .join("\n");
      api.sendMessage(
        `✅ ĐÃ NHẬN CƯỢC THÀNH CÔNG:\n━━━━━━━━━━━━━\n${listPlaced}`,
        threadID,
        messageID,
      );

      if (minigameState.locked) {
        api.sendMessage(minigameState.message, threadID, messageID);
      }
    } catch (e) {
      console.error("[sicbo] Lỗi cược reply:", e);
      return api.sendMessage("❌ Lỗi CSDL khi nhận cược.", threadID);
    } finally {
      if (connection) connection.release();
    }
  },
};
