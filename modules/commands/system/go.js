module.exports = {
    name: "gỡ",
    aliases: ["go", "xoa", "xóa", "delete", "remove", "like"],
    description: "Gỡ tin nhắn của bot (reply rồi gõ !gỡ hoặc !like)",
    usage: "\n!gỡ / !like (reply tin nhắn bot) → Gỡ tin nhắn của bot\n━{13}\n📌 Reply vào tin nhắn của bot rồi gõ !gỡ hoặc !like\n⚠️ Chỉ gỡ được tin nhắn của bot",

    execute: async ({ api, event }) => {
        const { threadID, messageID, messageReply, senderID } = event;

        // Kiểm tra có reply không
        if (!messageReply) {
            return api.sendMessage("⚠️ Hãy reply vào tin nhắn của bot rồi gõ !gỡ", threadID, messageID);
        }

        // Kiểm tra tin nhắn reply là của bot không
        const botID = String(api.getCurrentUserID());
        const senderOfReply = String(messageReply.senderID);

        if (senderOfReply !== botID) {
            return api.sendMessage("❌ Chỉ có thể gỡ tin nhắn của bot thôi!", threadID, messageID);
        }

        // Xóa tin nhắn
        try {
            await api.unsendMessage(messageReply.messageID);
            api.setMessageReaction("✅", messageID, () => {}, true);
        } catch (error) {
            console.error("Lỗi gỡ tin nhắn:", error);
            return api.sendMessage("❌ Không thể gỡ tin nhắn này!", threadID, messageID);
        }
    }
};
