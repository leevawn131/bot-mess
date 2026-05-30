const { checkCooldown } = require('../../utils/cooldown');
const { getAdminBotUIDs } = require('../../utils/checkPermission');
const { getJoinGreeting, setJoinGreeting } = require('../../utils/joinGreetingSettings');

module.exports = {
    name: "setwelcome",
    description: "Cài câu chào khi có người vào nhóm",
    usage: "\n!setwelcome [câu chào] → Cài câu chào riêng cho nhóm\n!setwelcome check → Xem câu chào hiện tại\n!setwelcome reset → Quay về câu chào mặc định\n━{13}\n📌 Biến hỗ trợ: {name}, {names}, {count}, {@tag}, {@tags}\n💡 VD: !setwelcome Chào {@tag}, nhớ đọc nội quy nha!",
    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;
        const prefix = "!setwelcome";

        const cooldown = checkCooldown({ command: "setwelcome", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        let threadInfo;
        try {
            threadInfo = await api.getThreadInfo(threadID);
        } catch (error) {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm.", threadID, messageID);
        }

        if (!threadInfo || typeof threadInfo !== 'object') {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm.", threadID, messageID);
        }

        const adminIDs = (threadInfo.adminIDs || []).map((item) => String(item.id));
        const isBotAdmin = adminIDs.includes(String(api.getCurrentUserID()));
        const isSenderAdmin = adminIDs.includes(String(senderID));
        const adminBotUIDs = getAdminBotUIDs();
        const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

        if (!isSenderAdmin && !isSenderBotAdmin) {
            return api.sendMessage("⚠️ Chỉ admin nhóm hoặc chủ bot mới được cài câu chào.", threadID, messageID);
        }

        if (!isBotAdmin) {
            return api.sendMessage("🚫 Bot cần quyền Quản trị viên nhóm để đổi câu chào.", threadID, messageID);
        }

        const rawInput = args.join(" ").trim();
        if (!rawInput) {
            const current = getJoinGreeting(threadID);
            return api.sendMessage(
                current
                    ? `📌 HƯỚNG DẪN ${prefix.toUpperCase()}\n━{13}\n` +
                      `• Câu chào hiện tại:\n${current}\n\n` +
                      `• Cú pháp:\n${prefix} check\n${prefix} <nội dung câu chào>\n${prefix} reset\n\n` +
                                            `• Biến hỗ trợ:\n{name} = tên người vào nhóm đầu tiên\n{names} = danh sách tất cả tên\n{count} = số người vừa vào\n{@tag} = tag người vào đầu tiên\n{@tags} = tag tất cả người vừa vào\n\n` +
                                            `• Ví dụ:\n${prefix} Chào {@tag}, nhớ đọc nội quy nha!\n${prefix} Chào {@tags}, chào mừng đến với nhóm!\n\n` +
                      `• Dùng ${prefix} reset để quay về câu chào mặc định hiện tại.`
                    : `📌 HƯỚNG DẪN ${prefix.toUpperCase()}\n━{13}\n` +
                      `• Nhóm đang dùng câu chào mặc định:\nChào mừng {names} đã tham gia nhóm! 🥳\n\n` +
                      `• Cú pháp:\n${prefix} check\n${prefix} <nội dung câu chào>\n${prefix} reset\n\n` +
                                            `• Biến hỗ trợ:\n{name} = tên người vào nhóm đầu tiên\n{names} = danh sách tất cả tên\n{count} = số người vừa vào\n{@tag} = tag người vào đầu tiên\n{@tags} = tag tất cả người vừa vào\n\n` +
                                            `• Ví dụ:\n${prefix} Chào {@tag}, vào nhóm thì đọc nội quy trước nhé!\n${prefix} Chào {@tags}, nhóm mình rất vui khi có bạn!\n${prefix} Có {count} thành viên mới vừa gia nhập!\n\n` +
                      `• Cài xong, bot sẽ tự dùng câu chào riêng cho nhóm này.`,
                threadID,
                messageID,
            );
        }

        const normalized = rawInput.toLowerCase();
        if (["check", "view", "show", "current"].includes(normalized)) {
            const current = getJoinGreeting(threadID);
            return api.sendMessage(
                current
                    ? `📌 Câu chào hiện tại của nhóm:\n${current}`
                    : `📌 Nhóm đang dùng câu chào mặc định:\nChào mừng {names} đã tham gia nhóm! 🥳`,
                threadID,
                messageID,
            );
        }

        if (["reset", "off", "default", "remove", "clear"].includes(normalized)) {
            setJoinGreeting(threadID, "");
            return api.sendMessage("✅ Đã xoá câu chào riêng của nhóm, quay về mặc định.", threadID, messageID);
        }

        if (rawInput.length > 500) {
            return api.sendMessage("⚠️ Câu chào quá dài, tối đa 500 ký tự.", threadID, messageID);
        }

        setJoinGreeting(threadID, rawInput);
        return api.sendMessage(
            `✅ Đã cài câu chào riêng cho nhóm.`,
            threadID,
            messageID,
        );
    }
};