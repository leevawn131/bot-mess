const { getAdminBotUIDs } = require("../../utils/checkPermission");

module.exports = {
    name: "setavt",
    description: "Đổi ảnh đại diện (avatar) cho bot",
    usage: "\n!setavt [caption] (reply một ảnh) → Đổi ảnh đại diện cho bot\n━━━━━━━━━━━━━\n🔒 Chỉ Admin Bot mới được sử dụng",

    execute: async ({ api, event, args, config }) => {
        const { threadID, senderID, messageID, messageReply, mentions } = event;

        // 1. Kiểm tra quyền Admin Bot
        const adminBotUIDs = getAdminBotUIDs();
        if (!adminBotUIDs.includes(String(senderID))) {
            return; // Bỏ qua im lặng để tránh nhiều bot cùng spam
        }

        const botID = api.getCurrentUserID();
        let targetBots = [];

        // Kiểm tra mục tiêu: Tag, UID, hoặc "all"
        if (Object.keys(mentions || {}).length > 0) {
            targetBots = Object.keys(mentions);
        } else if (args[0] === "all") {
            targetBots = ["all"];
        } else if (args[0] && !isNaN(args[0])) {
            targetBots = [String(args[0])];
        }

        if (targetBots.length === 0) {
            return api.sendMessage(`⚠️ Cú pháp: !setavt [uid | @tag | all] [caption]\nVD: !setavt ${botID}\n- Nhớ reply một bức ảnh để đổi!`, threadID, messageID);
        }

        // Nếu lệnh không nhắm tới bot này thì bỏ qua
        if (!targetBots.includes("all") && !targetBots.includes(String(botID))) {
            return;
        }

        // 2. Kiểm tra xem có reply một ảnh không
        if (!messageReply || !messageReply.attachments || messageReply.attachments.length === 0 || messageReply.attachments[0].type !== "photo") {
            return api.sendMessage(`⚠️ [${botID}] Bạn cần reply một bức ảnh để đặt làm avatar!`, threadID, messageID);
        }

        const imageUrl = messageReply.attachments[0].url;
        
        // Lọc caption (bỏ uid hoặc chữ "all" ở đầu, bỏ các chữ có chứa @tag)
        let captionArgs = args;
        if (targetBots.includes("all") || (!isNaN(args[0]) && String(args[0]) === String(botID))) {
            captionArgs = args.slice(1);
        } else if (Object.keys(mentions || {}).length > 0) {
            captionArgs = args.filter(word => !word.includes('@'));
        }
        
        const caption = captionArgs.join(" ") || "";

        api.sendMessage(`🔄 [${botID}] Đang xử lý đổi ảnh đại diện...`, threadID, messageID);

        try {
            await api.changeAvt(imageUrl, caption);
            return api.sendMessage(`✅ [${botID}] Đã đổi ảnh đại diện thành công!`, threadID, messageID);
        } catch (error) {
            console.error(`Lỗi khi đổi avatar cho ${botID}:`, error);
            return api.sendMessage(`❌ [${botID}] Có lỗi xảy ra: ` + (error.message || error), threadID, messageID);
        }
    }
};
