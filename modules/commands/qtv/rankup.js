const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const { getLevelSetting, setLevelEnabled, setLevelNotiEnabled } = require("../../utils/levelSettings");
const { getCustomPrefix } = require("../../utils/customPrefix");

const defaultPrefix = process.env.BOT_PREFIX || "!";

module.exports = {
    name: "rankup",
    aliases: ["level", "levelsystem", "capdo", "rank"],
    description: "Bật/Tắt hệ thống Level & EXP hoặc Thông Báo lên cấp trong nhóm chat",
    usage: `\n${defaultPrefix}rankup on ➔ Bật hệ thống level (tích EXP & thông báo)\n${defaultPrefix}rankup off ➔ Tắt hệ thống level\n${defaultPrefix}rankup thongbao on ➔ Bật thông báo thăng cấp\n${defaultPrefix}rankup thongbao off ➔ Tắt thông báo thăng cấp (vẫn tích EXP)\n${defaultPrefix}rankup status ➔ Xem trạng thái hiện tại\n━━━━━━━━━━━━━\n⭐ Cú pháp tắt thông báo tắt gọn: ${defaultPrefix}rankup noti off / ${defaultPrefix}rankup tb off\n🔒 Chỉ QTV nhóm hoặc chủ bot mới có quyền bật/tắt`,

    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        const customPrefix = await getCustomPrefix(threadID);
        const prefix = customPrefix || config?.prefix || defaultPrefix;

        const cooldown = checkCooldown({ command: "rankup", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            const threadInfo = await getThreadInfoCached(api, threadID);
            if (!threadInfo || typeof threadInfo !== "object" || !threadInfo.isGroup) {
                return api.sendMessage("⚠️ Lệnh này chỉ áp dụng cho nhóm chat.", threadID, messageID);
            }

            const currentSetting = await getLevelSetting(threadID);
            const subCmd = String(args[0] || "status").trim().toLowerCase();
            const actionArg = String(args[1] || "").trim().toLowerCase();

            // 1. Xem trạng thái hiện tại (ai cũng dùng được)
            if (["status", "st", "s", "info"].includes(subCmd) && !actionArg) {
                const sysStateText = currentSetting.enabled ? "🟢 ĐANG BẬT" : "🔴 ĐÃ TẮT";
                const notiStateText = currentSetting.notiEnabled ? "🟢 ĐANG BẬT" : "🔴 ĐÃ TẮT";
                return api.sendMessage(
                    `⭐ HỆ THỐNG LEVEL NHÓM ⭐\n━━━━━━━━━━━━━\n📌 Trạng thái Level & EXP: ${sysStateText}\n🔔 Thông báo lên cấp: ${notiStateText}\n━━━━━━━━━━━━━\n💡 Cú pháp:\n👉 ${prefix}rankup on / off ➔ Bật/Tắt hệ thống Level\n👉 ${prefix}rankup thongbao on / off ➔ Bật/Tắt riêng thông báo lên cấp`,
                    threadID,
                    messageID
                );
            }

            // 2. Xử lý bật/tắt riêng THÔNG BÁO (ví dụ: rankup thongbao off, rankup noti on, rankup tb off)
            const isNotiCmd = ["thongbao", "noti", "tb", "notification"].includes(subCmd);
            if (isNotiCmd || (["on", "off", "bat", "tat", "enable", "disable"].includes(subCmd) && ["thongbao", "noti", "tb"].includes(actionArg))) {
                // Xác định trạng thái mong muốn
                let targetAction = "";
                if (isNotiCmd) {
                    targetAction = actionArg;
                } else {
                    targetAction = subCmd;
                }

                if (!["on", "off", "bat", "tat", "enable", "disable"].includes(targetAction)) {
                    return api.sendMessage(`⚠️ Cú pháp không hợp lệ. Sử dụng: ${prefix}rankup thongbao [on | off]`, threadID, messageID);
                }

                // Kiểm tra quyền QTV / Admin Bot
                const adminIDs = toAdminIdList(threadInfo);
                const isSenderAdmin = adminIDs.includes(String(senderID));
                const adminBotUIDs = getAdminBotUIDs();
                const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

                if (!isSenderAdmin && !isSenderBotAdmin) {
                    return api.sendMessage("⚠️ Chỉ QTV nhóm hoặc chủ bot mới được quyền thay đổi cấu hình thông báo level.", threadID, messageID);
                }

                const nextNotiEnabled = ["on", "bat", "enable"].includes(targetAction);
                const alreadySame = currentSetting.notiEnabled === nextNotiEnabled;

                if (!alreadySame) {
                    await setLevelNotiEnabled(threadID, nextNotiEnabled, senderID);
                }

                const resultText = nextNotiEnabled
                    ? "🔔 Đã BẬT thông báo thăng cấp cho nhóm. Bot sẽ nhắn tin chúc mừng khi thành viên lên cấp."
                    : "🔕 Đã TẮT thông báo thăng cấp cho nhóm. Bot vẫn sẽ âm thầm tích lũy EXP và lên cấp nhưng không nhắn tin thông báo.";

                const suffix = alreadySame ? "\n(Trạng thái thông báo đã như vậy)" : "";
                return api.sendMessage(`${resultText}${suffix}`, threadID, messageID);
            }

            // 3. Xử lý bật/tắt TOÀN BỘ hệ thống Level (rankup on / rankup off)
            if (["on", "off", "bat", "tat", "enable", "disable"].includes(subCmd)) {
                // Kiểm tra quyền QTV / Admin Bot
                const adminIDs = toAdminIdList(threadInfo);
                const isSenderAdmin = adminIDs.includes(String(senderID));
                const adminBotUIDs = getAdminBotUIDs();
                const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

                if (!isSenderAdmin && !isSenderBotAdmin) {
                    return api.sendMessage("⚠️ Chỉ QTV nhóm hoặc chủ bot mới được quyền bật/tắt hệ thống Level.", threadID, messageID);
                }

                const nextEnabled = ["on", "bat", "enable"].includes(subCmd);
                const alreadySame = currentSetting.enabled === nextEnabled;

                if (!alreadySame) {
                    await setLevelEnabled(threadID, nextEnabled, senderID);
                }

                const resultText = nextEnabled
                    ? "✅ Đã BẬT hệ thống Level & EXP cho nhóm. Thành viên sẽ tích lũy kinh nghiệm khi trò chuyện."
                    : "⛔ Đã TẮT toàn bộ hệ thống Level & EXP cho nhóm. Bot sẽ ngừng tích lũy kinh nghiệm và không phát thông báo thăng cấp.";

                const suffix = alreadySame ? "\n(Trạng thái hiện tại đã như vậy)" : "";
                return api.sendMessage(`${resultText}${suffix}`, threadID, messageID);
            }

            return api.sendMessage(`⚠️ Cú pháp không hợp lệ. Sử dụng: ${prefix}rankup [on | off | thongbao on | thongbao off | status]`, threadID, messageID);
        } catch (error) {
            console.error("❌ Lỗi thực thi lệnh rankup:", error);
            return api.sendMessage("❌ Không thể cập nhật trạng thái hệ thống level lúc này.", threadID, messageID);
        }
    }
};
