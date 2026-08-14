const config = require("../../../config.json");
const prefix = process.env.BOT_PREFIX;

module.exports = {
    name: "gỡ",
    aliases: ["go", "xoa", "xóa", "delete", "remove", "like"],
    description: `Gỡ tin nhắn của bot (reply rồi gõ ${prefix}gỡ hoặc ${prefix}like)`,
    usage: `\n${prefix}gỡ / ${prefix}like (reply tin nhắn bot) → Gỡ tin nhắn của bot\n━━━━━━━━━━━━━\n📌 Reply vào tin nhắn của bot rồi gõ ${prefix}gỡ hoặc ${prefix}like\n⚠️ Chỉ gỡ được tin nhắn của bot`,

    execute: async ({ api, event }) => {
        const { threadID, messageID, messageReply, senderID } = event;

        // Kiểm tra có reply không
        if (!messageReply) {
            return api.sendMessage(`⚠️ Hãy reply vào tin nhắn của bot rồi gõ ${prefix}gỡ`, threadID, messageID);
        }

        // Kiểm tra tin nhắn reply là của bot không
        const botID = String(api.getCurrentUserID());
        const senderOfReply = String(messageReply.senderID);

        if (senderOfReply !== botID) {
            return api.sendMessage("❌ Chỉ có thể gỡ tin nhắn của bot thôi!", threadID, messageID);
        }

        // Kiểm tra xem tin nhắn có bị cấm gỡ (nounsend) hay không
        const { isNoUnsend } = require("../../utils/noUnsendStorage");
        if (isNoUnsend(messageReply.messageID)) {
            return api.sendMessage("Tuoiloz gỡ tin nhắn này 😏😏😏", threadID, messageID);
        }

        // Xóa tin nhắn
        try {
            await api.unsendMessage(messageReply.messageID);
            api.setMessageReaction("✅", messageID, () => { }, true);
        } catch (error) {
            console.error("Lỗi gỡ tin nhắn:", error);
            return api.sendMessage("❌ Không thể gỡ tin nhắn này!", threadID, messageID);
        }
    }
};
