const fs = require("fs");
const path = require("path");
const { login } = require("ws3-fca");
const { checkPermission, getGroupMode } = require("./modules/utils/checkPermission");
const { startModeScheduler } = require("./modules/utils/modeScheduler");
const { runAiConversation, normalizeText } = require("./modules/utils/aiAssistant");

const DAILY_TOP_STATE_PATH = path.join(
  __dirname,
  "cache",
  "checktt_daily_top_state.json",
);
const MONTHLY_TOP_STATE_PATH = path.join(
  __dirname,
  "cache",
  "checktt_monthly_top_state.json",
);

// 1. LOAD CONFIG
let config;
try {
  config = require("./config.json");
} catch {
  config = { prefix: "!", adminIDs: [] };
}

// 2. LOAD APPSTATE
let credentials;
try {
  credentials = {
    appState: JSON.parse(fs.readFileSync("appstate.json", "utf8")),
  };
} catch (err) {
  console.error("❌ Thiếu appstate.json");
  process.exit(1);
}

// --- FIX MENTIONS HELPER ---
const ensureMentions = async (api, event) => {
  if (!event.body || !event.body.includes("@")) return event;
  if (Object.keys(event.mentions || {}).length > 0) return event;
  try {
    const history = await api.getThreadHistory(event.threadID, 5);
    const originalMsg = history.find((m) => m.messageID === event.messageID);
    if (
      originalMsg &&
      originalMsg.mentions &&
      Object.keys(originalMsg.mentions).length > 0
    ) {
      event.mentions = originalMsg.mentions;
    }
  } catch (e) {}
  return event;
};

// --- HÀM QUÉT FILE ĐỆ QUY ---
const getAllFiles = (dirPath, arrayOfFiles) => {
  try {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];
    files.forEach((file) => {
      const fullPath = path.join(dirPath, file);
      if (fs.statSync(fullPath).isDirectory()) {
        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
      } else {
        if (file.endsWith(".js")) arrayOfFiles.push(fullPath);
      }
    });
    return arrayOfFiles;
  } catch {
    return [];
  }
};

console.log("⏳ Đang kết nối tới Facebook...");

