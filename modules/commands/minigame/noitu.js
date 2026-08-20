const { checkCooldown } = require("../../utils/cooldown");
const { execute: executeQuery } = require("../../utils/database");
const { toAdminIdList } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const axios = require("axios");
const prefix = process.env.BOT_PREFIX;

async function resolveUserName(api, threadID, uid) {
    const id = String(uid || "").trim();
    if (!id) return "Thành viên";

    try {
        const threadInfo = await getThreadInfoCached(api, threadID);
        if (threadInfo && Array.isArray(threadInfo.userInfo)) {
            const found = threadInfo.userInfo.find(u => String(u.id) === id);
            if (found && found.name) return found.name;
        }
    } catch (_) {}

    if (global.data?.userName?.has(id)) return global.data.userName.get(id);

    try {
        const rows = await executeQuery("SELECT name FROM messenger_users WHERE psid = ? AND name != 'Người dùng' AND name != '' LIMIT 1", [id]);
        if (rows && rows[0] && rows[0].name) return rows[0].name;
    } catch (_) {}

    try {
        const info = await api.getUserInfo(id);
        if (info && info[id] && info[id].name) {
            if (global.data?.userName) global.data.userName.set(id, info[id].name);
            return info[id].name;
        }
    } catch (_) {}

    return "Thành viên";
}

// Lưu trữ phiên minigame theo threadID
global.noituSessions = global.noituSessions || {};

const STARTER_WORDS = [
    "học tập", "tự do", "hạnh phúc", "mạnh mẽ", "yêu thương",
    "bình yên", "trong xanh", "sáng sủa", "mưa rơi", "nắng ấm",
    "ngăn nắp", "tươi cười", "nhanh nhẹn", "hiền lành", "trí tuệ",
    "đoàn kết", "kiên trì", "sáng tạo", "thành công", "may mắn"
];

// Helper để chuẩn hóa dấu tiếng Việt (mới -> cũ)
function normalizeVietnamese(str) {
    if (!str) return "";
    let normalized = str.normalize("NFC").toLowerCase().trim();
    const toneMap = {
        "óa": "oá", "òa": "oà", "ỏa": "oả", "õa": "oã", "ọa": "oạ",
        "óe": "oé", "òe": "oè", "ỏe": "oẻ", "õe": "oẽ", "ọe": "oẹ",
        "úy": "uý", "ùy": "uỳ", "ủy": "uỷ", "ũy": "uỹ", "ụy": "uỵ"
    };
    for (const [key, value] of Object.entries(toneMap)) {
        normalized = normalized.replace(new RegExp(key, "g"), value);
    }
    return normalized;
}

