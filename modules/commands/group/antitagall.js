const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { getAntitagallSetting, setAntitagallEnabled } = require("../../utils/antitagallSettings");

module.exports = {
    name: "antitagall",
    description: "Bật/tắt antitagall để tự động kick người tag @everyone/@mọi người",
    usage: "\n!antitagall on → Bật chống spam tag @everyone\n!antitagall off → Tắt chống spam tag\n!antitagall status → Xem trạng thái hiện tại\n━━━━━━━━━━━━━━━━━━\n🛡️ Tự động kick người tag spam @everyone/@mọi người\n⚠️ Yêu cầu: Bot phải có quyền QTV\n🔒 Chỉ QTV nhóm/chủ bot mới dùng được",

    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;

        const cooldown = checkCooldown({ command: "antitagall", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            const threadInfo = await api.getThreadInfo(threadID);
            if (!threadInfo || typeof threadInfo !== 'object' || !threadInfo.isGroup) {
                return api.sendMessage("⚠️ Không thể lấy thông tin nhóm hoặc lệnh này chỉ dùng trong nhóm chat.", threadID, messageID);
            }

            const adminIDs = (threadInfo.adminIDs || []).map((item) => String(item.id || item));
            const botID = String(api.getCurrentUserID());
            const isSenderAdmin = adminIDs.includes(String(senderID));
            const adminBotUIDs = getAdminBotUIDs();
            const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;
            const isBotAdmin = adminIDs.includes(botID);

            if (!isSenderAdmin && !isSenderBotAdmin) {
                return api.sendMessage("⚠️ Chỉ QTV nhóm hoặc chủ bot mới được bật/tắt antitagall.", threadID, messageID);
            }

            const action = String(args[0] || "status").trim().toLowerCase();
            const current = getAntitagallSetting(threadID);

            if (["status", "st", "s"].includes(action)) {
                const stateText = current.enabled ? "ON" : "OFF";
                const botAdminText = isBotAdmin ? "✅ Có" : "❌ Không";
                return api.sendMessage(
                    `🛡️ ANTITAGALL: ${stateText}\n👮 Bot có quyền QTV: ${botAdminText}\n💡 Dùng: !antitagall on hoặc !antitagall off`,
                    threadID,
                    messageID
                );
            }

            if (!["on", "off"].includes(action)) {
                return api.sendMessage("⚠️ Cách dùng: !antitagall [on | off | status]", threadID, messageID);
            }

            if (!isBotAdmin) {
                return api.sendMessage("❌ Bot cần quyền Quản Trị Viên để bật antitagall!", threadID, messageID);
            }

            const shouldEnable = action === "on";
            if (current.enabled === shouldEnable) {
                const stateText = shouldEnable ? "đã bật" : "đã tắt";
                return api.sendMessage(`ℹ️ Antitagall ${stateText} rồi.`, threadID, messageID);
            }

            setAntitagallEnabled(threadID, shouldEnable, String(senderID));

            const result = shouldEnable ? "✅ Bật" : "❌ Tắt";
            return api.sendMessage(
                `${result} antitagall thành công!\n🛡️ Bot sẽ tự động kick người tag spam @everyone/@mọi người.`,
                threadID,
                messageID
            );

        } catch (error) {
            console.error("❌ Lỗi antitagall:", error);
            return api.sendMessage("❌ Có lỗi xảy ra: " + error.message, threadID, messageID);
        }
    }
};
