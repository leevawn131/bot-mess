const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { execute: executeQuery } = require("../../utils/database");
const { getThreadInfoCached } = require("../../utils/threadInfo");

module.exports = {
    name: "sendallbox",
    description: "Gửi tin nhắn thông báo cho tất cả các nhóm đang thuê bot",
    usage: "\n!sendallbox [nội dung] → Gửi tin nhắn thông báo cho tất cả nhóm đang thuê bot\n━━━━━━━━━━━━━\n🔒 Chỉ Admin Bot mới được sử dụng",

    execute: async ({ api, event, args, config }) => {
        const { threadID, senderID, messageID } = event;
        const prefix = config?.prefix || "!";

        // 1. Kiểm tra quyền Admin Bot
        const adminBotUIDs = getAdminBotUIDs();
        if (!adminBotUIDs.includes(String(senderID))) {
            return api.sendMessage("⚠️ Bạn không có quyền sử dụng lệnh này. Chỉ Admin Bot mới được sử dụng!", threadID, messageID);
        }

        // 2. Lấy nội dung thông báo
        const content = args.join(" ").trim();
        if (!content) {
            return api.sendMessage(`⚠️ Cú pháp: ${prefix}sendallbox [nội dung thông báo]`, threadID, messageID);
        }

        // 3. Truy vấn các nhóm đang thuê bot (có thời hạn thuê lớn hơn hiện tại)
        let rentedGroups = [];
        try {
            rentedGroups = await executeQuery(
                "SELECT DISTINCT thread_id FROM rented_groups WHERE expire_date > CURRENT_TIMESTAMP"
            );
        } catch (err) {
            console.error("Lỗi khi truy vấn nhóm thuê bot:", err);
            return api.sendMessage("❌ Lỗi truy cập cơ sở dữ liệu khi lấy danh sách nhóm.", threadID, messageID);
        }

        if (!rentedGroups || rentedGroups.length === 0) {
            return api.sendMessage("⚠️ Hiện tại không có nhóm nào đang trong thời gian thuê bot.", threadID, messageID);
        }

        const total = rentedGroups.length;
        await api.sendMessage(`📢 Bắt đầu gửi thông báo đến ${total} nhóm đang thuê bot...`, threadID);

        let success = 0;
        let fail = 0;
        const failedGroupsList = [];

        // Gửi thông báo đến từng nhóm kèm delay 1s để tránh bị spam block
        for (const group of rentedGroups) {
            const targetThreadID = String(group.thread_id);
            try {
                const notifyMsg = `📢 **THÔNG BÁO TỪ ADMIN BOT** 📢\n━━━━━━━━━━━━━━━━━━━━\n${content}`;
                await api.sendMessage(notifyMsg, targetThreadID);
                success++;
            } catch (err) {
                console.error(`Lỗi khi gửi thông báo tới nhóm ${targetThreadID}:`, err.message);
                fail++;
                
                // Lấy tên nhóm thất bại (nếu có trong cache hoặc fetch)
                let groupName = "Không tìm thấy tên";
                try {
                    const info = await getThreadInfoCached(api, targetThreadID);
                    if (info && info.threadName) {
                        groupName = info.threadName;
                    }
                } catch (_) {}
                failedGroupsList.push({ id: targetThreadID, name: groupName });
            }
            // Delay 1 giây
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        let report = `📊 **KẾT QUẢ GỬI THÔNG BÁO**\n━━━━━━━━━━━━━━━━━━━━\n` +
            `• Tổng số nhóm thuê: ${total}\n` +
            `• Gửi thành công: ${success} nhóm\n` +
            `• Thất bại: ${fail} nhóm`;

        if (failedGroupsList.length > 0) {
            report += `\n\n❌ **DANH SÁCH NHÓM THẤT BẠI:**\n`;
            failedGroupsList.forEach((g, idx) => {
                report += `${idx + 1}. ${g.name} (ID: ${g.id})\n`;
            });
        }

        return api.sendMessage(report.trim(), threadID, messageID);
    }
};