// Helper để parse JSON từ kết quả trả về của AI
function parseJsonFromText(text) {
    if (!text) return null;
    try {
        return JSON.parse(text.trim());
    } catch (e) {
        const match = text.match(/\{[\s\S]*?\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (e2) {
                return null;
            }
        }
        return null;
    }
}

// Gọi Groq AI để tạo từ tiếp theo cho Bot
async function generateWordWithAI(prevWord, usedWords = []) {
    const apiKey = (process.env.GROQ_APIKEY || process.env.GROQ_API_KEY || "").trim();
    if (!apiKey) {
        console.error("generateWordWithAI error: GROQ_APIKEY chưa được thiết lập trong .env");
        return null;
    }

    const rawLastSyllable = prevWord.trim().split(/\s+/).pop();
    const targetSyllable = normalizeVietnamese(rawLastSyllable);
    const prevSyllables = normalizeVietnamese(prevWord).split(/\s+/).filter(Boolean);
    const normalizedUsed = (usedWords || []).map(w => normalizeVietnamese(w));

    let messages = [
        {
            role: "system",
            content: `Bạn là người chơi trong trò chơi Nối từ tiếng Việt. Bạn phải đưa ra một từ ghép hoặc từ láy tiếng Việt gồm đúng 2 âm tiết (2 tiếng) có nghĩa thực sự trong từ điển tiếng Việt, bắt đầu bằng âm tiết được yêu cầu.
CÁC ĐIỀU CẤM TUYỆT ĐỐI:
1. KHÔNG được đổi dấu thanh hoặc sửa ký tự của âm tiết bắt đầu. Giữ nguyên 100% âm tiết bắt đầu.
2. TUYỆT ĐỐI CẤM lặp 2 âm tiết giống nhau (Ví dụ: CẤM 'biếc biếc', 'học học', 'nghĩ nghĩ').
3. TUYỆT ĐỐI CẤM đảo ngược từ liền trước (Ví dụ: từ trước là 'nghỉ ngơi' thì CẤM 'ngơi nghỉ', 'liệu dược' thì CẤM 'dược liệu').
4. TUYỆT ĐỐI CẤM bịa từ vô nghĩa, từ ghép gượng ép hoặc chèn tiếng Anh.
5. Chỉ trả về một đối tượng JSON duy nhất có cấu trúc: {"word": "từ ghép 2 tiếng", "meaning": "ý nghĩa ngắn gọn"}`
        },
        {
            role: "user",
            content: `Từ trước đó là: "${prevWord}". Âm tiết bắt đầu của từ tiếp theo PHẢI là: "${rawLastSyllable}". Hãy tìm từ nối tiếng Việt hợp lệ.`
        }
    ];

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
                messages: messages,
                temperature: 0.2 + (attempt - 1) * 0.15,
                response_format: { type: "json_object" }
            }, {
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                timeout: 10000
            });

            const content = res.data?.choices?.[0]?.message?.content || "";
            const json = parseJsonFromText(content);
            if (!json || !json.word) {
                messages.push({ role: "assistant", content: content || "{}" });
                messages.push({ role: "user", content: "Lỗi: Không tìm thấy trường 'word' trong JSON. Hãy trả về JSON hợp lệ." });
                continue;
            }

            const candidate = normalizeVietnamese(json.word.trim());
            const syllables = candidate.split(/\s+/).filter(Boolean);

            // 1. Kiểm tra số lượng âm tiết
            if (syllables.length !== 2) {
                messages.push({ role: "assistant", content });
                messages.push({ role: "user", content: `Lỗi: Từ "${candidate}" không có đúng 2 âm tiết. Hãy tìm một từ khác gồm đúng 2 âm tiết bắt đầu bằng "${rawLastSyllable}".` });
                continue;
            }

            // 2. Kiểm tra âm tiết đầu
            if (syllables[0] !== targetSyllable) {
                messages.push({ role: "assistant", content });
                messages.push({ role: "user", content: `Lỗi: Từ "${candidate}" bắt đầu bằng "${syllables[0]}", không khớp với "${rawLastSyllable}". Phải bắt đầu chính xác bằng "${rawLastSyllable}".` });
                continue;
            }

            // 3. Chặn lặp 2 âm tiết giống nhau (A A)
            if (syllables[0] === syllables[1]) {
                messages.push({ role: "assistant", content });
                messages.push({ role: "user", content: `Lỗi: Từ "${candidate}" lặp lại 2 âm tiết giống nhau. Luật chơi cấm lặp từ. Hãy tìm từ khác có 2 âm tiết phân biệt.` });
                continue;
            }

            // 4. Chặn đảo chữ của từ liền trước (A B -> B A)
            if (prevSyllables.length === 2 && syllables[0] === prevSyllables[1] && syllables[1] === prevSyllables[0]) {
                messages.push({ role: "assistant", content });
                messages.push({ role: "user", content: `Lỗi: Từ "${candidate}" là từ đảo ngược của "${prevWord}". Luật chơi cấm đảo ngược chữ. Hãy tìm từ khác.` });
                continue;
            }

            // 5. Kiểm tra từ đã dùng
            if (normalizedUsed.includes(candidate)) {
                messages.push({ role: "assistant", content });
                messages.push({ role: "user", content: `Lỗi: Từ "${candidate}" đã được sử dụng trước đó trong ván này. Hãy chọn một từ mới.` });
                continue;
            }

            // 6. Thẩm định nghĩa từ qua giám khảo AI
            const check = await verifyWordWithAI(candidate);
            if (!check.valid) {
                messages.push({ role: "assistant", content });
                messages.push({ role: "user", content: `Lỗi: Từ "${candidate}" không được công nhận: ${check.reason}. Hãy tìm một từ ghép/từ láy tiếng Việt phổ biến, có nghĩa rõ ràng trong từ điển.` });
                continue;
            }

            // Từ hoàn toàn hợp lệ
            return candidate;
        } catch (err) {
            console.error(`generateWordWithAI attempt ${attempt} error:`, err?.response?.data || err.message);
        }
    }

    return null;
}

