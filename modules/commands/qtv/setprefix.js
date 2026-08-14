const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const { getCustomPrefix, setCustomPrefix, getLastChangedTime, removeCustomPrefix } = require("../../utils/customPrefix");

module.exports = {
    name: "setprefix",
    aliases: ["setfrefix"],
    description: "Đổi prefix (tiền tố lệnh) riêng cho nhóm",
    usage: "\n/setprefix [ký tự mới] → Đổi prefix của nhóm (VD: /setprefix !)\n/setprefix reset → Đặt lại prefix mặc định của Bot\n━━━━━━━━━━━━━━━━━━\n🔒 Chỉ QTV nhóm hoặc Admin Bot mới được sử dụng\n⏳ Giới hạn: Chỉ đổi được tối đa 7 ngày 1 lần",

    execute: async ({ api, event, args, config }) => {
        const { threadID, senderID, messageID } = event;
        const defaultPrefix = config?.prefix || "/";

        // Cooldown 3s để tránh spam lệnh
        const cooldown = checkCooldown({ command: "setprefix", key: senderID, durationMs: 3000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        // 1. Kiểm tra xem có đang ở trong nhóm chat hay không
        let threadInfo;
        try {
            threadInfo = await getThreadInfoCached(api, threadID);
        } catch (e) {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm để kiểm tra quyền hạn.", threadID, messageID);
        }

        if (!threadInfo || typeof threadInfo !== 'object' || !threadInfo.isGroup) {
            return api.sendMessage("⚠️ Lệnh này chỉ có thể sử dụng trong nhóm chat.", threadID, messageID);
        }

        // 2. Kiểm tra quyền hạn: Chỉ QTV nhóm hoặc Admin Bot
        const adminIDs = toAdminIdList(threadInfo);
        const isSenderAdmin = adminIDs.includes(String(senderID));
        const adminBotUIDs = getAdminBotUIDs();
        const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

        if (!isSenderAdmin && !isSenderBotAdmin) {
            return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc Admin Bot mới có quyền đổi prefix nhóm!", threadID, messageID);
        }

        // 3. Lấy thông tin prefix hiện tại
        const customPrefix = await getCustomPrefix(threadID);
        const currentPrefix = customPrefix || defaultPrefix;

        // Nếu không nhập gì, hiển thị thông tin hướng dẫn
        if (args.length === 0) {
            return api.sendMessage(
                `📌 Prefix hiện tại của nhóm: "${currentPrefix}"\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `👉 Cách dùng:\n` +
                `• ${currentPrefix}setprefix [ký tự mới] → Đổi prefix nhóm (VD: ${currentPrefix}setprefix ! hoặc ${currentPrefix}setprefix .)\n` +
                `• ${currentPrefix}setprefix reset → Khôi phục prefix mặc định của Bot ("${defaultPrefix}")\n` +
                `⏳ Lưu ý: Chỉ được đổi tối đa 7 ngày 1 lần.`,
                threadID,
                messageID
            );
        }

        let newPrefix = args.join(" ").trim();

        // 4. Kiểm tra giới hạn 7 ngày (Bỏ qua cho Admin Bot)
        const lastChanged = await getLastChangedTime(threadID);
        const now = Date.now();
        const COOLDOWN_7_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

        if (!isSenderBotAdmin && lastChanged > 0 && (now - lastChanged) < COOLDOWN_7_DAYS_MS) {
            const timeLeftMs = COOLDOWN_7_DAYS_MS - (now - lastChanged);
            const daysLeft = Math.floor(timeLeftMs / (24 * 60 * 60 * 1000));
            const hoursLeft = Math.floor((timeLeftMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
            const minutesLeft = Math.floor((timeLeftMs % (60 * 60 * 1000)) / (60 * 1000));

            let timeLeftStr = "";
            if (daysLeft > 0) timeLeftStr += `${daysLeft} ngày `;
            if (hoursLeft > 0 || daysLeft > 0) timeLeftStr += `${hoursLeft} giờ `;
            timeLeftStr += `${minutesLeft} phút`;

            return api.sendMessage(
                `⚠️ Nhóm chỉ được đổi prefix tối đa 7 ngày 1 lần.\n⏳ Vui lòng đợi thêm: ${timeLeftStr}.`,
                threadID,
                messageID
            );
        }

        // 5. Xử lý đặt lại prefix (reset)
        if (["reset", "default", "off", "del", "delete", "none"].includes(newPrefix.toLowerCase())) {
            if (currentPrefix === defaultPrefix) {
                return api.sendMessage(`ℹ️ Prefix của nhóm hiện tại đã là mặc định ("${defaultPrefix}") rồi.`, threadID, messageID);
            }
            await removeCustomPrefix(threadID);
            // Cập nhật lại thời gian đổi lần cuối
            await setCustomPrefix(threadID, defaultPrefix, senderID);

            // Tự động cập nhật biệt danh của bot trong nhóm
            const botID = api.getCurrentUserID();
            api.changeNickname(`『 ${defaultPrefix} 』• Bot láo loz`, threadID, botID, (err) => {
                if (err) console.error("Lỗi đổi biệt danh bot khi reset prefix:", err);
            });

            return api.sendMessage(
                `✅ Đã khôi phục prefix nhóm về mặc định: "${defaultPrefix}"\n` +
                `👉 Bắt đầu từ giờ hãy dùng "${defaultPrefix}" trước mỗi lệnh.`,
                threadID,
                messageID
            );
        }

        // 6. Kiểm tra tính hợp lệ của prefix mới
        if (newPrefix.length > 10) {
            return api.sendMessage("⚠️ Ký tự prefix quá dài (tối đa 10 ký tự).", threadID, messageID);
        }

        if (newPrefix.includes(" ")) {
            return api.sendMessage("⚠️ Prefix không được chứa dấu cách (khoảng trắng).", threadID, messageID);
        }

        // 7. Thực hiện cập nhật prefix mới
        await setCustomPrefix(threadID, newPrefix, senderID);

        // Tự động cập nhật biệt danh của bot trong nhóm
        const botID = api.getCurrentUserID();
        api.changeNickname(`『 ${newPrefix} 』• Bot láo loz`, threadID, botID, (err) => {
            if (err) console.error("Lỗi đổi biệt danh bot khi set prefix:", err);
        });

        return api.sendMessage(
            `✅ Đã cài đặt prefix riêng cho nhóm thành công!\n` +
            `👉 Prefix mới: "${newPrefix}"\n` +
            `⏰ Bạn chỉ có thể thay đổi tiếp theo sau 7 ngày nữa.`,
            threadID,
            messageID
        );
    }
};
