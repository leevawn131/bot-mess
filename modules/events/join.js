const { removeLeaveHistoryEntries } = require("../utils/leaveHistory");
const { getJoinGreeting } = require("../utils/joinGreetingSettings");

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
    
    execute: async ({ api, event }) => {
        const { threadID } = event;
        
        // 1. Nếu người được thêm là chính con BOT
        if (event.logMessageData.addedParticipants.some(i => i.userFbId == api.getCurrentUserID())) {
            return api.sendMessage("Kết nối thành công! Chào cả nhà nhé 🤖\nDùng !help để biết danh sách lệnh", threadID);
        }

        try {
            // 2. Lấy danh sách toàn bộ người mới
            const newParticipants = event.logMessageData.addedParticipants;
            const joinedUIDs = newParticipants
                .map(user => String(user.userFbId || "").trim())
                .filter(Boolean);

            if (joinedUIDs.length > 0) {
                removeLeaveHistoryEntries(threadID, joinedUIDs);
            }
            
            // Lấy ra mảng tên: ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C", ...]
            const namesArray = newParticipants.map(user => user.fullName);

            const customGreeting = getJoinGreeting(threadID);
            const listNames = namesArray.join(", ");

            // 3. Gửi tin nhắn
            if (customGreeting) {
                const formatted = formatGreeting(customGreeting, newParticipants);
                if (formatted.mentions.length > 0) {
                    return api.sendMessage({
                        body: formatted.body,
                        mentions: formatted.mentions,
                    }, threadID);
                }

                return api.sendMessage(formatted.body, threadID);
            }

            api.sendMessage(`Chào mừng ${listNames} đã tham gia nhóm! 🥳`, threadID);

        } catch (e) {
            console.log("Lỗi tại event welcome: ", e);
        }
    }
};