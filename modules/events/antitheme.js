const { getAntithemeSetting } = require("../utils/antithemeSettings");
const { getThreadInfoCached } = require("../utils/threadInfo");

function toAdminIdList(threadInfo) {
    const list = Array.isArray(threadInfo?.adminIDs) ? threadInfo.adminIDs : [];
    return list
        .map((item) => {
            if (!item || typeof item !== "object") return String(item || "").trim();
            return String(item.id || item.userID || item.adminID || "").trim();
        })
        .filter(Boolean);
}

function getActorName(threadInfo, uid) {
    const members = Array.isArray(threadInfo?.userInfo) ? threadInfo.userInfo : [];
    const found = members.find((user) => String(user?.id) === String(uid));
    return String(found?.name || uid || "Thành viên").trim();
}

module.exports = {
    name: "antitheme",
    eventType: ["log:thread-color", "log:thread-icon"],

    execute: async ({ api, event }) => {
        const threadID = String(event?.threadID || "");
        if (!threadID) return;

        let prefix = "!";
        try {
            const config = require("../../config.json");
            if (config && config.prefix) prefix = config.prefix;
        } catch (e) {}

        const setting = getAntithemeSetting(threadID);
        if (!setting.enabled) return;

        try {
            const threadInfo = await getThreadInfoCached(api, threadID);
            const botID = String(api.getCurrentUserID());
            const actorID = String(event?.author || "");
            const adminIDs = toAdminIdList(threadInfo);
            const isBotAdmin = adminIDs.includes(botID);

            if (!isBotAdmin) {
                return api.sendMessage(
                    "⚠️ Antitheme đang bật nhưng bot chưa có quyền QTV để hoàn tác đổi nền/icon.",
                    threadID,
                );
            }

            if (actorID && actorID === botID) {
                return;
            }

            const eventType = String(event?.logMessageType || "");
            let reverted = false;

            if (eventType === "log:thread-color") {
                if (typeof api.theme !== "function") {
                    return api.sendMessage(
                        "⚠️ Thư viện hiện tại chưa hỗ trợ API theme để hoàn tác đổi nền nhóm.",
                        threadID,
                    );
                }

                const themeRef = String(setting.lockedThemeID || setting.lockedThemeName || "").trim();
                if (!themeRef) {
                    return api.sendMessage(
                        `⚠️ Antitheme chưa có mốc theme để hoàn tác. Hãy chạy ${prefix}anti antitheme off rồi ${prefix}anti antitheme on để lưu lại theme hiện tại.`,
                        threadID,
                    );
                }

                await api.theme(themeRef, threadID, null, botID);
                reverted = true;
            }

            if (eventType === "log:thread-icon") {
                if (typeof api.emoji !== "function") {
                    return api.sendMessage(
                        "⚠️ Thư viện hiện tại chưa hỗ trợ API emoji để hoàn tác đổi icon nhóm.",
                        threadID,
                    );
                }

                const emojiRef = String(setting.lockedEmoji || "").trim();
                if (!emojiRef) {
                    return api.sendMessage(
                        `⚠️ Antitheme chưa có mốc icon để hoàn tác. Hãy chạy ${prefix}anti antitheme off rồi ${prefix}anti antitheme on để lưu lại icon hiện tại.`,
                        threadID,
                    );
                }

                await api.emoji(emojiRef, threadID, null, botID);
                reverted = true;
            }

            if (reverted) {
                const actorName = getActorName(threadInfo, actorID);
                return api.sendMessage(
                    `🛡️ Antitheme: Đã hoàn tác thay đổi nền/icon của ${actorName}.`,
                    threadID,
                );
            }
        } catch (error) {
            console.error("❌ Lỗi antitheme:", error);
        }
    }
};
