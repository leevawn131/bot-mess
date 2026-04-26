const { checkCooldown } = require('../../utils/cooldown');
const { ADMIN_BOT_UIDS } = require('../../utils/checkPermission');
const { getGroupRule, setGroupRule } = require('../../utils/groupRulesSettings');

module.exports = {
    name: "luatnhom",
    description: "Lưu luật riêng cho từng nhóm",
    usage: "[set <nội dung> | check | reset]",
    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;

        const cooldown = checkCooldown({ command: "luatnhom", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        let threadInfo;
        try {
            threadInfo = await api.getThreadInfo(threadID);
        } catch (error) {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm.", threadID, messageID);
        }

        if (!threadInfo.isGroup) {
            return api.sendMessage("⚠️ Lệnh này chỉ dùng trong nhóm chat.", threadID, messageID);
        }

        const adminIDs = (threadInfo.adminIDs || []).map((item) => String(item.id));
        const botID = String(api.getCurrentUserID());
        const isBotAdmin = adminIDs.includes(botID);
        const isSenderAdmin = adminIDs.includes(String(senderID));
        const isSenderBotAdmin = ADMIN_BOT_UIDS.includes(String(senderID));

        if (!isSenderAdmin && !isSenderBotAdmin) {
            return api.sendMessage("⚠️ Chỉ admin nhóm hoặc chủ bot mới được cài luật nhóm.", threadID, messageID);
        }

        if (!isBotAdmin) {
            return api.sendMessage("🚫 Bot cần quyền Quản trị viên nhóm để lưu luật.", threadID, messageID);
        }

        const action = String(args[0] || "check").toLowerCase();
        const currentRule = getGroupRule(threadID);

        if (!args[0] || ["check", "show", "view", "status"].includes(action)) {
            return api.sendMessage(
                currentRule
                    ? `📌 LUẬT HIỆN TẠI CỦA NHÓM:\n${currentRule}`
                    : `📌 Nhóm chưa có luật riêng.\nDùng !luatnhom set <nội dung> để lưu luật.`,
                threadID,
                messageID,
            );
        }

        if (["reset", "clear", "off", "remove"].includes(action)) {
            setGroupRule(threadID, "");
            return api.sendMessage("✅ Đã xoá luật riêng của nhóm.", threadID, messageID);
        }

        const rawText = args.join(" ").trim();
        const ruleText = ["set", "add", "update", "save"].includes(action)
            ? args.slice(1).join(" ").trim()
            : rawText;

        if (!ruleText) {
            return api.sendMessage(
                `📌 HƯỚNG DẪN !luatnhom\n━━━━━━━━━━━━━━━━━━\n` +
                `• Xem luật: !luatnhom check\n` +
                `• Lưu luật: !luatnhom set <nội dung luật>\n` +
                `• Xoá luật: !luatnhom reset\n\n` +
                `Ví dụ:\n!luatnhom set Không spam, không toxic, không đăng link bậy.`,
                threadID,
                messageID,
            );
        }

        if (ruleText.length > 2000) {
            return api.sendMessage("⚠️ Luật quá dài, tối đa 2000 ký tự.", threadID, messageID);
        }

        setGroupRule(threadID, ruleText);
        return api.sendMessage(
            `✅ Đã lưu luật riêng cho nhóm.\nDùng !luatnhom check để xem lại.`,
            threadID,
            messageID,
        );
    }
};