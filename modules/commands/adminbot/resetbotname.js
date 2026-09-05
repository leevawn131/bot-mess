const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { execute: executeQuery } = require("../../utils/database");

module.exports = {
    name: "resetbotname",
    description: "Đặt lại biệt danh của bot trong tất cả các nhóm hiện tại",
    usage: "\n!resetbotnick → Đổi biệt danh của bot trong các nhóm hiện tại thành 『[prefix]』• Bot láo loz\n━━━━━━━━━━━━━\n🔒 Chỉ Admin Bot mới được sử dụng",

    execute: async ({ api, event, config }) => {
        const { threadID, senderID, messageID } = event;
        const prefix = config?.prefix || "!";

        // 1. Kiểm tra quyền Admin Bot
        const adminBotUIDs = getAdminBotUIDs();
        if (!adminBotUIDs.includes(String(senderID))) {
            return api.sendMessage("⚠️ Bạn không có quyền sử dụng lệnh này. Chỉ Admin Bot mới được sử dụng!", threadID, messageID);
        }

        const botID = api.getCurrentUserID();
        const nickname = `『 ${prefix} 』• Bot láo loz`;

        // 2. Thu thập danh sách Thread IDs
        const threadIDs = new Set();

        // 2.1. Lấy từ cơ sở dữ liệu (nhóm đang thuê bot)
        try {
            const rentedGroups = await executeQuery(
                "SELECT DISTINCT thread_id FROM rented_groups WHERE expire_date > CURRENT_TIMESTAMP"
            );
            if (rentedGroups && rentedGroups.length > 0) {
                rentedGroups.forEach(g => {
                    if (g.thread_id) threadIDs.add(String(g.thread_id));
                });
            }
        } catch (err) {
            console.error("Lỗi khi truy vấn nhóm từ DB:", err);
        }

        // 2.2. Lấy từ getThreadList của Facebook (tối đa 100 nhóm gần đây)
        try {
            await new Promise((resolve) => {
                api.getThreadList(100, null, ["INBOX"], (err, list) => {
                    if (!err && list) {
                        list.forEach(t => {
                            if (t.isGroup && t.threadID) {
                                threadIDs.add(String(t.threadID));
                            }
                        });
                    }
                    resolve();
                });
            });
        } catch (err) {
            console.error("Lỗi khi lấy getThreadList:", err);
        }

        const listThreadIDs = Array.from(threadIDs);
        const total = listThreadIDs.length;

        if (total === 0) {
            return api.sendMessage("⚠️ Không tìm thấy nhóm nào để đặt lại biệt danh.", threadID, messageID);
        }

        await api.sendMessage(`🔄 Bắt đầu đặt lại biệt danh cho bot trong ${total} nhóm...`, threadID);

        let success = 0;
        let fail = 0;

        for (const targetThreadID of listThreadIDs) {
            try {
                await new Promise((resolve) => {
                    api.changeNickname(nickname, targetThreadID, botID, (err) => {
                        if (err) {
                            fail++;
                        } else {
                            success++;
                        }
                        resolve();
                    });
                });
            } catch (err) {
                fail++;
            }
            // Delay 800ms để tránh spam block của FB
            await new Promise((resolve) => setTimeout(resolve, 800));
        }

        return api.sendMessage(
            `📊 **KẾT QUẢ ĐẶT LẠI BIỆT DANH BOT**\n` +
            `━━━━━━━━━━━━━\n` +
            `• Tổng số nhóm đã xử lý: ${total}\n` +
            `• Đổi thành công: ${success}\n` +
            `• Thất bại: ${fail} (Có thể do bot thiếu quyền QTV hoặc FB chặn)`,
            threadID, messageID
        );
    }
};
