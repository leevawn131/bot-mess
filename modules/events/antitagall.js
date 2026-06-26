const { isAntitagallEnabled } = require("../utils/antitagallSettings");
const { getThreadInfoCached } = require("../utils/threadInfo");

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
            if (!item || typeof item !== "object") return String(item || "").trim();
            return String(item.id || item.userID || item.adminID || "").trim();
        })
        .filter(Boolean);
}

function hasTagAllMessage(event) {
    const body = String(event?.body || "").toLowerCase();
    return body.includes("@everyone") || body.includes("@mọi người");
}

module.exports = {
    name: "antitagall",
    eventType: ["message", "message_reply"],

    execute: async ({ api, event }) => {
        if (!event.threadID || !event.senderID || !event.body) return;

        if (!isAntitagallEnabled(event.threadID)) {
            return;
        }

        try {
            // Kiểm tra xem tin nhắn có chứa @everyone hoặc @mọi người không
            const hasTagAll = hasTagAllMessage(event);

            if (!hasTagAll) return;

            const threadInfo = await getThreadInfoCached(api, event.threadID);
            if (!threadInfo || typeof threadInfo !== "object") {
                return api.sendMessage(
                    "⚠️ Phát hiện tag @everyone/@mọi người nhưng không lấy được thông tin nhóm để xử lý kick.",
                    event.threadID,
                    event.messageID,
                );
            }

            const senderName = getSenderName(threadInfo, event.senderID);

            // Kiểm tra quyền của bot
            const adminIDs = toAdminIdList(threadInfo);
            const botID = String(api.getCurrentUserID());
            const isBotAdmin = adminIDs.includes(botID);

            if (!isBotAdmin) {
                // Nếu bot không có quyền admin, chỉ gửi cảnh báo
                return api.sendMessage(
                    `⚠️ Phát hiện spam tag @everyone/@mọi người từ ${senderName}\n❌ Bot cần quyền Quản Trị Viên để tự động kick.`,
                    event.threadID,
                    event.messageID,
                );
            }

            // Kiểm tra xem sender có phải admin không (bỏ qua nếu là admin)
            const senderIsAdmin = adminIDs.includes(String(event.senderID));
            if (senderIsAdmin) {
                return; // Bỏ qua nếu sender là QTV
            }

            // Kiểm tra xem sender có phải bot không
            if (String(event.senderID) === botID) {
                return; // Bỏ qua chính bot
            }

            // Chặn leave event gửi thêm dòng thông báo bên dưới sau khi kick
            suppressLeaveEvents(event.threadID, 15000);

            // Thực hiện kick
            const kickUser = async (uid, tid) => {
                if (api.removeUserFromGroup) {
                    return await api.removeUserFromGroup(uid, tid);
                } else if (api.removeParticipant) {
                    return await api.removeParticipant(uid, tid);
                } else if (api.gcmember) {
                    return await api.gcmember("remove", uid, tid);
                } else if (api.removeUser) {
                    return await api.removeUser(uid, tid);
                } else if (api.removeUserFromThread) {
                    return await api.removeUserFromThread(uid, tid);
                } else if (api.removeParticipantFromThread) {
                    return await api.removeParticipantFromThread(uid, tid);
                } else {
                    throw new Error("Không hỗ trợ hàm kick");
                }
            };

            const kickResult = await kickUser(event.senderID, event.threadID);
            if (kickResult && kickResult.type === "error_gc") {
                throw new Error(kickResult.error || "gcmember remove failed");
            }

            // Gửi thông báo
            api.sendMessage(
                `🔨 Tự động kick ${senderName} do tag @everyone/@mọi người.\n🛡️ Antitagall bảo vệ nhóm.`,
                event.threadID
            ).catch(() => {});

        } catch (error) {
            console.error("❌ Lỗi antitagall:", error);
        }
    }
};
