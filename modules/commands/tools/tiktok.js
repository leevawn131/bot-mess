const { isAutodownTiktokEnabled, setAutodownTiktokEnabled } = require("../../utils/tiktokSettings");
const { toAdminIdList, getAdminBotUIDs } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");

module.exports = {
    name: "tiktok",
    aliases: ["autotiktok", "autodowntiktok"],
    description: "Bật hoặc tắt tự động tải video TikTok khi phát hiện link trong nhóm",
    usage: "\n!tiktok on → Bật tính năng tự động tải\n!tiktok off → Tắt tính năng tự động tải\n!tiktok → Xem trạng thái hiện tại\n━━━━━━━━━━━━━\n💡 Mặc định bật khi nhóm đang thuê bot, mặc định tắt khi không thuê bot\n🔒 Chỉ Quản trị viên nhóm hoặc Admin bot mới có thể thay đổi",
    credits: "Antigravity",

    execute: async ({ api, event, args }) => {
        const { threadID, senderID, messageID } = event;
        const opt = (args[0] || "").toLowerCase();

        // Kiểm tra quyền: phải là admin nhóm hoặc admin bot
        let threadInfo;
        try {
            threadInfo = await getThreadInfoCached(api, threadID);
        } catch (e) {
            console.error("Lỗi lấy thông tin nhóm:", e);
        }

        const adminIDs = toAdminIdList(threadInfo);
        const adminBotUIDs = getAdminBotUIDs();
        const isGroupAdmin = adminIDs.includes(String(senderID));
        const isBotAdmin = adminBotUIDs.includes(String(senderID));

        if (!opt) {
            // Xem trạng thái hiện tại
            const isEnabled = await isAutodownTiktokEnabled(threadID);
            const statusStr = isEnabled ? "🟢 ĐANG BẬT" : "🔴 ĐANG TẮT";
            return api.sendMessage(
                `🎥 [ AUTODOWN TIKTOK ]\n━━━━━━━━━━━━━\n` +
                `Trạng thái: ${statusStr}\n` +
                `💡 Mẹo: Dùng '!tiktok on' hoặc '!tiktok off' để bật/tắt tính năng tự động tải video khi gửi link TikTok.`,
                threadID,
                messageID
            );
        }

        if (!isGroupAdmin && !isBotAdmin) {
            return api.sendMessage(
                "❌ Bạn không có quyền sử dụng lệnh này! Chỉ Quản trị viên nhóm hoặc Admin bot mới được bật/tắt.",
                threadID,
                messageID
            );
        }

        if (opt === "on") {
            setAutodownTiktokEnabled(threadID, true);
            return api.sendMessage(
                "🟢 Đã BẬT tính năng tự động tải video khi gửi link TikTok trong nhóm.",
                threadID,
                messageID
            );
        } else if (opt === "off") {
            setAutodownTiktokEnabled(threadID, false);
            return api.sendMessage(
                "🔴 Đã TẮT tính năng tự động tải video khi gửi link TikTok trong nhóm.",
                threadID,
                messageID
            );
        } else {
            return api.sendMessage(
                "❌ Cú pháp không hợp lệ. Vui lòng dùng: !tiktok on hoặc !tiktok off",
                threadID,
                messageID
            );
        }
    }
};
