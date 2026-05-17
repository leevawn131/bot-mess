const { addLeaveHistoryEntry } = require("../utils/leaveHistory");
const { isAntioutEnabled } = require("../utils/antioutSettings");

async function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryReAddUser({ api, threadID, leftID, retries = 2 }) {
    let lastError = "";

    for (let i = 0; i < retries; i++) {
        try {
            if (typeof api.gcmember !== "function") {
                return { ok: false, error: "Thiếu hàm gcmember trong thư viện." };
            }

            const result = await api.gcmember("add", [String(leftID)], String(threadID));
            if (result && result.type === "error_gc") {
                lastError = String(result.error || "Không rõ lý do");
            }

            await wait(1200);
            const threadInfo = await api.getThreadInfo(threadID);
            const participantSet = new Set((threadInfo?.participantIDs || []).map(id => String(id)));
            if (participantSet.has(String(leftID))) {
                return { ok: true, error: "" };
            }

            if (!lastError) {
                lastError = "Đã gửi lệnh mời lại nhưng chưa thấy thành viên quay lại nhóm.";
            }
        } catch (e) {
            lastError = e?.message || "Không rõ lý do";
        }
    }

    return { ok: false, error: lastError || "Không rõ lý do" };
}

module.exports = {
    name: "leave",
    eventType: ["log:unsubscribe"],
    
    execute: async ({ api, event }) => {
        try {
            const { threadID, logMessageBody, logMessageData, author } = event;
            const leftID = logMessageData?.leftParticipantFbId;
            const botID = api.getCurrentUserID();
            const isKickByBody = Boolean(
                logMessageBody &&
                logMessageBody.includes("đã xóa") &&
                logMessageBody.includes("khỏi nhóm")
            );
            const isSelfByBody = Boolean(
                logMessageBody &&
                logMessageBody.includes("đã rời khỏi nhóm")
            );
            const isSelfLeave = String(author) === String(leftID) || (!isKickByBody && isSelfByBody);
            const now = Date.now();
            const antioutEnabled = isAntioutEnabled(threadID);

            if (!leftID || leftID == botID) return;

            const suppressMap = global.leaveEventSuppressByThread || {};
            const suppressUntil = Number(suppressMap[String(threadID)] || 0);
            const shouldSuppressMessage = suppressUntil && now < suppressUntil;
            if (suppressUntil && now >= suppressUntil) {
                delete suppressMap[String(threadID)];
            }

            // --- LOGIC TÁCH TÊN (DÙNG LAST INDEX OF) ---
            let name = "Thành viên";
            
            if (logMessageBody) {
                // TRƯỜNG HỢP 1: BỊ KICK ("...đã xóa [TÊN] khỏi nhóm")
                // Logic: Tìm chữ "đã xóa" CUỐI CÙNG trong câu
                if (logMessageBody.includes("đã xóa") && logMessageBody.includes("khỏi nhóm")) {
                    const actionPhrase = "đã xóa ";
                    const endPhrase = " khỏi nhóm";
                    
                    // Tìm vị trí của chữ "đã xóa" cuối cùng (Tránh tên Admin troll)
                    const lastActionIndex = logMessageBody.lastIndexOf(actionPhrase);
                    
                    if (lastActionIndex !== -1) {
                        // Cắt từ sau chữ "đã xóa" đến trước chữ "khỏi nhóm"
                        // logMessageBody.indexOf(endPhrase, lastActionIndex): Tìm chữ "khỏi nhóm" nằm SAU chữ "đã xóa" vừa tìm được
                        const startIndex = lastActionIndex + actionPhrase.length;
                        const endIndex = logMessageBody.indexOf(endPhrase, startIndex);
                        
                        if (endIndex !== -1) {
                            name = logMessageBody.substring(startIndex, endIndex).trim();
                        }
                    }
                }
                
                // TRƯỜNG HỢP 2: TỰ OUT ("[TÊN] đã rời nhóm")
                // Logic: Lấy toàn bộ phần trước chữ "đã rời nhóm" cuối cùng
                else if (logMessageBody.includes("đã rời khỏi nhóm.")) {
                    const endPhrase = " đã rời khỏi nhóm.";
                    const lastEndIndex = logMessageBody.lastIndexOf(endPhrase);
                    
                    if (lastEndIndex !== -1) {
                        name = logMessageBody.substring(0, lastEndIndex).trim();
                    }
                }
            }

            // Fallback: Nếu cắt chuỗi lỗi (do ngôn ngữ khác) thì mới gọi API
            if (name === "Thành viên" || name === "") {
                try {
                    const info = await api.getUserInfo(leftID);
                    if (info[leftID]?.name) name = info[leftID].name;
                } catch (e) {}
            }

            addLeaveHistoryEntry(threadID, {
                uid: leftID,
                name,
                leftAt: now,
                action: isSelfLeave ? "self" : "kick",
                actorID: author
            });

            if (antioutEnabled && isSelfLeave) {
                let addBackOk = false;
                let addBackError = "";

                try {
                    const threadInfo = await api.getThreadInfo(threadID);
                    const adminIDs = (threadInfo?.adminIDs || []).map((item) => String(item.id));
                    const isBotAdmin = adminIDs.includes(String(botID));

                    if (!isBotAdmin) {
                        addBackError = "Bot chưa có quyền QTV.";
                    } else {
                        const addResult = await tryReAddUser({ api, threadID, leftID, retries: 2 });
                        addBackOk = addResult.ok;
                        addBackError = addResult.error;
                    }
                } catch (e) {
                    addBackError = e?.message || "Không rõ lý do";
                }

                if (addBackOk) {
                    return api.sendMessage(`🛡️ Antiout: ${name} tự rời nhóm và đã được kéo lại.`, threadID);
                }

                if (!shouldSuppressMessage) {
                    return api.sendMessage(`⚠️ Antiout đang bật nhưng không kéo lại được ${name}.\nLý do: ${addBackError}`, threadID);
                }

                return;
            }

            if (shouldSuppressMessage) {
                return;
            }

            // --- VĂN MẪU BỰA (Như cũ) ---
            const kickMessages = [
                "🚑 {name} đã bị sút ra chuồng gà. Thượng lộ bình an!",
                "🌪️ Gió đưa cành trúc la đà, {name} đi bụi cả nhà đều vui.",
                "👋 {name} đã bị đá đít khỏi vũ trụ này. Không tiễn!",
                "🐧 {name} đã bay màu. Chúc bạn may mắn ở server khác!",
                "🚪 Cửa ở kia, {name} lượn đi cho nước nó trong!",
                "⚰️ R.I.P {name}. Thành kính phân ưu."
            ];

            const leaveMessages = [
                "🏃 {name} đã bỏ của chạy lấy người.",
                "🍃 Gió đã cuốn {name} đi xa...",
                "👋 {name} đã tự rời nhóm. Tạm biệt nhé!",
                "👻 {name} đã lẳng lặng rời đi như một bóng ma."
            ];

            let msg = "";
            if (!isSelfLeave) {
                const random = kickMessages[Math.floor(Math.random() * kickMessages.length)];
                msg = random.replace("{name}", name);
            } else {
                const random = leaveMessages[Math.floor(Math.random() * leaveMessages.length)];
                msg = random.replace("{name}", name);
            }

            return api.sendMessage(msg, threadID);

        } catch (e) {
            console.error("Lỗi event leave:", e);
        }
    }
};