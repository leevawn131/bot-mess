const fs = require("fs");
const { removeLeaveHistoryEntries } = require("../utils/leaveHistory");
const { getJoinGreeting } = require("../utils/joinGreetingSettings");
const { getNickname, hasInteraction } = require("../utils/nicknameStorage");

function buildMentionChunk(participants) {
    const rows = Array.isArray(participants) ? participants : [];
    if (rows.length === 0) {
        return { text: "", mentions: [] };
    }

    let cursor = 0;
    const parts = [];
    const mentions = [];

    rows.forEach((user, index) => {
        const userID = String(user?.userFbId || "").trim();
        const safeName = String(user?.fullName || "Thành viên mới").trim();
        const tagText = `@${safeName}`;

        if (index > 0) {
            parts.push(" ");
            cursor += 1;
        }

        parts.push(tagText);
        if (userID) {
            mentions.push({
                id: userID,
                tag: tagText,
                fromIndex: cursor,
            });
        }
        cursor += tagText.length;
    });

    return {
        text: parts.join(""),
        mentions,
    };
}

function formatGreeting(template, newParticipants) {
    const namesArray = newParticipants.map((user) => String(user?.fullName || "").trim()).filter(Boolean);
    const names = namesArray.join(", ");
    const firstName = namesArray[0] || names;
    const allTags = buildMentionChunk(newParticipants);
    const firstTag = buildMentionChunk(newParticipants.slice(0, 1));

    const source = String(template || "");
    const tokenRegex = /\{(@tags|@tag|names|name|count)\}/gi;

    let body = "";
    let lastIndex = 0;
    const mentions = [];
    let match;

    while ((match = tokenRegex.exec(source)) !== null) {
        body += source.slice(lastIndex, match.index);

        const tokenStart = body.length;
        const token = String(match[1] || "").toLowerCase();

        if (token === "@tags") {
            body += allTags.text;
            allTags.mentions.forEach((item) => {
                mentions.push({
                    ...item,
                    fromIndex: tokenStart + item.fromIndex,
                });
            });
        } else if (token === "@tag") {
            body += firstTag.text;
            firstTag.mentions.forEach((item) => {
                mentions.push({
                    ...item,
                    fromIndex: tokenStart + item.fromIndex,
                });
            });
        } else if (token === "names") {
            body += names;
        } else if (token === "name") {
            body += firstName;
        } else if (token === "count") {
            body += String(namesArray.length);
        }

        lastIndex = match.index + match[0].length;
    }

    body += source.slice(lastIndex);
    return { body, mentions };
}

