const { checkCooldown } = require('../../utils/cooldown');
const { ADMIN_BOT_UIDS } = require('../../utils/checkPermission');

module.exports = {
    name: "kick",
    description: "Kick thành viên (Có check quyền QTV)",
    usage: "[tag] | [reply]",
    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID, mentions } = event;

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "kick", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            // 1. Xác định danh sách ID cần kick
            let targetIDs = [];
            if (Object.keys(mentions).length > 0) {
                targetIDs = Object.keys(mentions);
            } else if (event.type === "message_reply") {
                targetIDs = [event.messageReply.senderID];
            } else if (args[0] && !isNaN(args[0])) {
                targetIDs = [args[0]];
            }

            if (targetIDs.length === 0) return api.sendMessage("❌ Vui lòng Tag hoặc Reply người cần kick.", threadID, messageID);

            // 2. Lấy thông tin nhóm và danh sách Admin
            const threadInfo = await api.getThreadInfo(threadID);
            const adminIDs = (threadInfo.adminIDs || []).map(i => String(i.id));
            const botID = String(api.getCurrentUserID());
            const isSenderAdmin = adminIDs.includes(String(senderID));
            const isSenderBotAdmin = ADMIN_BOT_UIDS.includes(String(senderID));

            // --- KIỂM TRA QUYỀN HẠN ---

            // A. Kiểm tra quyền của NGƯỜI DÙNG LỆNH (Sender)
            if (!isSenderAdmin && !isSenderBotAdmin) {
                return api.sendMessage("⚠️ Chỉ QTV nhóm hoặc chủ bot mới được dùng lệnh kick!", threadID, messageID);
            }

            // B. Kiểm tra quyền của BOT
            if (!adminIDs.includes(botID)) {
                return api.sendMessage("❌ Bot cần quyền Quản Trị Viên để thực hiện lệnh này!", threadID, messageID);
            }

            // ---------------------------

            // 3. Hàm Kick
            const kickUser = async (uid, tid) => {
                try {
                    // Ưu tiên dùng hàm chuẩn của thư viện
                    if (api.removeUserFromGroup) {
                        await api.removeUserFromGroup(uid, tid);
                    } 
                    // Fallback cho thư viện cũ
                    else if (api.removeParticipant) {
                        await api.removeParticipant(uid, tid);
                    } 
                    // Fallback cuối cùng: Gọi HTTP thủ công (nếu thư viện nát quá)
                    else {
                        throw new Error("Library missing remove function");
                    }
                } catch (e) {
                    throw e;
                }
            };

            // 4. Thực thi - Kick tất cả những người được tag
            let successCount = 0;
            let skipCount = 0;
            
            for (const targetID of targetIDs) {
                // Kiểm tra không kick Admin
                if (adminIDs.includes(String(targetID))) {
                    skipCount++;
                    continue;
                }
                
                // Không kick bot
                if (String(targetID) === botID) {
                    skipCount++;
                    continue;
                }
                
                try {
                    await kickUser(targetID, threadID);
                    successCount++;
                    await new Promise(r => setTimeout(r, 300));
                } catch (e) {
                    console.error(`Failed to kick ${targetID}:`, e);
                }
            }
            
            if (successCount > 0) {
                let msg = `✅ Đã kick ${successCount} thành viên.`;
                if (skipCount > 0) msg += `\n(⏭️ Bỏ qua ${skipCount} Admin/Bot)`;
                api.sendMessage(msg, threadID, messageID);
            } else if (skipCount > 0) {
                api.sendMessage(`🛡️ Không thể kick vì tất cả đều là Admin hoặc Bot.`, threadID, messageID);
            }

        } catch (e) {
            console.error(e);
            api.sendMessage("❌ Lỗi: Không thể kick thành viên này. (Có thể do lỗi thư viện hoặc Bot bị chặn)", threadID, messageID);
        }
    }
};