login(
  credentials,
  {
    online: true,
    listenEvents: true,
    selfListen: config.fca?.selfListen ?? false,
    userAgent:
      config.fca?.userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
  async (err, api) => {
    if (err) return console.error("❌ LOGIN ERROR:", err);

    if (typeof api.setOptions === "function") {
      api.setOptions({
        selfListen: config.fca?.selfListen ?? true,
        listenEvents: true,
      });
    }

    const botID = api.getCurrentUserID();
    console.log(`✅ Đăng nhập thành công ID: ${botID}`);
    fs.writeFileSync(
      "appstate.json",
      JSON.stringify(api.getAppState(), null, 2),
    );

    // =================================================================
    // ĐOẠN MỚI: KIỂM TRA THÔNG BÁO RESET THÀNH CÔNG
    // =================================================================
    const resetPath = path.join(__dirname, "reset_data.json");
    if (fs.existsSync(resetPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(resetPath, "utf8"));
        const timeTaken = ((Date.now() - data.time) / 1000).toFixed(2);

        api.sendMessage(
          `✅ Bot đã khởi động lại thành công!\n` +
            `⏱ Thời gian reload: ${timeTaken} giây.\n` +
            `🚀 Các module lệnh đã được làm mới hoàn toàn.`,
          data.threadID,
        );

        // Xóa file tạm sau khi đã báo thành công
        fs.unlinkSync(resetPath);
      } catch (e) {
        console.error("❌ Lỗi xử lý file reset_data:", e);
      }
    }

    // --- NẠP COMMANDS VÀ EVENTS ---
    global.commands = new Map();
    const commandsDir = path.join(__dirname, "modules", "commands");
    if (!fs.existsSync(commandsDir))
      fs.mkdirSync(commandsDir, { recursive: true });

    getAllFiles(commandsDir).forEach((file) => {
      try {
        const cmd = require(file);
        if (cmd.name) global.commands.set(cmd.name, cmd);
      } catch (e) {
        console.error(`❌ Lỗi nạp module ${path.basename(file)}: ${e.message}`);
      }
    });

    const events = new Map();
    const eventsDir = path.join(__dirname, "modules", "events");
    if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });
    getAllFiles(eventsDir).forEach((file) => {
      try {
        const ev = require(file);
        if (!ev.name) return;

        // AI auto reply is handled inline below to avoid duplicated/conflicting logic.
        if (ev.name === "aiAutoReply") return;

        events.set(ev.name, ev);
      } catch {}
    });

    console.log(
      `📂 Đã nạp ${global.commands.size} lệnh và ${events.size} sự kiện.`,
    );

    // --- BẬT HẸN GIỜ TỰ ĐỘNG ĐỔI MODE ---
    startModeScheduler(api);

    // --- HÀM ĐẾM TIN NHẮN ---
    const statsPath = path.join(__dirname, "message_stats.json");
    let dailyTopStateCache = null;
    let monthlyTopStateCache = null;

    const readDailyTopState = () => {
      if (dailyTopStateCache) return dailyTopStateCache;

      try {
        if (fs.existsSync(DAILY_TOP_STATE_PATH)) {
          const parsed = JSON.parse(
            fs.readFileSync(DAILY_TOP_STATE_PATH, "utf8"),
          );
          dailyTopStateCache =
            parsed && typeof parsed === "object" ? parsed : {};
          return dailyTopStateCache;
        }
      } catch {}

      dailyTopStateCache = {};
      return dailyTopStateCache;
    };

    const writeDailyTopState = (state) => {
      dailyTopStateCache = state;
      const dir = path.dirname(DAILY_TOP_STATE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DAILY_TOP_STATE_PATH, JSON.stringify(state, null, 2));
    };

    const readMonthlyTopState = () => {
      if (monthlyTopStateCache) return monthlyTopStateCache;

      try {
        if (fs.existsSync(MONTHLY_TOP_STATE_PATH)) {
          const parsed = JSON.parse(
            fs.readFileSync(MONTHLY_TOP_STATE_PATH, "utf8"),
          );
          monthlyTopStateCache =
            parsed && typeof parsed === "object" ? parsed : {};
          return monthlyTopStateCache;
        }
      } catch {}

      monthlyTopStateCache = {};
      return monthlyTopStateCache;
    };

    const writeMonthlyTopState = (state) => {
      monthlyTopStateCache = state;
      const dir = path.dirname(MONTHLY_TOP_STATE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(MONTHLY_TOP_STATE_PATH, JSON.stringify(state, null, 2));
    };

    const getTimeKeys = (now = new Date()) => {
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const dayKey = `${year}-${month}-${day}`;
      const monthKey = `${year}-${month}`;

      const weekDate = new Date(year, now.getMonth(), now.getDate());
      const weekDay = (weekDate.getDay() + 6) % 7;
      weekDate.setDate(weekDate.getDate() - weekDay + 3);

      const firstThursday = new Date(weekDate.getFullYear(), 0, 4);
      const firstWeekDay = (firstThursday.getDay() + 6) % 7;
      firstThursday.setDate(firstThursday.getDate() - firstWeekDay + 3);

      const weekNumber =
        1 + Math.round((weekDate - firstThursday) / (7 * 24 * 60 * 60 * 1000));
      const weekKey = `${weekDate.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;

      return { dayKey, weekKey, monthKey };
    };

    const trimMapByNewestKeys = (mapObj, limit) => {
      const keys = Object.keys(mapObj || {}).sort();
      if (keys.length <= limit) return;
      const toDelete = keys.slice(0, keys.length - limit);
      toDelete.forEach((k) => {
        delete mapObj[k];
      });
    };

    const normalizeEntry = (raw) => {
      if (typeof raw === "number") {
        return {
          total: Number(raw) || 0,
          daily: {},
          weekly: {},
          monthly: {},
        };
      }

      if (!raw || typeof raw !== "object") {
        return {
          total: 0,
          daily: {},
          weekly: {},
          monthly: {},
        };
      }

      return {
        total: Number(raw.total) || 0,
        daily: raw.daily && typeof raw.daily === "object" ? raw.daily : {},
        weekly: raw.weekly && typeof raw.weekly === "object" ? raw.weekly : {},
        monthly:
          raw.monthly && typeof raw.monthly === "object" ? raw.monthly : {},
      };
    };

    const formatDayLabel = (dayKey) => {
      const [year, month, day] = String(dayKey || "").split("-");
      if (!year || !month || !day) return String(dayKey || "");
      return `${day}/${month}/${year}`;
    };

    const formatMonthLabel = (monthKey) => {
      const [year, month] = String(monthKey || "").split("-");
      if (!year || !month) return String(monthKey || "");
      return `${month}/${year}`;
    };

    const getPreviousDayKey = (now = new Date()) => {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return getTimeKeys(d).dayKey;
    };

    const getPreviousMonthKey = (now = new Date()) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return getTimeKeys(d).monthKey;
    };

    const maybeSendDailyTop10 = async ({ api, threadID, threadStats }) => {
      try {
        if (!threadID || !threadStats || typeof threadStats !== "object")
          return;

        const yesterdayKey = getPreviousDayKey();
        const state = readDailyTopState();
        if (state[threadID] === yesterdayKey) return;

        const ranked = Object.entries(threadStats)
          .filter(([uid]) => /^\d+$/.test(String(uid)))
          .map(([uid, raw]) => {
            const entry = normalizeEntry(raw);
            return {
              uid: String(uid),
              count: Number(entry.daily?.[yesterdayKey] || 0),
              total: Number(entry.total || 0),
            };
          })
          .filter((item) => item.count > 0)
          .sort((a, b) => {
            const dayDiff = b.count - a.count;
            if (dayDiff !== 0) return dayDiff;
            return b.total - a.total;
          });

        state[threadID] = yesterdayKey;
        writeDailyTopState(state);

        if (ranked.length === 0) return;

        const threadInfo = await api.getThreadInfo(threadID);
        if (!threadInfo?.isGroup) return;

        const userMap = new Map(
          (threadInfo.userInfo || []).map((u) => [String(u.id), u.name]),
        );

        const lines = [
          `📊 TOP 10 TƯƠNG TÁC NGÀY ${formatDayLabel(yesterdayKey)}`,
          "━━━━━━━━━━━━━━━━━━",
          ...ranked.slice(0, 10).map((item, idx) => {
            const name = userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
            return `${idx + 1}. ${name} — ${item.count}`;
          }),
        ];

        await api.sendMessage(lines.join("\n"), threadID);
      } catch (e) {
        console.error("❌ Lỗi gửi TOP 10 tương tác ngày:", e);
      }
    };

    const maybeSendMonthlyTop10 = async ({ api, threadID, threadStats }) => {
      try {
        if (!threadID || !threadStats || typeof threadStats !== "object")
          return;

        const previousMonthKey = getPreviousMonthKey();
        const state = readMonthlyTopState();
        if (state[threadID] === previousMonthKey) return;

        const ranked = Object.entries(threadStats)
          .filter(([uid]) => /^\d+$/.test(String(uid)))
          .map(([uid, raw]) => {
            const entry = normalizeEntry(raw);
            return {
              uid: String(uid),
              count: Number(entry.monthly?.[previousMonthKey] || 0),
              total: Number(entry.total || 0),
            };
          })
          .filter((item) => item.count > 0)
          .sort((a, b) => {
            const monthDiff = b.count - a.count;
            if (monthDiff !== 0) return monthDiff;
            return b.total - a.total;
          });

        state[threadID] = previousMonthKey;
        writeMonthlyTopState(state);

        if (ranked.length === 0) return;

        const threadInfo = await api.getThreadInfo(threadID);
        if (!threadInfo?.isGroup) return;

        const userMap = new Map(
          (threadInfo.userInfo || []).map((u) => [String(u.id), u.name]),
        );

        const lines = [
          `📊 TOP 10 TƯƠNG TÁC THÁNG ${formatMonthLabel(previousMonthKey)}`,
          "━━━━━━━━━━━━━━━━━━",
          ...ranked.slice(0, 10).map((item, idx) => {
            const name = userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
            return `${idx + 1}. ${name} — ${item.count}`;
          }),
        ];

        await api.sendMessage(lines.join("\n"), threadID);
      } catch (e) {
        console.error("❌ Lỗi gửi TOP 10 tương tác tháng:", e);
      }
    };

    // --- HÀM XÁC ĐỊNH LOẠI TIN NHẮN ---
    const getMessageType = (event) => {
      if (!event.attachments || event.attachments.length === 0) {
        return "text";
      }

      const attachment = event.attachments[0];
      const type = attachment.type || "";

      switch (type) {
        case "sticker":
          return "sticker";
        case "animated_image":
          return "gif";
        case "video":
          return "video";
        case "image":
          return "image";
        case "audio":
          return "audio";
        case "file":
          return "file";
        default:
          return "attachment";
      }
    };

    const updateMessageStats = (senderID, threadID, event = null) => {
      try {
        let stats = {};
        if (fs.existsSync(statsPath)) {
          stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
        }

        if (!stats[threadID]) {
          stats[threadID] = {};
        }

        const uid = String(senderID);
        const entry = normalizeEntry(stats[threadID][uid]);
        const { dayKey, weekKey, monthKey } = getTimeKeys();

        // Cập nhật tổng số tin nhắn
        entry.total = Number(entry.total || 0) + 1;
        entry.daily[dayKey] = Number(entry.daily[dayKey] || 0) + 1;
        entry.weekly[weekKey] = Number(entry.weekly[weekKey] || 0) + 1;
        entry.monthly[monthKey] = Number(entry.monthly[monthKey] || 0) + 1;

        // Giữ file stats gọn để tránh phình theo thời gian.
        trimMapByNewestKeys(entry.daily, 45);
        trimMapByNewestKeys(entry.weekly, 26);
        trimMapByNewestKeys(entry.monthly, 18);

        stats[threadID][uid] = entry;

        fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));

        return stats[threadID];
      } catch (e) {
        console.error("❌ Lỗi cập nhật thống kê tin nhắn:", e);
        return null;
      }
    };

    // --- LISTENER CHÍNH ---
    api.listenMqtt(async (err, event) => {
      if (err) return console.error("Listen Error:", err);

      // 1. Xử lý Event hệ thống (Log message)
      if (event.logMessageType) {
        events.forEach(async (ev) => {
          if (ev.eventType && ev.eventType.includes(event.logMessageType)) {
            try {
              await ev.execute({ api, event, config });
            } catch (e) {}
          }
        });
      }

      // 1b. Xử lý Event theo event.type
      if (event.type) {
        events.forEach(async (ev) => {
          if (ev.eventType && ev.eventType.includes(event.type)) {
            try {
              await ev.execute({ api, event, config });
            } catch (e) {}
          }
        });
      }

      // 2. Đếm tin nhắn (bao gồm cả tin nhắn có attachments)
      if (
        (event.body || event.attachments) &&
        event.senderID &&
        event.senderID != botID &&
        event.threadID
      ) {
        const threadStats = updateMessageStats(event.senderID, event.threadID, event);
        await maybeSendDailyTop10({
          api,
          threadID: event.threadID,
          threadStats,
        });
        await maybeSendMonthlyTop10({
          api,
          threadID: event.threadID,
          threadStats,
        });

        // 2b. Cập nhật ANTITHUHOI tức thời (nếu được bật)
        try {
          const antithuhoiPath = path.join(
            __dirname,
            "cache/antithuhoi/settings.json",
          );
          if (fs.existsSync(antithuhoiPath)) {
            const antithuhoiSettings = JSON.parse(
              fs.readFileSync(antithuhoiPath, "utf8"),
            );
            if (antithuhoiSettings[event.threadID]) {
              const messagesPath = path.join(
                __dirname,
                `cache/antithuhoi/messages_${event.threadID}.json`,
              );
              const threadInfo = await api.getThreadInfo(event.threadID);
              const memberInfo = Array.isArray(threadInfo?.userInfo)
                ? threadInfo.userInfo
                : [];
              const nameById = new Map(
                memberInfo.map((u) => [String(u.id), u.name || ""]),
              );
              const history = await api.getThreadHistory(event.threadID, 15);
              const messages = history
                .filter(
                  (msg) => msg.body && String(msg.senderID) !== String(botID),
                )
                .map((msg) => ({
                  messageID: msg.messageID,
                  senderID: msg.senderID,
                  senderName:
                    nameById.get(String(msg.senderID)) ||
                    msg.senderName ||
                    "Unknown",
                  body: msg.body,
                  timestamp: msg.timestamp,
                  attachments: msg.attachments ? msg.attachments.length : 0,
                }))
                .reverse();
              const dir = path.dirname(messagesPath);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(messagesPath, JSON.stringify(messages, null, 2));
            }
          }
        } catch (err) {
          // Im lặng - không print error để không spam log
        }
      }

      if (!event.body) return;

      const body = String(event.body || "").trim();
      const senderID = String(event.senderID || "");
      const threadID = String(event.threadID || "");
      const prefix = config.prefix || "!";

      if (body) {
        console.log(`📩 [MSG] type=${event.type || "unknown"} tid=${threadID} sid=${senderID} body=${body.slice(0, 120)}`);
      }

      const isBotSender = senderID === String(botID);
      const isInbox = threadID && senderID && threadID === senderID;
      const normalizedBody = normalizeText(body);
      const isBangTrigger = body === "!";
      const isBotCallTrigger = /(?:^|\s)bot\s*(dau|oi)(?:\s|$)/.test(normalizedBody);
      const autoAiEnabled = config?.ai?.autoReplyEnabled !== false;
      const isBotGeneratedOutput =
        body.startsWith("🤖 [AI local]:") || body.startsWith("🤖 Có đây.");
      const allowSelfInboxInput = isBotSender && isInbox && !isBotGeneratedOutput;
      const canProcessAiInput = !isBotSender || allowSelfInboxInput;

      const aiHelpMessage =
        "🤖 Có đây. Cách dùng nhanh:\n" +
        "• Gõ !ai <câu hỏi> để hỏi bot.\n" +
        "• Gõ !help để có danh sách lệnh.";

      if (canProcessAiInput && (isBangTrigger || isBotCallTrigger)) {
        await api.sendMessage(aiHelpMessage, event.threadID, event.messageID);
      }

      // Inline AI auto-reply fallback: inbox trả lời trực tiếp, group chỉ trả lời khi reply vào bot.
      if (canProcessAiInput && autoAiEnabled && body && !body.startsWith(prefix)) {
        let allowAutoReply = false;

        if (isInbox) {
          allowAutoReply = true;
        } else if (event.type === "message_reply") {
          const currentMode = getGroupMode(event.threadID);
          if (currentMode !== "user") {
            return;
          }

          const repliedMessage = event.messageReply || {};
          const repliedSenderID = String(
            repliedMessage.senderID || repliedMessage.author || repliedMessage.userID || "",
          );
          if (repliedSenderID === String(botID)) {
            allowAutoReply = true;
          }
        }

        if (allowAutoReply && !isBangTrigger && !isBotCallTrigger) {
          try {
            const result = await runAiConversation({
              api,
              event,
              query: body,
              source: "auto",
            });

            if (result.ok && result.answer) {
              await api.sendMessage(
                `🤖 [AI local]:\n━━━━━━━━━━━━━━━━━━\n${result.answer}`,
                event.threadID,
                event.messageID,
              );
            } else if (result.reason && result.reason !== "cooldown") {
              console.log(`ℹ️ [inlineAutoAI] skipped reason=${result.reason}`);
            }
          } catch (e) {
            console.error("❌ [inlineAutoAI]", e);
          }
        }
      }

      // Lệnh không cần check quyền (tự trong lệnh xử lý)
      const FREE_COMMANDS = ["mode"];

      // =================================================================
      // XỬ LÝ LỆNH CÓ PREFIX (VD: !ve, !taixiu, !reset)
      // =================================================================
      if (event.body.startsWith(prefix)) {
        event = await ensureMentions(api, event);

        const args = event.body.slice(prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = global.commands.get(commandName);

        if (command) {
          try {
            console.log(`🚀 [CMD] ${commandName} | UID: ${event.senderID}`);

            // KIỂM TRA QUYỀN: Bỏ qua các lệnh tự handle quyền
            if (!FREE_COMMANDS.includes(commandName)) {
              const permCheck = await checkPermission(
                event.threadID,
                event.senderID,
                api,
              );
              if (!permCheck.allowed) {
                return api.sendMessage(
                  `❌ Bạn không được dùng lệnh này trong mode hiện tại.`,
                  event.threadID,
                );
              }
            }

            await command.execute({ api, event, args, config });
          } catch (error) {
            api.sendMessage(
              `❌ Lỗi thực thi lệnh: ${commandName}`,
              event.threadID,
            );
          }
        }
      }

      // =================================================================
      // XỬ LÝ REPLY (Tài Xỉu, Bầu Cua...)
      // =================================================================
      if (event.type === "message_reply") {
        const permCheck = await checkPermission(
          event.threadID,
          event.senderID,
          api,
        );
        if (!permCheck.allowed) {
          return;
        }

        global.commands.forEach(async (cmd) => {
          if (cmd.handleReply) {
            try {
              await cmd.handleReply({ api, event, config });
            } catch (e) {
              console.error(`❌ Lỗi handleReply [${cmd.name}]:`, e);
            }
          }
        });
      }
    });
  },
);