module.exports = {
    name: "welcome",
    eventType: ["log:subscribe"], // Sự kiện thêm người vào nhóm

    run: async function(Obj) { return this.execute(Obj); },
    execute: async ({ api, event }) => {
        const { threadID } = event;

        // 1. Nếu người được thêm là chính con BOT
        if (event.logMessageData.addedParticipants.some(i => i.userFbId == api.getCurrentUserID())) {
            let prefix = "!";
            try {
                const config = require("../../config.json");
                if (config && config.prefix) prefix = config.prefix;
            } catch (e) { }

            api.changeNickname(`『 ${prefix} 』• Bot láo loz`, threadID, api.getCurrentUserID(), (err) => {
                if (err) console.error("Lỗi tự động đặt biệt danh bot:", err);
            });

            return api.sendMessage(`Kết nối thành công! Chào cả nhà nhé 🤖\nDùng ${prefix}help để biết danh sách lệnh`, threadID);
        }

        try {
            // 2. Lấy danh sách toàn bộ người mới và lọc những ai bị cấm vĩnh viễn (cutvv)
            const rawParticipants = event.logMessageData.addedParticipants || [];
            const newParticipants = [];
            const botID = String(api.getCurrentUserID());

            const { isBlocked } = require("../utils/cutvvStorage");
            const { getThreadInfoCached } = require("../utils/threadInfo");
            const { toAdminIdList } = require("../utils/checkPermission");

            // Kiểm tra xem bot có phải QTV không
            let isBotAdmin = false;
            try {
                const threadInfo = await getThreadInfoCached(api, threadID);
                const adminIDs = toAdminIdList(threadInfo);
                isBotAdmin = adminIDs.includes(botID);
            } catch (err) {
                console.error("Lỗi lấy thông tin admin khi join:", err);
            }

            const kickUser = async (uid, tid) => {
                if (api.removeUserFromGroup) return api.removeUserFromGroup(uid, tid);
                if (api.removeParticipant) return api.removeParticipant(uid, tid);
                if (api.gcmember) return api.gcmember("remove", uid, tid);
                if (api.removeUser) return api.removeUser(uid, tid);
                if (api.removeUserFromThread) return api.removeUserFromThread(uid, tid);
                if (api.removeParticipantFromThread)
                    return api.removeParticipantFromThread(uid, tid);
                throw new Error("Library missing remove function");
            };

            for (const user of rawParticipants) {
                const userID = String(user.userFbId || "").trim();
                if (!userID) continue;

                const blocked = await isBlocked(threadID, userID);
                if (blocked) {
                    if (isBotAdmin) {
                        try {
                            await kickUser(userID, threadID);
                            api.sendMessage(
                                `⚠️ Phát hiện thành viên ${user.fullName || userID} nằm trong danh sách cấm vĩnh viễn (cutvv) của nhóm. Bot đã tự động kick!`,
                                threadID
                            );
                        } catch (e) {
                            console.error(`Lỗi tự động kick thành viên bị chặn ${userID}:`, e);
                        }
                    } else {
                        api.sendMessage(
                            `⚠️ Phát hiện thành viên ${user.fullName || userID} nằm trong danh sách cấm vĩnh viễn (cutvv) của nhóm nhưng Bot hiện không có quyền Quản trị viên để kick!`,
                            threadID
                        );
                    }
                } else {
                    newParticipants.push(user);
                }
            }

            if (newParticipants.length === 0) return;

            const joinedUIDs = newParticipants.map(user => String(user.userFbId || "").trim()).filter(Boolean);
            if (joinedUIDs.length > 0) removeLeaveHistoryEntries(threadID, joinedUIDs);

            if (newParticipants.length > 0) {
                const customGreeting = getJoinGreeting(threadID);

                if (!customGreeting || customGreeting.text !== "off") {
                    const namesArray = newParticipants.map((user) => String(user?.fullName || "").trim()).filter(Boolean);
                    const listNames = namesArray.join(", ");

                    if (customGreeting && (customGreeting.text || customGreeting.media)) {
                        let body = "";
                        let mentions = [];

                        if (customGreeting.text) {
                            const formatted = formatGreeting(customGreeting.text, newParticipants);
                            body = formatted.body;
                            mentions = formatted.mentions;
                        }

                        let msgPayload = null;
                        if (customGreeting.media && customGreeting.media.path && fs.existsSync(customGreeting.media.path)) {
                            const attachmentStream = fs.createReadStream(customGreeting.media.path);
                            if (body) {
                                msgPayload = {
                                    body: body,
                                    attachment: attachmentStream,
                                };
                                if (mentions.length > 0) msgPayload.mentions = mentions;
                            } else {
                                msgPayload = {
                                    attachment: attachmentStream,
                                };
                            }
                        } else if (body) {
                            msgPayload = mentions.length > 0 ? { body, mentions } : body;
                        }

                        if (msgPayload) {
                            api.sendMessage(msgPayload, threadID);
                        }
                    } else {
                        api.sendMessage(`Chào mừng ${listNames} đã tham gia nhóm! 🥳`, threadID);
                    }
                }
            }

            for (const user of oldParticipants) {
                const userID = String(user.userFbId || "").trim();
                const userName = user.fullName || "Thành viên cũ";
                try {
                    const savedNickname = await getNickname(threadID, userID);
                    if (savedNickname && savedNickname.trim() !== "") {
                        setTimeout(() => {
                            checkAndRestoreOldMemberNickname(api, threadID, userID, userName);
                        }, 5000);
                    }
                } catch (err) {
                    console.error("Lỗi khi đăng ký khôi phục biệt danh cho thành viên cũ:", err);
                }
            }

        } catch (e) {
            console.log("Lỗi tại event welcome: ", e);
        }
    }
};