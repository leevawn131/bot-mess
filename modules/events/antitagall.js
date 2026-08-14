const { isAntitagallEnabled } = require("../utils/antitagallSettings");
const { getThreadInfoCached } = require("../utils/threadInfo");
const { checkCooldown } = require("../utils/cooldown");

function suppressLeaveEvents(threadID, durationMs = 15000) {
    global.leaveEventSuppressByThread = global.leaveEventSuppressByThread || {};
    global.leaveEventSuppressByThread[String(threadID)] = Date.now() + durationMs;
}

function getSenderName(threadInfo, senderID) {
    const members = Array.isArray(threadInfo?.userInfo) ? threadInfo.userInfo : [];
    const found = members.find((user) => String(user?.id) === String(senderID));
    return String(found?.name || senderID || "Thành viên").trim();
}

function toAdminIdList(threadInfo) {
    const list = Array.isArray(threadInfo?.adminIDs) ? threadInfo.adminIDs : [];
    return list
        .map((item) => {
            if (!item) return "";
            if (typeof item === "object") {
                return String(item.id || item.userID || item.adminID || "").trim();
            }
            return String(item).trim();
        })
        .filter(Boolean);
}

function isTagAllMessage(event) {
    const body = String(event?.body || "").toLowerCase();

    // 1. Thẻ mặc định của Facebook
    if (body.includes("@everyone") || body.includes("@mọi người") || body.includes("@all")) {
        return true;
    }

    // 2. Thẻ nhiều người dùng (Mass mention >= 5 người một lúc)
    if (event.mentions && typeof event.mentions === "object") {
        const mentionCount = Object.keys(event.mentions).length;
        if (mentionCount >= 5) {
            return true;
        }
    }

    return false;
}

module.exports = {
    name: "antitagall",
    eventType: ["message", "message_reply"],

    run: async function(Obj) { return this.execute(Obj); },
    execute: async ({ api, event, config }) => {
        if (!event.threadID || !event.senderID || !event.body) return;

        const threadID = String(event.threadID);
        const senderID = String(event.senderID);
        const botID = String(api.getCurrentUserID());

        // 1. Bỏ qua nếu chính bot gửi tin nhắn
        if (senderID === botID) return;

        // 2. Bỏ qua nếu tính năng antitagall không được bật cho nhóm này
        if (!isAntitagallEnabled(threadID)) return;

        // 3. Kiểm tra xem tin nhắn có phải tag all / mass tag không
        if (!isTagAllMessage(event)) return;

        try {
            // Lấy thông tin nhóm
            const threadInfo = await getThreadInfoCached(api, threadID);
            if (!threadInfo || typeof threadInfo !== "object") return;

            const adminIDs = toAdminIdList(threadInfo);
            const adminBotUIDs = (config?.adminIDs || global.config?.adminIDs || []).map(String);

            // 4. Bỏ qua nếu người gửi là QTV nhóm hoặc Admin Bot
            if (adminIDs.includes(senderID) || adminBotUIDs.includes(senderID)) {
                return;
            }

            const senderName = getSenderName(threadInfo, senderID);
            const isBotAdmin = adminIDs.includes(botID);

            // 5. Nếu Bot KHÔNG PHẢI QTV nhóm -> Cảnh báo (có Cooldown 15s để tránh spam tin nhắn)
            if (!isBotAdmin) {
                const cooldown = checkCooldown({
                    command: "antitagall_warn",
                    key: threadID,
                    durationMs: 15000
                });
                if (cooldown.allowed) {
                    api.sendMessage(
                        `⚠️ Phát hiện ${senderName} tag @everyone/@mọi người!\n❌ Bot cần quyền Quản Trị Viên nhóm để tự động kick người vi phạm.`,
                        threadID,
                        event.messageID
                    ).catch(() => {});
                }
                return;
            }

            // 6. Bot CÓ QUYỀN QTV -> Thực hiện kick người vi phạm ngay lập tức không cảnh báo
            try {
                // Tắt tạm thời các sự kiện leave nếu có thể
                if (global.leaveEventSuppressByThread) {
                    global.leaveEventSuppressByThread[threadID] = Date.now() + 15000;
                }

                if (typeof api.removeUserFromGroup === "function") {
                    await api.removeUserFromGroup(senderID, threadID);
                } else if (typeof api.removeParticipant === "function") {
                    await api.removeParticipant(senderID, threadID);
                } else if (typeof api.gcmember === "function") {
                    await api.gcmember("remove", senderID, threadID);
                } else if (typeof api.removeUser === "function") {
                    await api.removeUser(senderID, threadID);
                } else {
                    throw new Error("Không tìm thấy hàm kick trong thư viện API");
                }

                api.sendMessage(
                    `🔨 [ANTITAGALL] Đã kick thành viên ${senderName} (${senderID}) ra khỏi nhóm vì tự ý tag all/mass mention.`,
                    threadID
                ).catch(() => {});
            } catch (kickErr) {
                console.error("❌ Lỗi kick thành viên vi phạm antitagall:", kickErr);
                api.sendMessage(
                    `⚠️ [ANTITAGALL] Phát hiện thành viên ${senderName} (${senderID}) tag all/mass mention nhưng bot không thể kick.`,
                    threadID
                ).catch(() => {});
            }

        } catch (error) {
            console.error("❌ Lỗi antitagall:", error);
        }
    }
};
