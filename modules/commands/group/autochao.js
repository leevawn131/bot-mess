const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { getAutochaoSetting, setAutochaoEnabled } = require("../../utils/autochaoSettings");

module.exports = {
    name: "autochao",
    description: "Bật/tắt auto chào để bot tự gửi sticker khi có người nhắn lời chào",
    usage: "\n!autochao on → Bật auto chào\n!autochao off → Tắt auto chào\n!autochao status → Xem trạng thái hiện tại\n━{13}\n🤖 Bot sẽ tự gửi sticker khi phát hiện lời chào ngắn như hi/hello/chào\n🔒 Chỉ QTV nhóm hoặc chủ bot mới dùng được",

    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;

        const cooldown = checkCooldown({ command: "autochao", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            const threadInfo = await api.getThreadInfo(threadID);
            if (!threadInfo || typeof threadInfo !== "object" || !threadInfo.isGroup) {
                return api.sendMessage("⚠️ Không thể lấy thông tin nhóm hoặc lệnh này chỉ dùng trong nhóm chat.", threadID, messageID);
            }

            const adminIDs = (threadInfo.adminIDs || []).map((item) => String(item.id || item));
            const botID = String(api.getCurrentUserID());
            const isSenderAdmin = adminIDs.includes(String(senderID));
            const adminBotUIDs = getAdminBotUIDs();
            const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;
            const isBotAdmin = adminIDs.includes(botID);

            if (!isSenderAdmin && !isSenderBotAdmin) {
                return api.sendMessage("⚠️ Chỉ QTV nhóm hoặc chủ bot mới được bật/tắt auto chào.", threadID, messageID);
            }

            const action = String(args[0] || "status").trim().toLowerCase();
            const current = getAutochaoSetting(threadID);

            if (["status", "st", "s"].includes(action)) {
                const stateText = current.enabled ? "ON" : "OFF";
                const botAdminText = isBotAdmin ? "✅ Có" : "❌ Không";
                return api.sendMessage(
                    `🤖 AUTOCHAO: ${stateText}\n👮 Bot có quyền QTV: ${botAdminText}\n💡 Dùng: !autochao on hoặc !autochao off`,
                    threadID,
                    messageID
                );
            }

            if (!["on", "off"].includes(action)) {
                return api.sendMessage("⚠️ Cách dùng: !autochao [on | off | status]", threadID, messageID);
            }

            const nextEnabled = action === "on";
            const alreadySame = current.enabled === nextEnabled;

            if (!alreadySame) {
                setAutochaoEnabled(threadID, nextEnabled, senderID);
            }

            const resultText = nextEnabled ? "✅ Đã bật auto chào." : "✅ Đã tắt auto chào.";
            const suffix = alreadySame ? " (trạng thái đã như vậy từ trước)" : "";
            return api.sendMessage(`${resultText}${suffix}`, threadID, messageID);
        } catch (error) {
            console.error("❌ Lỗi autochao:", error);
            return api.sendMessage("❌ Không thể cập nhật auto chào lúc này.", threadID, messageID);
        }
    }
};