const fs = require("fs");
const { removeLeaveHistoryEntries } = require("../utils/leaveHistory");
const { getJoinGreeting } = require("../utils/joinGreetingSettings");
const { getNickname, hasInteraction } = require("../utils/nicknameStorage");
const { checkAndRestoreOldMemberNickname } = require("../utils/restoreNickname");
const { getThreadPrefix } = require("../utils/threadPrefixStorage");
const { isAutoBdEnabled } = require("../utils/autobdStorage");

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
    eventType: ["log:subscribe"],
    run: async function(Obj) { return this.execute(Obj); },
    execute: async ({ api, event }) => {
        const { threadID } = event;

        // 1. Nếu người được thêm là chính con BOT
        if (event.logMessageData?.addedParticipants?.some(i => i.userFbId == api.getCurrentUserID())) {
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
            const rawParticipants = event.logMessageData?.addedParticipants || [];
            const allowedParticipants = [];
            const botID = String(api.getCurrentUserID());

            const { isBlocked } = require("../utils/cutvvStorage");
            const { getThreadInfoCached } = require("../utils/threadInfo");
            const { toAdminIdList } = require("../utils/checkPermission");
            const { ensureUserAccount } = require("../utils/database");

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
                    allowedParticipants.push(user);
                }
            }

            if (allowedParticipants.length === 0) return;

            // Xóa lịch sử rời nhóm
            const joinedUIDs = allowedParticipants.map(user => String(user.userFbId || "").trim()).filter(Boolean);
            if (joinedUIDs.length > 0) removeLeaveHistoryEntries(threadID, joinedUIDs);

            // 3. Đồng bộ tên thành viên vào RAM & SQLite Database
            for (const user of allowedParticipants) {
                const userID = String(user.userFbId || "").trim();
                const fullName = String(user.fullName || "").trim();
                if (userID && fullName) {
                    if (global.data?.userName) global.data.userName.set(userID, fullName);
                    ensureUserAccount(threadID, userID, fullName).catch(() => {});
                }
            }

            // 4. Gửi Lời Chào Mừng (Chào mặc định hoặc Lời chào Custom)
            const customGreeting = getJoinGreeting(threadID);
            if (!customGreeting || customGreeting.text !== "off") {
                const namesArray = allowedParticipants.map((user) => String(user?.fullName || "").trim()).filter(Boolean);
                const listNames = namesArray.join(", ");

                if (customGreeting && (customGreeting.text || customGreeting.media)) {
                    let body = "";
                    let mentions = [];

                    if (customGreeting.text) {
                        const formatted = formatGreeting(customGreeting.text, allowedParticipants);
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

            // 5. Khôi phục biệt danh cũ hoặc Tự động đổi biệt danh (AutoBD) cho thành viên mới
            const autoBdActive = await isAutoBdEnabled(threadID);
            const groupPrefix = autoBdActive ? await getThreadPrefix(threadID) : null;

            let staggerDelayIndex = 0;
            for (const user of allowedParticipants) {
                const userID = String(user.userFbId || "").trim();
                const userName = user.fullName || "Thành viên mới";
                if (!userID || userID === botID) continue;

                try {
                    const savedNickname = await getNickname(threadID, userID);
                    // Nếu là thành viên cũ và có biệt danh đã lưu
                    if (savedNickname && savedNickname.trim() !== "") {
                        // Nếu không bật AutoBD, hoặc chưa setkitu, hoặc biệt danh cũ đã chứa groupPrefix: ưu tiên khôi phục biệt danh cũ
                        if (!autoBdActive || !groupPrefix || savedNickname.startsWith(groupPrefix)) {
                            checkAndRestoreOldMemberNickname(api, threadID, userID, userName);
                            continue;
                        }
                    }

                    // Nếu AutoBD đang bật và nhóm đã có ký tự box (setkitu)
                    if (autoBdActive && groupPrefix && typeof api.changeNickname === "function") {
                        let userFullName = String(user.fullName || "").trim();
                        if (!userFullName) {
                            try {
                                const userInfo = await api.getUserInfo(userID);
                                if (userInfo && userInfo[userID]?.name) {
                                    userFullName = userInfo[userID].name.trim();
                                }
                            } catch (e) {}
                        }
                        if (!userFullName) userFullName = "Thành viên";

                        const targetNickname = (userFullName.startsWith(groupPrefix) ? userFullName : `${groupPrefix}${userFullName}`).slice(0, 64);
                        const delayMs = 2000 + staggerDelayIndex * 1000;
                        staggerDelayIndex++;

                        setTimeout(() => {
                            api.changeNickname(targetNickname, threadID, userID, (err) => {
                                if (err) {
                                    console.error(`[AUTOBD] Không thể đặt biệt danh cho ${userID} tại nhóm ${threadID}:`, err?.message || err);
                                } else {
                                    console.log(`[AUTOBD] Đã đặt biệt danh cho ${userID} (${userFullName}) tại nhóm ${threadID}: ${targetNickname}`);
                                }
                            });
                        }, delayMs);
                    }
                } catch (err) {
                    console.error("Lỗi khi xử lý biệt danh thành viên mới:", err);
                }
            }

        } catch (e) {
            console.error("Lỗi tại event welcome: ", e);
        }
    }
};