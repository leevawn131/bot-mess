const { checkCooldown } = require("../../utils/cooldown");
const {
    buildProfileLink,
    formatTimestamp,
    getLeaveHistoryByPeriod
} = require("../../utils/leaveHistory");

function normalizePeriod(raw = "") {
    const value = String(raw || "").trim().toLowerCase();

    if (!value || ["ngay", "day", "d", "today", "homnay"].includes(value)) return "day";
    if (["tuan", "week", "w"].includes(value)) return "week";
    if (["thang", "month", "m"].includes(value)) return "month";
    return null;
}

function chunkLines(lines, maxChars = 3500) {
    const chunks = [];
    let current = "";

    for (const line of lines) {
        const nextLine = `${line}\n`;
        if ((current + nextLine).length > maxChars) {
            if (current.trim()) chunks.push(current.trimEnd());
            current = "";
        }
        current += nextLine;
    }

    if (current.trim()) chunks.push(current.trimEnd());
    return chunks;
}

function getActionLabel(action) {
    return action === "kick" ? "bị xóa" : "tự rời";
}

async function sendChunks(api, threadID, replyToMessageID, lines) {
    const chunks = chunkLines(lines);
    const sentMessages = [];

    for (let i = 0; i < chunks.length; i++) {
        const info = await api.sendMessage(chunks[i], threadID, i === chunks.length - 1 ? replyToMessageID : undefined);
        sentMessages.push(info || null);
    }

    return sentMessages;
}

module.exports = {
    name: "checkout",
    description: "Xem lịch sử thành viên rời nhóm theo ngày, tuần, tháng",
    usage: "\n!checkout → Xem lịch sử rời nhóm hôm nay\n!checkout tuan → Xem trong tuần này\n!checkout thang → Xem trong tháng này\n━━━━━━━━━━━━━━━━━━\n📝 Hiển thị ai rời, thời gian, lý do\n↩️ Tuần: Reply STT để lấy link Facebook",

    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;

        const cooldown = checkCooldown({ command: "lsroi", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            const threadInfo = await api.getThreadInfo(threadID);
            if (!threadInfo || typeof threadInfo !== 'object' || !threadInfo.isGroup) {
                return api.sendMessage("⚠️ Lệnh này chỉ dùng trong nhóm chat.", threadID, messageID);
            }

            const participantSet = new Set((threadInfo.participantIDs || []).map(id => String(id)));

            const period = normalizePeriod(args[0]);
            if (!period) {
                return api.sendMessage("⚠️ Cách dùng: !lsroi [ngay | tuan | thang]", threadID, messageID);
            }

            const entries = getLeaveHistoryByPeriod(threadID, period)
                .filter((entry) => !participantSet.has(String(entry.uid)));
            if (entries.length === 0) {
                const labelMap = {
                    day: "hôm nay",
                    week: "tuần này",
                    month: "tháng này"
                };
                return api.sendMessage(`📭 Chưa có ai rời nhóm trong ${labelMap[period]}.`, threadID, messageID);
            }

            if (period === "day") {
                const lines = [
                    `📆 LỊCH SỬ RỜI NHÓM HÔM NAY (${entries.length})`,
                    "━━━━━━━━━━━━━"
                ];

                entries.forEach((entry, index) => {
                    lines.push(`${index + 1}. ${entry.name} | ${formatTimestamp(entry.leftAt, { includeDate: false, includeSeconds: true })} | ${buildProfileLink(entry.uid)}`);
                });

                return sendChunks(api, threadID, messageID, lines);
            }

            if (period === "week") {
                const lines = [
                    `📚 LỊCH SỬ RỜI NHÓM TUẦN NÀY (${entries.length})`,
                    "━━━━━━━━━━━━━"
                ];

                entries.forEach((entry, index) => {
                    lines.push(`${index + 1}. ${entry.name} • ${formatTimestamp(entry.leftAt, { includeDate: true, includeSeconds: false })} • ${getActionLabel(entry.action)}`);
                });

                lines.push("━━━━━━━━━━━━━");
                lines.push("↩️ Reply STT (ví dụ: 1 hoặc 1 3 5) để nhận link Facebook.");

                const sentMessages = await sendChunks(api, threadID, messageID, lines);
                global.leaveHistoryReplyContexts = global.leaveHistoryReplyContexts || {};

                sentMessages.forEach((info) => {
                    if (info?.messageID) {
                        global.leaveHistoryReplyContexts[info.messageID] = {
                            author: String(senderID),
                            threadID: String(threadID),
                            entries
                        };
                    }
                });
                return;
            }

            const lines = [
                `🗓️ LỊCH SỬ RỜI NHÓM THÁNG NÀY (${entries.length})`,
                "━━━━━━━━━━━━━"
            ];

            entries.forEach((entry, index) => {
                lines.push(`${index + 1}. ${entry.name} • ${formatTimestamp(entry.leftAt, { includeDate: true, includeSeconds: false })}`);
            });

            return sendChunks(api, threadID, messageID, lines);
        } catch (e) {
            console.error("Lỗi lsroi:", e);
            return api.sendMessage("❌ Không thể lấy lịch sử rời nhóm lúc này.", threadID, messageID);
        }
    },

    handleReply: async ({ api, event }) => {
        try {
            if (event.type !== "message_reply") return;

            const { threadID, senderID, messageID, messageReply, body } = event;
            const replyContexts = global.leaveHistoryReplyContexts || {};
            const context = replyContexts[messageReply?.messageID];
            if (!context) return;

            if (String(context.threadID) !== String(threadID)) return;
            if (String(context.author) !== String(senderID)) {
                return api.sendMessage("⚠️ Chỉ người gọi lsroi mới được reply STT.", threadID, messageID);
            }

            const input = String(body || "").trim();
            const sttMatches = input.match(/\d+/g) || [];
            const sttList = [...new Set(sttMatches.map(n => Number(n)).filter(Number.isInteger))];

            if (sttList.length === 0) {
                return api.sendMessage("⚠️ STT không hợp lệ. Ví dụ: 1 hoặc 1 3 5", threadID, messageID);
            }

            if (sttList.length > 10) {
                return api.sendMessage("⚠️ Mỗi lần chỉ lấy tối đa 10 STT.", threadID, messageID);
            }

            if (sttList.some(stt => stt < 1 || stt > context.entries.length)) {
                return api.sendMessage("⚠️ Có STT vượt ngoài danh sách tuần này.", threadID, messageID);
            }

            const lines = ["🔗 LINK FACEBOOK"];
            sttList.forEach((stt) => {
                const entry = context.entries[stt - 1];
                lines.push(`${stt}. ${entry.name} • ${buildProfileLink(entry.uid)}`);
            });

            return api.sendMessage(lines.join("\n"), threadID, messageID);
        } catch (e) {
            console.error("Lỗi lsroi handleReply:", e);
        }
    }
};