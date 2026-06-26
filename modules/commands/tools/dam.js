const fs = require('fs');
const path = require('path');
const { execute, getConnection } = require("../../utils/database");
const { checkCooldown } = require('../../utils/cooldown');
const { consumeEnergy, getDBConfigFromRuntime } = require('../../utils/energySystem');
const { ensureMentionsFromHistory } = require('../../utils/mentionResolver');
const { getThreadInfoCached } = require('../../utils/threadInfo');

const PUNCH_GIF_DIR = path.resolve(__dirname, '../cache/punch');
const PUNCH_MESSAGES = [
    '{actor} đấm {target} bay màu 💥',
    '{actor} tung combo vào {target} gục tại chỗ 👊',
    '{actor} vả một phát làm {target} quay như chong chóng 🌪️',
    '{actor} đấm {target} cái bụp, trời đất tối sầm ⚡',
    '{actor} lao tới đấm {target} không trượt phát nào 🥊',
    '{actor} cho {target} ăn cú đấm chí mạng ☠️',
    '{actor} xin phép đấm {target} vì quá xàm loz'
];

function pickRandomGif() {
    if (!fs.existsSync(PUNCH_GIF_DIR)) return null;

    const files = fs.readdirSync(PUNCH_GIF_DIR).filter((file) => /\.gif$/i.test(file));
    if (files.length === 0) return null;

    const randomFile = files[Math.floor(Math.random() * files.length)];
    return path.join(PUNCH_GIF_DIR, randomFile);
}

function buildRandomPunchMessage(actorName, targetTag) {
    const template = PUNCH_MESSAGES[Math.floor(Math.random() * PUNCH_MESSAGES.length)];
    return template
        .replace('{actor}', actorName)
        .replace('{target}', targetTag);
}

async function getUserName(api, userID, fallback = 'Người dùng') {
    try {
        const info = await api.getUserInfo(userID);
        const user = info?.[userID];
        return user?.name || fallback;
    } catch {
        return fallback;
    }
}

async function getUserNameFromThread(api, threadID, userID) {
    try {
        const threadInfo = await getThreadInfoCached(api, threadID);
        const members = Array.isArray(threadInfo?.userInfo) ? threadInfo.userInfo : [];
        const found = members.find((user) => String(user.id) === String(userID));
        return found?.name || null;
    } catch {
        return null;
    }
}

module.exports = {
    name: 'đấm',
    description: 'Đấm người được reply hoặc tag và gửi GIF',
    usage: "\n!đấm @tag → Đấm người được tag\n!đấm (reply) → Đấm người được reply\n━━━━━━━━━━━━━━━━━━\n🥊 Gửi kèm GIF đấm và tin nhắn vui\n⚡ Tốn năng lượng mỗi lần dùng",
    execute: async ({ api, event, config }) => {
        await ensureMentionsFromHistory(api, event);
        const { threadID, messageID, senderID, mentions, messageReply } = event;
        const prefix = config?.prefix || "!";

        const cooldown = checkCooldown({ command: 'đấm', key: senderID, durationMs: 20000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        let targetID = null;
        let targetName = 'Người ấy';

        const mentionIDs = Object.keys(mentions || {});
        if (mentionIDs.length > 0) {
            targetID = mentionIDs[0];
            targetName = (mentions[targetID] || '').replace('@', '').trim() || 'Người ấy';
        } else if (messageReply?.senderID) {
            targetID = messageReply.senderID;

            const replyNameRaw = messageReply?.senderName || messageReply?.name;
            const replyName = typeof replyNameRaw === 'string' ? replyNameRaw.trim() : '';

            if (replyName) {
                targetName = replyName;
            } else {
                const threadName = await getUserNameFromThread(api, threadID, targetID);
                targetName = threadName || await getUserName(api, targetID, 'Người ấy');
            }
        }

        if (!targetID) {
            return api.sendMessage('⚠️ Hãy reply hoặc tag người bạn muốn đấm.', threadID, messageID);
        }

        if (String(targetID) === String(senderID)) {
            return api.sendMessage('😳 Đấm bản thân hả? Tag người khác đi nè.', threadID, messageID);
        }

        const dbConfig = getDBConfigFromRuntime(config);
        if (!dbConfig) {
            return api.sendMessage('❌ Lỗi cấu hình Database.', threadID, messageID);
        }

        let energyUse;
        let connection;
        try {
            connection = await getConnection();
            energyUse = await consumeEnergy(connection, senderID, 20);
            if (!energyUse.ok) {
                if (energyUse.reason === 'not_enough') {
                    return api.sendMessage(energyUse.message, threadID, messageID);
                }
                return api.sendMessage(`❌ Không thể kiểm tra thể lực lúc này.\nGõ ${prefix}tien để có thể lực.`, threadID, messageID);
            }
        } catch (error) {
            console.error('Energy check error (dam):', error);
            return api.sendMessage(`❌ Lỗi hệ thống thể lực.\nGõ ${prefix}tien để có thể lực.`, threadID, messageID);
        } finally {
            if (connection) connection.release();
        }

        const actorName = await getUserName(api, senderID, 'Bạn');
        const targetTag = `@${targetName}`;
        const gifPath = pickRandomGif();

        if (!gifPath) {
            return api.sendMessage('❌ Không tìm thấy GIF đấm trong kho.', threadID, messageID);
        }

        const randomBody = `${buildRandomPunchMessage(actorName, targetTag)}\n⚡ Thể lực: -20 (${energyUse.energy}/${energyUse.maxEnergy})`;

        return api.sendMessage(
            {
                body: randomBody,
                mentions: [{ tag: targetTag, id: targetID }],
                attachment: fs.createReadStream(gifPath)
            },
            threadID,
            messageID
        );
    }
};
