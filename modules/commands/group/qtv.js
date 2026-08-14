const { checkCooldown } = require('../../utils/cooldown');
const { toAdminIdList, getAdminBotUIDs } = require('../../utils/checkPermission');
const { getThreadInfoCached, clearThreadInfoCache, syncThreadAdminRealtime } = require('../../utils/threadInfo');
const { ensureMentionsFromHistory } = require('../../utils/mentionResolver');
const prefix = process.env.BOT_PREFIX;

module.exports = {
    name: "qtv",
    description: "Xem/Thêm/Xóa Quản trị viên nhóm",
    usage: `\n${prefix}qtv → Xem danh sách QTV của nhóm hiện tại\n${prefix}qtv add [reply / @tag / UID] → Thêm quản trị viên\n${prefix}qtv delete [reply / @tag / UID] → Gỡ quản trị viên\n━━━━━━━━━━━━━\n🛡️ Yêu cầu Bot và người dùng có quyền QTV nhóm`,
    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "qtv", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            // 1. Lấy thông tin nhóm (Tự động sync 1 lần từ FB khi bot mới restart, các lần sau đọc siêu tốc từ Database)
            const threadInfo = await getThreadInfoCached(api, threadID);
            
            if (!threadInfo || typeof threadInfo !== 'object' || !threadInfo.isGroup) {
                return api.sendMessage("⚠️ Không thể lấy thông tin nhóm hoặc lệnh này chỉ dùng trong nhóm chat.", threadID, messageID);
            }

            const adminIDs = toAdminIdList(threadInfo);
            const action = args[0] ? args[0].toLowerCase() : null;

            // Nếu không phải là add/delete, hiển thị danh sách QTV (Hành vi cũ)
            if (action !== "add" && action !== "delete") {
                const memberInfo = threadInfo.userInfo || [];
                let msg = `🛡️ DANH SÁCH QUẢN TRỊ VIÊN (${adminIDs.length})\n━━━━━━━━━━━━━\n`;
                
                adminIDs.forEach((id, index) => {
                    const user = memberInfo.find(u => String(u.id) === id);
                    const name = user?.name || global.data?.userName?.get(id) || `ID: ${id}`;
                    msg += `${index + 1}. ${name}\n`;
                });

                return api.sendMessage(msg, threadID, messageID);
            }

            // --- XỬ LÝ LỆNH THÊM / GỠ QUẢN TRỊ VIÊN ---
            
            // 1. Kiểm tra quyền của người dùng (QTV nhóm hoặc chủ bot)
            const botID = String(api.getCurrentUserID());
            const isSenderAdmin = adminIDs.includes(String(senderID));
            const adminBotUIDs = getAdminBotUIDs();
            const isSenderBotAdmin = Array.isArray(adminBotUIDs)
                ? adminBotUIDs.includes(String(senderID))
                : false;

            if (!isSenderAdmin && !isSenderBotAdmin) {
                return api.sendMessage(
                    "⚠️ Chỉ QTV nhóm hoặc chủ bot mới có quyền thực hiện thao tác này!",
                    threadID,
                    messageID
                );
            }

            // 2. Kiểm tra quyền của Bot (Bot cần là QTV nhóm)
            if (!adminIDs.includes(botID)) {
                return api.sendMessage(
                    "❌ Bot cần quyền Quản Trị Viên của nhóm để thực hiện lệnh này!",
                    threadID,
                    messageID
                );
            }

            // 3. Phân giải tag / tin nhắn nếu có
            await ensureMentionsFromHistory(api, event);
            
            let targetIDs = [];
            
            // Lấy từ tag/mention
            if (event.mentions && Object.keys(event.mentions).length > 0) {
                targetIDs = Object.keys(event.mentions);
            } 
            // Lấy từ reply tin nhắn
            else if (event.type === "message_reply") {
                targetIDs = [event.messageReply.senderID];
            } 
            // Lấy từ arguments (UID hoặc tên)
            else if (args.length > 1) {
                // Kiểm tra UIDs dạng số
                const uids = args.slice(1).filter(arg => /^\d+$/.test(arg));
                if (uids.length > 0) {
                    targetIDs = [...uids];
                } else {
                    // Tìm theo tên
                    const searchStr = args.slice(1).join(" ").replace(/@/g, "").trim().toLowerCase();
                    const matchedUsers = (threadInfo.userInfo || []).filter(
                        (u) => u.name && u.name.toLowerCase() === searchStr
                    );
                    
                    if (matchedUsers.length === 1) {
                        targetIDs = [String(matchedUsers[0].id)];
                    } else if (matchedUsers.length > 1) {
                        return api.sendMessage(
                            `❌ Có ${matchedUsers.length} thành viên trùng tên "${searchStr}". Bot từ chối thực hiện để tránh nhầm lẫn.\n📌 Vui lòng Reply tin nhắn hoặc nhập ID của người cần thao tác.`,
                            threadID,
                            messageID
                        );
                    }
                }
            }

            if (targetIDs.length === 0) {
                return api.sendMessage(
                    `❌ Vui lòng Tag, Reply hoặc nhập đúng ID/tên người cần ${action === 'add' ? 'thêm vào' : 'gỡ khỏi'} Ban Quản Trị.`,
                    threadID,
                    messageID
                );
            }

            // Lọc danh sách hợp lệ tránh thao tác thừa
            const isAdminStatus = (action === "add");
            const filterIDs = targetIDs.filter(id => isAdminStatus ? !adminIDs.includes(id) : adminIDs.includes(id));

            if (filterIDs.length === 0) {
                return api.sendMessage(
                    isAdminStatus
                        ? "❌ Các thành viên được chọn đều đã là Quản trị viên nhóm."
                        : "❌ Các thành viên được chọn đều không phải là Quản trị viên nhóm.",
                    threadID,
                    messageID
                );
            }

            // Gọi API thay đổi chức vụ
            try {
                await api.changeAdminStatus(threadID, filterIDs, isAdminStatus);
                
                // Cập nhật ngay lập tức vào SQLite Database và RAM cache
                for (const id of filterIDs) {
                    syncThreadAdminRealtime(threadID, id, isAdminStatus ? "add_admin" : "remove_admin").catch(() => {});
                }
                
                const updatedNames = filterIDs.map(id => {
                    const u = (threadInfo.userInfo || []).find(user => String(user.id) === id);
                    return u ? u.name : (global.data?.userName?.get(id) || id);
                });

                return api.sendMessage(
                    isAdminStatus
                        ? `✅ Đã thêm quyền Quản trị viên cho: ${updatedNames.join(", ")}`
                        : `✅ Đã gỡ quyền Quản trị viên của: ${updatedNames.join(", ")}`,
                    threadID,
                    messageID
                );
            } catch (err) {
                console.error("Lỗi thay đổi quyền QTV:", err);
                return api.sendMessage(
                    `❌ Thay đổi quyền thất bại.\n⚠️ Lỗi: ${err.error || err.message || JSON.stringify(err)}`,
                    threadID,
                    messageID
                );
            }

        } catch (e) {
            console.error("Lỗi lệnh qtv:", e);
            return api.sendMessage("❌ Lỗi: Không thể xử lý yêu cầu.", threadID, messageID);
        }
    }
};