// Gọi Groq AI để kiểm tra nghĩa của từ
async function verifyWordWithAI(word) {
    const apiKey = (process.env.GROQ_APIKEY || process.env.GROQ_API_KEY || "").trim();
    if (!apiKey) {
        console.error("verifyWordWithAI error: GROQ_APIKEY chưa được thiết lập trong .env");
        return { valid: true, reason: "Xác nhận ngoại tuyến (Thiếu GROQ_APIKEY trong .env)" };
    }

    const syllables = normalizeVietnamese(word).split(/\s+/).filter(Boolean);
    if (syllables.length !== 2) {
        return { valid: false, reason: "Từ phải gồm đúng 2 âm tiết tiếng Việt" };
    }
    if (syllables[0] === syllables[1]) {
        return { valid: false, reason: "Không được lặp lại 2 âm tiết giống nhau" };
    }

    const url = "https://api.groq.com/openai/v1/chat/completions";

    const prompt = `Bạn là giám khảo khắt khe trong trò chơi Nối từ tiếng Việt. Hãy kiểm tra từ "${word}".
Tiêu chuẩn thẩm định:
1. Từ này có phải là một TỪ GHÉP hoặc TỪ LÁY có nghĩa thực sự và được công nhận trong từ điển tiếng Việt hay không?
2. TUYỆT ĐỐI KHÔNG CHẤP NHẬN các từ tự ghép bừa bãi không tự nhiên, từ chế, từ vô nghĩa (ví dụ: 'biếc biếc', 'biếc màu', 'biếc chìm', 'nước chạy', 'tóc đỏ', 'nghỉ đi').
3. Hãy trả về một đối tượng JSON có định dạng như sau:
{
  "valid": true,
  "reason": "Giải thích ngắn gọn ý nghĩa của từ"
}
Hoặc nếu không hợp lệ:
{
  "valid": false,
  "reason": "Lý do từ không có nghĩa hoặc không hợp lệ"
}
Đảm bảo kết quả trả về chỉ gồm mã JSON hợp lệ, không thêm bất kỳ văn bản nào khác.`;

    try {
        const res = await axios.post(url, {
            model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" }
        }, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            timeout: 10000
        });

        const content = res.data?.choices?.[0]?.message?.content || "";
        const json = parseJsonFromText(content);
        if (json && typeof json.valid === "boolean") {
            return json;
        }
        return { valid: false, reason: "Lỗi phân tích kết quả AI" };
    } catch (err) {
        console.error("verifyWordWithAI error:", err?.response?.data || err.message);
        // Fallback offline: cho phép từ nếu có mạng/API lỗi nhưng cú pháp đúng
        return { valid: true, reason: "Xác nhận ngoại tuyến (Lỗi kết nối AI)" };
    }
}

