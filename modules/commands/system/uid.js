const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "uid",
    description: "Lấy ID người dùng",
    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "uid", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        let uid;
        // Nếu reply tin nhắn thì lấy UID người bị reply
        if (event.type === "message_reply") {
            uid = event.messageReply.senderID;
        } 
        // Nếu tag người khác
        else if (Object.keys(event.mentions).length > 0) {
            uid = Object.keys(event.mentions)[0];
        } 
        // Mặc định lấy UID bản thân
        else {
            uid = event.senderID;
        }
        api.sendMessage(`${uid}`, event.threadID, event.messageID);
    }
};