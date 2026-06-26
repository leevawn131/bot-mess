module.exports = {
    name: "setnamebot",
    description: "Đổi biệt danh của bot trong nhóm chat",
    usage: "\n!setnamebot [tên mới] → Thay đổi biệt danh của bot\n━━━━━━━━━━━━━━━━━━\n🔒 Chỉ QTV nhóm hoặc Admin Bot mới được sử dụng",

    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        const botID = api.getCurrentUserID();

        // 1. Kiểm tra nội dung tên mới
        const prefix = config?.prefix || "!";
        const nameInput = args.join(" ").trim();
        if (!nameInput) {
            return api.sendMessage("⚠️ Vui lòng nhập biệt danh mới cho bot.", threadID, messageID);
        }

        const newNickname = `『 ${prefix} 』• ${nameInput}`;
        if (newNickname.length > 32) {
            return api.sendMessage("⚠️ Biệt danh quá dài (tối đa 32 ký tự bao gồm cả kí tự đầu).", threadID, messageID);
        }

        // 2. Kiểm tra quyền hạn của người dùng (QTV hoặc Admin Bot)
        const { getAdminBotUIDs, toAdminIdList } = require('../../utils/checkPermission');
        const { getThreadInfoCached } = require('../../utils/threadInfo');
        
        let threadInfo;
        try {
            threadInfo = await getThreadInfoCached(api, threadID);
        } catch (e) {
            return api.sendMessage("❌ Không thể kiểm tra quyền hạn của bạn.", threadID, messageID);
        }

        const adminIDs = toAdminIdList(threadInfo);
        const isSenderAdmin = adminIDs.includes(String(senderID));
        const adminBotUIDs = getAdminBotUIDs();
        const isSenderBotAdmin = adminBotUIDs.includes(String(senderID));

        if (!isSenderAdmin && !isSenderBotAdmin) {
            return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc Admin Bot mới có quyền đổi tên Bot!", threadID, messageID);
        }

        // 3. Đánh dấu cho phép đổi tên bot trong thread này
        global.allowBotNicknameChange = global.allowBotNicknameChange || {};
        global.allowBotNicknameChange[threadID] = Date.now();

        // 4. Thực thi đổi biệt danh
        api.changeNickname(newNickname, threadID, botID, (err) => {
            if (err) {
                global.allowBotNicknameChange[threadID] = 0; // reset
                console.error("Lỗi setnamebot:", err);
                return api.sendMessage("❌ Lỗi: Không thể đổi biệt danh cho bot (Có thể do lỗi kết nối hoặc Facebook chặn).", threadID, messageID);
            }
            return api.sendMessage(`✅ Đã đổi biệt danh của Bot thành: ${newNickname}`, threadID, messageID);
        });
    }
};
