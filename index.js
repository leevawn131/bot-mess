const fs = require("fs");
const path = require("path");
const { login } = require("ws3-fca");
const { checkPermission } = require("./modules/utils/checkPermission");
const { startModeScheduler } = require("./modules/utils/modeScheduler");

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
    credentials = { appState: JSON.parse(fs.readFileSync("appstate.json", "utf8")) }; 
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
        const originalMsg = history.find(m => m.messageID === event.messageID);
        if (originalMsg && originalMsg.mentions && Object.keys(originalMsg.mentions).length > 0) {
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
    } catch { return []; }
};

console.log("⏳ Đang kết nối tới Facebook...");

login(credentials, {
    online: true,
    listenEvents: true,
    selfListen: false,
    userAgent: config.fca?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}, async (err, api) => {
    if (err) return console.error("❌ LOGIN ERROR:", err);

    const botID = api.getCurrentUserID();
    console.log(`✅ Đăng nhập thành công ID: ${botID}`);
    fs.writeFileSync("appstate.json", JSON.stringify(api.getAppState(), null, 2));

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
                data.threadID
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
    if (!fs.existsSync(commandsDir)) fs.mkdirSync(commandsDir, { recursive: true });

    getAllFiles(commandsDir).forEach(file => {
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
    getAllFiles(eventsDir).forEach(file => {
        try { 
            const ev = require(file); 
            if (ev.name) events.set(ev.name, ev); 
        } catch {}
    });

    console.log(`📂 Đã nạp ${global.commands.size} lệnh và ${events.size} sự kiện.`);

    // --- BẬT HẸN GIỜ TỰ ĐỘNG ĐỔI MODE ---
    startModeScheduler(api);

    // --- HÀM ĐẾM TIN NHẮN ---
    const statsPath = path.join(__dirname, "message_stats.json");

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

        const weekNumber = 1 + Math.round((weekDate - firstThursday) / (7 * 24 * 60 * 60 * 1000));
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
                monthly: {}
            };
        }

        if (!raw || typeof raw !== "object") {
            return {
                total: 0,
                daily: {},
                weekly: {},
                monthly: {}
            };
        }

        return {
            total: Number(raw.total) || 0,
            daily: raw.daily && typeof raw.daily === "object" ? raw.daily : {},
            weekly: raw.weekly && typeof raw.weekly === "object" ? raw.weekly : {},
            monthly: raw.monthly && typeof raw.monthly === "object" ? raw.monthly : {}
        };
    };

    const updateMessageStats = (senderID, threadID) => {
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
        } catch (e) {
            console.error("❌ Lỗi cập nhật thống kê tin nhắn:", e);
        }
    };

    // --- LISTENER CHÍNH ---
    api.listenMqtt(async (err, event) => {
        if (err) return console.error("Listen Error:", err);
        
        // 1. Xử lý Event hệ thống (Log message)
        if (event.logMessageType) {
            events.forEach(async (ev) => {
                if (ev.eventType && ev.eventType.includes(event.logMessageType)) {
                    try { await ev.execute({ api, event, config }); } catch (e) {}
                }
            });
        }

        // 2. Đếm tin nhắn (bỏ qua bot và tin nhắn không có body)
        if (event.body && event.senderID && event.senderID != botID && event.threadID) {
            updateMessageStats(event.senderID, event.threadID);
        }

        if (!event.body) return;

        const prefix = config.prefix || "!";

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
                        const permCheck = await checkPermission(event.threadID, event.senderID, api);
                        if (!permCheck.allowed) {
                            return api.sendMessage(
                                `❌ Bạn không được dùng lệnh này trong mode hiện tại.`,
                                event.threadID
                            );
                        }
                    }
                    
                    await command.execute({ api, event, args, config });
                } catch (error) {
                    api.sendMessage(`❌ Lỗi thực thi lệnh: ${commandName}`, event.threadID);
                }
            }
        }
        
        // =================================================================
        // XỬ LÝ REPLY (Tài Xỉu, Bầu Cua...)
        // =================================================================
        if (event.type === "message_reply") {
            const permCheck = await checkPermission(event.threadID, event.senderID, api);
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
});