// Bắt đầu đếm ngược 30 giây cho lượt đi
function startTurnTimer(api, threadID) {
    const session = global.noituSessions[threadID];
    if (!session || session.status !== "playing") return;

    if (session.timer) clearTimeout(session.timer);

    session.timer = setTimeout(async () => {
        const currentPlayerID = session.turnOrder[session.turnIndex];
        const playerIndex = session.players.findIndex(p => String(p.id) === String(currentPlayerID));
        const playerName = session.players[playerIndex]?.name || `Người chơi ${currentPlayerID}`;

        await api.sendMessage(`⏰ Hết giờ! @${playerName} đã không đưa ra từ nối trong 30 giây và bị LOẠI! ❌`, threadID);

        // Loại người chơi khỏi phòng
        await eliminatePlayer(api, threadID, currentPlayerID);
    }, 30000);
}

// Loại bỏ người chơi khi thua cuộc hoặc hết giờ
async function eliminatePlayer(api, threadID, playerID) {
    const session = global.noituSessions[threadID];
    if (!session) return;

    if (session.timer) {
        clearTimeout(session.timer);
        session.timer = null;
    }

    const playerIndex = session.players.findIndex(p => String(p.id) === String(playerID));
    if (playerIndex !== -1) {
        session.players.splice(playerIndex, 1);
    }

    session.turnOrder = session.turnOrder.filter(id => String(id) !== String(playerID));

    if (session.players.length === 0) {
        await api.sendMessage("👑 Trò chơi kết thúc! Không còn người chơi nào sống sót. Bot đã giành chiến thắng chung cuộc! 🤖", threadID);
        delete global.noituSessions[threadID];
        return;
    }

    if (session.players.length === 1 && !session.turnOrder.includes("bot")) {
        return endGame(api, threadID, "players");
    }

    if (session.turnIndex >= session.turnOrder.length) {
        session.turnIndex = 0;
    }

    await handleNextTurn(api, threadID);
}

// Kết thúc trò chơi và vinh danh người thắng cuộc
async function endGame(api, threadID, winnerType) {
    const session = global.noituSessions[threadID];
    if (!session) return;

    if (session.timer) {
        clearTimeout(session.timer);
        session.timer = null;
    }

    if (winnerType === "players") {
        const winners = session.players.map(p => `@${p.name}`).join(", ");
        const mentions = session.players.map(p => ({ id: p.id, tag: `@${p.name}` }));

        let msg = `🏆 CHÚC MỪNG CHIẾN THẮNG! 🏆\nTrò chơi kết thúc! Cửa ải cuối cùng đã được chinh phục.\n\nNgười chiến thắng chung cuộc: ${winners}\n\n`;
        msg += `📊 Bảng điểm tích lũy trận này:\n`;
        for (const p of session.players) {
            msg += `- ${p.name}: ${session.scores[p.id] || 0} điểm (+${session.scores[p.id] || 0} xu cược)\n`;
        }

        await api.sendMessage({ body: msg, mentions }, threadID);
    }

    delete global.noituSessions[threadID];
}

