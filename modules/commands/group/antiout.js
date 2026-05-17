const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { getAntioutSetting, setAntioutEnabled } = require("../../utils/antioutSettings");

module.exports = {
    name: "antiout",
    description: "Bật/tắt antiout để tự kéo lại người tự rời nhóm",
    usage: "\n!antiout on → Bật chống rời nhóm\n!antiout off → Tắt chống rời nhóm\n!antiout status → Xem trạng thái hiện tại\n━━━━━━━━━━━━━━━━━━\n🛡️ Tự kéo lại người tự rời nhóm\n⚠️ Yêu cầu: Bot phải có quyền QTV\n🔒 Chỉ QTV nhóm/chủ bot mới dùng được",

    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;

        const cooldown = checkCooldown({ command: "antiout", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            const threadInfo = await api.getThreadInfo(threadID);
            if (!threadInfo || typeof threadInfo !== 'object' || !threadInfo.isGroup) {
                return api.sendMessage("⚠️ Không thể lấy thông tin nhóm hoặc lệnh này chỉ dùng trong nhóm chat.", threadID, messageID);
            }

            const adminIDs = (threadInfo.adminIDs || []).map((item) => String(item.id));
            const botID = String(api.getCurrentUserID());
            const isSenderAdmin = adminIDs.includes(String(senderID));
            const adminBotUIDs = getAdminBotUIDs();
            const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;
            const isBotAdmin = adminIDs.includes(botID);

            if (!isSenderAdmin && !isSenderBotAdmin) {
                return api.sendMessage("⚠️ Chỉ QTV nhóm hoặc chủ bot mới được bật/tắt antiout.", threadID, messageID);
            }

            const action = String(args[0] || "status").trim().toLowerCase();
            const current = getAntioutSetting(threadID);

            if (["status", "st", "s"].includes(action)) {
                const stateText = current.enabled ? "ON" : "OFF";
                const botAdminText = isBotAdmin ? "✅ Có" : "❌ Không";
                return api.sendMessage(
                    `🛡️ ANTIOUT: ${stateText}\n👮 Bot có quyền QTV: ${botAdminText}\n💡 Dùng: !antiout on hoặc !antiout off`,
                    threadID,
                    messageID
                );
            }

            if (!["on", "off"].includes(action)) {
                return api.sendMessage("⚠️ Cách dùng: !antiout [on | off | status]", threadID, messageID);
            }

            const nextEnabled = action === "on";
            const alreadySame = current.enabled === nextEnabled;

            if (!alreadySame) {
                setAntioutEnabled(threadID, nextEnabled, senderID);
            }

            if (nextEnabled && !isBotAdmin) {
                return api.sendMessage(
                    "✅ Đã bật antiout, nhưng bot chưa có quyền QTV nên chưa thể kéo lại thành viên.\n💡 Hãy cấp quyền QTV cho bot để antiout hoạt động.",
                    threadID,
                    messageID
                );
            }

            const resultText = nextEnabled ? "✅ Đã bật antiout." : "✅ Đã tắt antiout.";
            const suffix = alreadySame ? " (trạng thái đã như vậy từ trước)" : "";
            return api.sendMessage(`${resultText}${suffix}`, threadID, messageID);
        } catch (e) {
            console.error("Lỗi antiout:", e);
            return api.sendMessage("❌ Không thể cập nhật antiout lúc này.", threadID, messageID);
        }
    }
};