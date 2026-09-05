const { getThreadPrefix } = require("../../utils/threadPrefixStorage");
const { isAutoBdEnabled, setAutoBd } = require("../../utils/autobdStorage");
const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const { checkCooldown } = require("../../utils/cooldown");

const defaultPrefix = process.env.BOT_PREFIX || "!";

module.exports = {
    name: "autobd",
    description: "Tự động đổi biệt danh cho thành viên mới vào nhóm theo form [kí tự box] + [tên facebook]",
    usage: `\n${defaultPrefix}autobd on → Bật tự động đổi biệt danh cho thành viên mới\n${defaultPrefix}autobd off → Tắt tự động đổi biệt danh\n${defaultPrefix}autobd status → Xem trạng thái cài đặt\n━━━━━━━━━━━━━\n📌 Yêu cầu: Nhóm phải cài đặt ký tự nhóm bằng lệnh setkitu trước\n🔒 Chỉ QTV nhóm hoặc Admin Bot mới được sử dụng`,

    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        const cmdPrefix = config?.prefix || defaultPrefix;

        // Cooldown 5s tránh spam
        const cooldown = checkCooldown({ command: "autobd", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        // Lấy thông tin nhóm
        let threadInfo;
        try {
            threadInfo = await getThreadInfoCached(api, threadID);
        } catch (e) {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm để kiểm tra quyền hạn.", threadID, messageID);
        }

        if (!threadInfo || typeof threadInfo !== "object" || threadInfo.isGroup === false) {
            return api.sendMessage("⚠️ Lệnh này chỉ có thể sử dụng trong nhóm chat.", threadID, messageID);
        }

        // Kiểm tra quyền hạn
        const adminIDs = toAdminIdList(threadInfo);
        const botID = String(api.getCurrentUserID());
        const isSenderAdmin = adminIDs.includes(String(senderID));
        const adminBotUIDs = getAdminBotUIDs();
        const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;
        const isBotAdmin = adminIDs.includes(botID);

        if (!isSenderAdmin && !isSenderBotAdmin) {
            return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc Admin Bot mới có quyền cấu hình AutoBD!", threadID, messageID);
        }

        const action = String(args[0] || "").trim().toLowerCase();

        // 1. Xử lý BẬT (ON)
        if (action === "on" || action === "bat") {
            const currentPrefix = await getThreadPrefix(threadID);
            if (!currentPrefix) {
                return api.sendMessage(
                    `⚠️ Nhóm chưa cài đặt ký tự biệt danh (setkitu).\n━━━━━━━━━━━━━\n👉 Vui lòng sử dụng lệnh:\n• ${cmdPrefix}setkitu [ký tự] (Ví dụ: ${cmdPrefix}setkitu SK-)\nđể cài đặt ký tự cho nhóm trước khi bật AutoBD!`,
                    threadID,
                    messageID
                );
            }

            await setAutoBd(threadID, true, senderID);
            let responseMsg = `✅ Đã BẬT tính năng tự động đổi biệt danh (AutoBD) cho thành viên mới!\n📌 Ký tự nhóm: "${currentPrefix}"\n👉 Thành viên mới vào nhóm sẽ tự động được đặt biệt danh: ${currentPrefix}[Tên Facebook]`;
            if (!isBotAdmin) {
                responseMsg += `\n━━━━━━━━━━━━━\n⚠️ Nhắc nhở: Bot hiện chưa có quyền Quản trị viên nhóm. Vui lòng thêm Bot làm QTV để Bot có quyền đổi biệt danh cho thành viên!`;
            }

            return api.sendMessage(responseMsg, threadID, messageID);
        }

        // 2. Xử lý TẮT (OFF)
        if (action === "off" || action === "tat") {
            await setAutoBd(threadID, false, senderID);
            return api.sendMessage("✅ Đã TẮT tính năng tự động đổi biệt danh (AutoBD) cho thành viên mới!", threadID, messageID);
        }

        // 3. Xem trạng thái / Cú pháp mặc định
        const isEnabled = await isAutoBdEnabled(threadID);
        const currentPrefix = await getThreadPrefix(threadID);
        const stateText = isEnabled ? "🟢 BẬT (ON)" : "🔴 TẮT (OFF)";
        const kituText = currentPrefix ? `"${currentPrefix}"` : "❌ Chưa cài đặt";
        const botAdminText = isBotAdmin ? "✅ Đã có" : "❌ Chưa có (Bot cần quyền QTV)";

        return api.sendMessage(
            `📌 [ CẤU HÌNH TỰ ĐỘNG BIỆT DANH - AUTOBD ]\n` +
            `• Trạng thái: ${stateText}\n` +
            `• Ký tự box: ${kituText}\n` +
            `• Quyền QTV của Bot: ${botAdminText}\n` +
            `━━━━━━━━━━━━━\n` +
            `👉 Hướng dẫn sử dụng:\n` +
            `• ${cmdPrefix}autobd on  → Bật tự động đổi biệt danh cho thành viên mới\n` +
            `• ${cmdPrefix}autobd off → Tắt tính năng tự động đổi biệt danh\n` +
            `⚠️ Lưu ý: Bắt buộc phải cài ký tự box (${cmdPrefix}setkitu [ký tự]) trước khi bật.`,
            threadID,
            messageID
        );
    }
};