// Điều phối lượt chơi tiếp theo
async function handleNextTurn(api, threadID) {
    const session = global.noituSessions[threadID];
    if (!session || session.status !== "playing") return;

    const currentPlayerID = session.turnOrder[session.turnIndex];

    if (currentPlayerID === "bot") {
        await api.sendMessage("🤖 Bot đang suy nghĩ...", threadID);

        let botWord = null;
        try {
            botWord = await generateWordWithAI(session.lastWord, session.usedWords);
        } catch (err) {
            console.error("Lỗi bot tạo từ:", err);
        }

        if (botWord) {
            botWord = normalizeVietnamese(botWord);
        }

        // Tìm từ thay thế từ danh sách từ starter nếu AI không trả về
        if (!botWord) {
            const lastSyllableOfPrev = normalizeVietnamese(session.lastWord.split(/\s+/).pop());
            const possibleFallbacks = STARTER_WORDS.filter(w => normalizeVietnamese(w).startsWith(lastSyllableOfPrev));
            const unusedFallback = possibleFallbacks.find(w => !session.usedWords.includes(normalizeVietnamese(w)));
            if (unusedFallback) {
                botWord = normalizeVietnamese(unusedFallback);
            }
        }

        if (!botWord) {
            await api.sendMessage("😭 Bot không thể nghĩ ra từ nào hợp lệ tiếp theo và đã bị LOẠI! ❌", threadID);
            session.turnOrder = session.turnOrder.filter(id => id !== "bot");

            if (session.players.length === 1) {
                return endGame(api, threadID, "players");
            }

            await api.sendMessage("🎮 Trò chơi tiếp tục giữa các thành viên còn lại!", threadID);
            if (session.turnIndex >= session.turnOrder.length) {
                session.turnIndex = 0;
            }
            await handleNextTurn(api, threadID);
            return;
        }

        if (session.usedWords.includes(botWord)) {
            await api.sendMessage(`🤖 Bot đã nghĩ trùng lại từ cũ **"${botWord}"** và đã bị LOẠI! ❌`, threadID);
            session.turnOrder = session.turnOrder.filter(id => id !== "bot");

            if (session.players.length === 1) {
                return endGame(api, threadID, "players");
            }

            await api.sendMessage("🎮 Trò chơi tiếp tục giữa các thành viên còn lại!", threadID);
            if (session.turnIndex >= session.turnOrder.length) {
                session.turnIndex = 0;
            }
            await handleNextTurn(api, threadID);
            return;
        }

        session.usedWords.push(botWord);
        session.lastWord = botWord;

        const info = await api.sendMessage(`🤖 Bot: **${botWord}**`, threadID, session.lastMessageID);
        session.lastMessageID = info.messageID;
        session.lastPlayerID = "bot";

        // Chuyển lượt sang người tiếp theo
        session.turnIndex = (session.turnIndex + 1) % session.turnOrder.length;
        await handleNextTurn(api, threadID);
    } else {
        const player = session.players.find(p => String(p.id) === String(currentPlayerID));
        if (!player) {
            session.turnIndex = (session.turnIndex + 1) % session.turnOrder.length;
            return handleNextTurn(api, threadID);
        }

        const lastSyllableOfPrev = session.lastWord.split(/\s+/).pop().toLowerCase();
        const msg = `👉 Lượt của @${player.name} (30s)!\nTừ tiếp theo phải bắt đầu bằng chữ: **${lastSyllableOfPrev}**\n\n⚠️ Bạn phải REPLY tin nhắn trên của Bot để trả lời!`;

        const info = await api.sendMessage({
            body: msg,
            mentions: [{ id: player.id, tag: `@${player.name}` }]
        }, threadID, session.lastMessageID);

        session.lastMessageID = info.messageID;

        // Bắt đầu đếm ngược 30s
        startTurnTimer(api, threadID);
    }
}

