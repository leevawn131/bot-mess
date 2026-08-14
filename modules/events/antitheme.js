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

    run: async function(Obj) { return this.execute(Obj); },
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

            const { getAdminBotUIDs } = require("../utils/checkPermission");
            const adminBots = getAdminBotUIDs();
            const isAllowed = adminBots.includes(actorID) || adminIDs.includes(actorID);
            if (isAllowed) {
                return;
            }

            const eventType = String(event?.logMessageType || "");
            let reverted = false;

            if (eventType === "log:thread-color") {
                if (typeof api.changeThreadColor !== "function") {
                    return api.sendMessage(
                        "⚠️ Thư viện hiện tại chưa hỗ trợ API theme để hoàn tác đổi nền nhóm.",
                        threadID,
                    );
                }

                let themeRef = String(setting.lockedThemeID || setting.lockedThemeName || "").trim();
                if (!themeRef) {
                    return api.sendMessage(
                        `⚠️ Antitheme chưa có mốc theme để hoàn tác. Hãy chạy ${prefix}anti antitheme off rồi ${prefix}anti antitheme on để lưu lại theme hiện tại.`,
                        threadID,
                    );
                }

                if (api.threadColors) {
                    const keys = Object.keys(api.threadColors);
                    const foundKey = keys.find(k => k.toLowerCase() === themeRef.toLowerCase());
                    if (foundKey) {
                        themeRef = api.threadColors[foundKey];
                    }
                    if (!Object.values(api.threadColors).includes(themeRef)) {
                        api.threadColors[themeRef] = themeRef;
                    }
                }

                await api.changeThreadColor(themeRef, threadID);
                reverted = true;
            }

            if (eventType === "log:thread-icon") {
                if (typeof api.changeThreadEmoji !== "function") {
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

                await api.changeThreadEmoji(emojiRef, threadID);
                reverted = true;
            }

            if (reverted) {
                const fs = require("fs");
                const path = require("path");
                let DataAnti = {};
                try {
                    const fileAnti = path.join('./modules/data/anti', 'antiFile.json');
                    if (fs.existsSync(fileAnti)) DataAnti = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}');
                } catch (e) {}

                const warnings = DataAnti[threadID]?.warn;
                // Prefer the current `theme` key. `antitheme` is only a fallback
                // for data saved by older versions of the command.
                const isWarnOn = !warnings || (Object.prototype.hasOwnProperty.call(warnings, 'theme')
                    ? warnings.theme !== false
                    : warnings.antitheme !== false);
                if (isWarnOn) {
                    const { addWarning } = require("../utils/warningStorage");
                    await addWarning(api, threadID, actorID, "Tự ý thay đổi giao diện/emoji nhóm");
                }
            }
        } catch (error) {
            console.error("❌ Lỗi antitheme:", error);
        }
    }
};
