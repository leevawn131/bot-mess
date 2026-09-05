const { getThreadPrefix, setThreadPrefix, removeThreadPrefix } = require('../../utils/threadPrefixStorage');
const { getAdminBotUIDs, toAdminIdList } = require('../../utils/checkPermission');
const { getThreadInfoCached } = require('../../utils/threadInfo');
const prefix = process.env.BOT_PREFIX || "!";

module.exports = {
    name: "setkitu",
    description: "Cài đặt ký tự biệt danh riêng cho nhóm",
    usage: `\n${prefix}setkitu [ký tự] → Cài đặt ký tự biệt danh cho nhóm (VD: SK- hoặc SK.)\n${prefix}setkitu off → Xóa ký tự biệt danh riêng của nhóm\n━━━━━━━━━━━━━\n🔒 Chỉ QTV nhóm hoặc Admin Bot mới được sử dụng`,

    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        const cmdPrefix = config?.prefix || prefix;

        let threadInfo;
        try {
            threadInfo = await getThreadInfoCached(api, threadID);
        } catch (e) {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm để kiểm tra quyền.", threadID, messageID);
        }

        if (!threadInfo || typeof threadInfo !== 'object') {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm để kiểm tra quyền.", threadID, messageID);
        }

        const adminIDs = toAdminIdList(threadInfo);
        const isSenderAdmin = adminIDs.includes(String(senderID));
        const adminBotUIDs = getAdminBotUIDs();
        const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

        if (!isSenderAdmin && !isSenderBotAdmin) {
            return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc Admin Bot mới có quyền cài đặt ký tự biệt danh!", threadID, messageID);
        }

        const body = event.body || "";
        const match = body.match(/^.*?setkitu(?:\s+([\s\S]+))?$/i);
        const inputSymbol = match && match[1] !== undefined ? match[1] : args.join(" ");
        const trimmedSymbol = inputSymbol ? inputSymbol.trim() : "";

        if (!trimmedSymbol || trimmedSymbol.toLowerCase() === "check" || trimmedSymbol.toLowerCase() === "info") {
            const currentPrefix = await getThreadPrefix(threadID);
            if (currentPrefix) {
                return api.sendMessage(`📌 Ký tự biệt danh hiện tại của nhóm: "${currentPrefix}"\n━━━━━━━━━━━━━\n👉 Cách dùng:\n• ${cmdPrefix}setkitu [ký tự] → Cài ký tự mới cho nhóm (VD: ${cmdPrefix}setkitu SK-)\n• ${cmdPrefix}setkitu off → Xóa ký tự biệt danh của nhóm`, threadID, messageID);
            } else {
                return api.sendMessage(`📌 Nhóm chưa cài đặt ký tự biệt danh riêng.\n━━━━━━━━━━━━━\n👉 Cách dùng:\n• ${cmdPrefix}setkitu [ký tự] → Cài ký tự mới cho nhóm (VD: ${cmdPrefix}setkitu SK- hoặc SK.)\n• ${cmdPrefix}setkitu off → Xóa ký tự biệt danh của nhóm`, threadID, messageID);
            }
        }

        if (["off", "del", "delete", "xoa", "reset", "clear", "none"].includes(trimmedSymbol.toLowerCase())) {
            await removeThreadPrefix(threadID);
            return api.sendMessage("✅ Đã xóa ký tự biệt danh riêng của nhóm!", threadID, messageID);
        }

        if (inputSymbol.length > 20) {
            return api.sendMessage("⚠️ Ký tự biệt danh quá dài (tối đa 20 ký tự).", threadID, messageID);
        }

        await setThreadPrefix(threadID, inputSymbol, senderID);
        return api.sendMessage(`✅ Đã cài đặt ký tự biệt danh riêng cho nhóm là: "${inputSymbol}"\n👉 Từ giờ khi dùng lệnh setbd [tên], bot sẽ tự động thêm "${inputSymbol}" phía trước (ví dụ: ${inputSymbol}Tên).`, threadID, messageID);
    }
};