module.exports = {
    name: "noitu",
    description: "Minigame Nối Từ tiếng Việt sử dụng AI để kiểm tra nghĩa",
    usage: `\n${prefix}noitu open → Mở phòng nối từ\n${prefix}noitu start → Bắt đầu game\n${prefix}noitu stop → Kết thúc game\n━━━━━━━━━━━━━\n🎮 Cách chơi:\n- Khi mở phòng, reply tin nhắn mở để đăng ký\n- Khi bắt đầu, hệ thống xếp lượt ngẫu nhiên (Bot đi trước)\n- Phải reply tin nhắn chứa từ liền trước để nối từ\n- Mỗi lượt có 30 giây để trả lời. Từ phải có 2 âm tiết và có nghĩa\n- Trả lời đúng nhận +1 xu thưởng (credits), trả lời sai/hết giờ bị loại lập tức!`,

    execute: async ({ api, event, args, config }) => {
        const { threadID, senderID, messageID } = event;
        const action = String(args[0] || "").toLowerCase();

        // 1. LỆNH: !noitu open (Mở phòng)
        if (action === "open" || action === "new") {
            if (global.noituSessions[threadID]) {
                return api.sendMessage(`⚠️ Nhóm này đang có một phòng nối từ rồi! Gõ ${prefix}noitu start để bắt đầu hoặc ${prefix}noitu stop để kết thúc.`, threadID, messageID);
            }

            const info = await api.sendMessage(`🎮 MINIGAME NỐI TỪ TIẾNG VIỆT 🎮\n━━━━━━━━━━━━━━━━━━━━\n👉 Hãy reply (trả lời) tin nhắn này để đăng ký tham gia!\n\n👑 Chủ phòng gõ ${prefix}noitu start để bắt đầu khi đã đủ người chơi.`, threadID);

            global.noituSessions[threadID] = {
                status: "registering",
                creator: senderID,
                messageID: info.messageID,
                players: [],
                scores: {},
                usedWords: []
            };
            return;
        }

        // 2. LỆNH: !noitu start (Bắt đầu)
        if (action === "start") {
            const session = global.noituSessions[threadID];
            if (!session) {
                return api.sendMessage(`❌ Chưa mở phòng nối từ nào. Gõ ${prefix}noitu open để mở phòng!`, threadID, messageID);
            }
            if (session.status !== "registering") {
                return api.sendMessage("⚠️ Trò chơi đã bắt đầu rồi!", threadID, messageID);
            }
            if (session.players.length === 0) {
                return api.sendMessage("❌ Không có ai đăng ký tham gia! Hãy reply tin nhắn open để đăng ký trước.", threadID, messageID);
            }

            // Kiểm tra quyền (chủ phòng, QTV hoặc Admin Bot)
            let isGroupAdmin = false;
            try {
                const threadInfo = await getThreadInfoCached(api, threadID);
                const adminIDs = toAdminIdList(threadInfo);
                isGroupAdmin = adminIDs.includes(String(senderID));
            } catch (_) {}

            const isBotAdmin = config.adminIDs.map(id => String(id)).includes(String(senderID));

            if (String(senderID) !== String(session.creator) && !isGroupAdmin && !isBotAdmin) {
                return api.sendMessage("⚠️ Chỉ chủ phòng, QTV nhóm hoặc Admin Bot mới được phép bắt đầu trò chơi!", threadID, messageID);
            }

            // Xếp lượt ngẫu nhiên
            const shuffled = [...session.players].sort(() => Math.random() - 0.5);
            session.turnOrder = ["bot", ...shuffled.map(p => p.id)];
            session.status = "playing";
            session.turnIndex = 0;

            // Lấy từ mở đầu ngẫu nhiên từ kho từ starter
            const starterWord = STARTER_WORDS[Math.floor(Math.random() * STARTER_WORDS.length)];
            session.lastWord = normalizeVietnamese(starterWord);
            session.usedWords.push(session.lastWord);

            const startMsg = `🎮 **TRẬN NỐI TỪ BẮT ĐẦU** 🎮\n━━━━━━━━━━━━━━━━━━━━\n` +
                `👥 Thứ tự lượt chơi:\n` +
                `1. 🤖 Bot (Đầu)\n` +
                shuffled.map((p, idx) => `${idx + 2}. @${p.name}`).join("\n") +
                `\n━━━━━━━━━━━━━━━━━━━━\n` +
                `🤖 Lượt đi đầu của Bot: **${starterWord}**`;

            const mentions = shuffled.map(p => ({ id: p.id, tag: `@${p.name}` }));
            const info = await api.sendMessage({ body: startMsg, mentions }, threadID);

            session.lastMessageID = info.messageID;
            session.turnIndex = 1; // Nhảy tới người chơi thứ nhất sau Bot

            // Chạy lượt đầu của người chơi
            await handleNextTurn(api, threadID);
            return;
        }

        // 3. LỆNH: !noitu stop (Dừng game)
        if (action === "stop" || action === "end" || action === "quit") {
            const session = global.noituSessions[threadID];
            if (!session) {
                return api.sendMessage("❌ Không có trận đấu nối từ nào đang diễn ra để dừng.", threadID, messageID);
            }

            // Kiểm tra quyền
            let isGroupAdmin = false;
            try {
                const threadInfo = await getThreadInfoCached(api, threadID);
                const adminIDs = toAdminIdList(threadInfo);
                isGroupAdmin = adminIDs.includes(String(senderID));
            } catch (_) {}

            const isBotAdmin = config.adminIDs.map(id => String(id)).includes(String(senderID));

            if (String(senderID) !== String(session.creator) && !isGroupAdmin && !isBotAdmin) {
                return api.sendMessage("⚠️ Chỉ chủ phòng, QTV nhóm hoặc Admin Bot mới được phép hủy trò chơi!", threadID, messageID);
            }

            if (session.timer) {
                clearTimeout(session.timer);
            }

            delete global.noituSessions[threadID];
            return api.sendMessage("⏹️ Trò chơi nối từ đã bị hủy bỏ.", threadID, messageID);
        }

        // Mặc định: Hướng dẫn
        return api.sendMessage(`⚠️ Cú pháp không hợp lệ. Hướng dẫn:\n- ${prefix}noitu open : Mở phòng chơi mới\n- ${prefix}noitu start : Bắt đầu game\n- ${prefix}noitu stop : Dừng game`, threadID, messageID);
    },

    handleReply: async ({ api, event, config }) => {
        const { threadID, senderID, messageID, messageReply, body } = event;
        const session = global.noituSessions[threadID];

        if (!session) return;
        if (!messageReply) return;

        const botID = String(api.getCurrentUserID());
        if (String(senderID) === botID) return;

        // --- Xử lý 1: Đăng ký ---
        if (session.status === "registering") {
            if (String(messageReply.messageID) !== String(session.messageID)) return;

            const exists = session.players.find(p => String(p.id) === String(senderID));
            if (exists) {
                return api.sendMessage("⚠️ Bạn đã đăng ký tham gia phòng này rồi!", threadID, messageID);
            }

            const senderName = await resolveUserName(api, threadID, senderID);

            session.players.push({ id: senderID, name: senderName });
            session.scores[senderID] = 0;

            api.setMessageReaction("✅", messageID, () => {}, true);
            return api.sendMessage(`✅ **${senderName}** đăng ký thành công! (Phòng đang có: ${session.players.length} người chơi)`, threadID);
        }

        // --- Xử lý 2: Nối từ ---
        if (session.status === "playing") {
            const currentTurnPlayerID = session.turnOrder[session.turnIndex];

            // Nếu reply sai tin nhắn nối từ
            if (String(messageReply.messageID) !== String(session.lastMessageID)) {
                if (String(senderID) === String(currentTurnPlayerID)) {
                    return api.sendMessage(`⚠️ Bạn trả lời sai tin nhắn nối từ! Bạn phải reply đúng tin nhắn chứa từ liền trước (**${session.lastWord}**).`, threadID, messageID);
                }
                return;
            }

            // Kiểm tra có đúng lượt người chơi hay không
            if (String(senderID) !== String(currentTurnPlayerID)) {
                return api.sendMessage("⚠️ Chưa đến lượt của bạn!", threadID, messageID);
            }

            const word = normalizeVietnamese(body);
            const playerIndex = session.players.findIndex(p => String(p.id) === String(senderID));
            const playerName = session.players[playerIndex]?.name || `Người chơi ${senderID}`;

            // 1. Cú pháp: 2 từ/âm tiết
            const syllables = word.split(/\s+/).filter(Boolean);
            if (syllables.length !== 2) {
                api.setMessageReaction("❌", messageID, () => {}, true);
                await api.sendMessage(`❌ **${playerName}** trả lời sai cú pháp (từ phải có đúng 2 từ/tiếng). Bạn đã bị LOẠI!`, threadID, messageID);
                return eliminatePlayer(api, threadID, senderID);
            }

            // 2. Kiểm tra chữ đầu của từ mới khớp với chữ cuối của từ cũ
            const prevWord = session.lastWord;
            const prevSyllables = prevWord.trim().split(/\s+/).filter(Boolean);
            const lastSyllableOfPrev = normalizeVietnamese(prevSyllables[prevSyllables.length - 1]);

            if (syllables[0] !== lastSyllableOfPrev) {
                api.setMessageReaction("❌", messageID, () => {}, true);
                await api.sendMessage(`❌ **${playerName}** nối từ không khớp! Từ phải bắt đầu bằng **"${lastSyllableOfPrev}"**. Bạn đã bị LOẠI!`, threadID, messageID);
                return eliminatePlayer(api, threadID, senderID);
            }

            // 3. Chặn lặp 2 âm tiết giống nhau (A A)
            if (syllables[0] === syllables[1]) {
                api.setMessageReaction("❌", messageID, () => {}, true);
                await api.sendMessage(`❌ **${playerName}** trả lời từ lặp âm tiết (**"${word}"**). Luật chơi cấm lặp lại 2 âm tiết giống nhau, bạn đã bị LOẠI!`, threadID, messageID);
                return eliminatePlayer(api, threadID, senderID);
            }

            // 4. Chặn đảo ngược từ liền trước (A B -> B A)
            if (prevSyllables.length === 2 && syllables[0] === prevSyllables[1] && syllables[1] === prevSyllables[0]) {
                api.setMessageReaction("❌", messageID, () => {}, true);
                await api.sendMessage(`❌ **${playerName}** chơi đảo ngược chữ của từ liền trước (**"${prevWord}"** ➔ **"${word}"**). Luật chơi cấm đảo chữ, bạn đã bị LOẠI!`, threadID, messageID);
                return eliminatePlayer(api, threadID, senderID);
            }

            // 5. Kiểm tra từ đã dùng
            if (session.usedWords.includes(word)) {
                api.setMessageReaction("❌", messageID, () => {}, true);
                await api.sendMessage(`❌ **${playerName}** trả lời từ đã được sử dụng trước đó trong trận (**"${word}"**). Bạn đã bị LOẠI!`, threadID, messageID);
                return eliminatePlayer(api, threadID, senderID);
            }

            // 6. Kiểm tra nghĩa bằng AI
            api.setMessageReaction("🔄", messageID, () => {}, true);
            const check = await verifyWordWithAI(word);

            if (!check.valid) {
                api.setMessageReaction("❌", messageID, () => {}, true);
                await api.sendMessage(`❌ **${playerName}** trả lời từ không có nghĩa hoặc không hợp lệ: **${check.reason || "Từ không có nghĩa trong từ điển"}**. Bạn đã bị LOẠI!`, threadID, messageID);
                return eliminatePlayer(api, threadID, senderID);
            }

            // Nếu hợp lệ
            api.setMessageReaction("✅", messageID, () => {}, true);

            if (session.timer) {
                clearTimeout(session.timer);
                session.timer = null;
            }

            session.usedWords.push(word);
            session.lastWord = word;
            session.lastMessageID = messageID;
            session.scores[senderID] = (session.scores[senderID] || 0) + 1;

            // Cộng +1 credit trong database (parameterized query)
            try {
                await executeQuery("UPDATE messenger_users SET credits = credits + 1 WHERE thread_id = ? AND psid = ?", [String(threadID), senderID]);
            } catch (err) {
                console.error("Lỗi cập nhật database credits:", err);
            }

            // Chuyển lượt
            session.turnIndex = (session.turnIndex + 1) % session.turnOrder.length;
            await handleNextTurn(api, threadID);
        }
    }
};
