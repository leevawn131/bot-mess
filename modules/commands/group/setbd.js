const { ensureMentionsFromHistory } = require('../../utils/mentionResolver');
const prefix = process.env.BOT_PREFIX;

module.exports = {
    name: "setbd",
    description: "Đổi biệt danh",
    usage: `\n${prefix}setbd [tên mới] → Đổi biệt danh cho bản thân\n${prefix}setbd @tag [tên mới] → Đổi cho người được tag\n${prefix}setbd (reply) [tên mới] → Đổi cho người được reply\n━━━━━━━━━━━━━━━━━━\n📌 Tối đa 32 ký tự | Bỏ trống = xóa biệt danh\n⚠️ Bot cần quyền QTV nhóm\n🔒 Chỉ QTV mới được đổi cho người khác`,
    execute: async ({ api, event, args }) => {
        await ensureMentionsFromHistory(api, event);
        const { threadID, messageID, senderID, mentions, messageReply } = event;
        const botID = String(api.getCurrentUserID());
        const { checkCooldown } = require('../../utils/cooldown');
        const { getAdminBotUIDs, toAdminIdList } = require('../../utils/checkPermission');

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "setbd", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        // 0. CHECK HÀM THƯ VIỆN
        if (!api.changeNickname) {
            return api.sendMessage("❌ Lỗi: Thư viện chưa nạp hàm changeNickname (Xem lại bước sửa index.js).", threadID);
        }

        // 1. XÁC ĐỊNH MỤC TIÊU VÀ TÊN MỚI
        let targetID = senderID;
        let nickname = "";

        // Cách 1: Tag người dùng
        if (Object.keys(mentions).length > 0) {
            targetID = Object.keys(mentions)[0];
            const tag = mentions[targetID];
            const tagContent = tag.replace("@", "");
            const body = event.body || "";
            // Xử lý chuỗi để lấy phần biệt danh sạch sẽ (hỗ trợ mọi prefix dynamically)
            let temp = body.replace(/^.*?setbd/i, "");
            // Xóa phần tag (case-insensitive) của người dùng
            const escapedTagContent = tagContent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            temp = temp.replace(new RegExp("@?" + escapedTagContent, "i"), "");
            nickname = temp.trim();
        } 
        // Cách 2: Reply tin nhắn
        else if (messageReply) {
            targetID = messageReply.senderID;
            nickname = args.join(" ").trim();
        } 
        // Cách 3: Tự đổi cho mình
        else {
            if (args[0] && (args[0].toLowerCase() === "tao" || args[0].toLowerCase() === "me")) {
                nickname = args.slice(1).join(" ").trim();
            } else {
                nickname = args.join(" ").trim();
            }
        }

        // Validate độ dài
        if (nickname.length > 32) {
            return api.sendMessage("⚠️ Biệt danh quá dài (tối đa 32 ký tự).", threadID);
        }

        // 2. LẤY THÔNG TIN QUYỀN HẠN TRONG NHÓM
        const { getThreadInfoCached } = require('../../utils/threadInfo');
        let threadInfo;
        try {
            threadInfo = await getThreadInfoCached(api, threadID);
        } catch (e) {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm để kiểm tra quyền.", threadID);
        }

        if (!threadInfo || typeof threadInfo !== 'object') {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm để kiểm tra quyền.", threadID);
        }

        const adminIDs = toAdminIdList(threadInfo); // Danh sách ID Quản trị viên
        const isBotAdmin = adminIDs.includes(botID);              // Bot có phải Admin không?
        const isSenderAdmin = adminIDs.includes(String(senderID)); // Người dùng lệnh có phải Admin không?
        const adminBotUIDs = getAdminBotUIDs();
        const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

        // 3. KIỂM TRA QUYỀN (LOGIC BẢO MẬT)

        // Rule 1: Bot bắt buộc phải là Admin mới đổi được tên (để tránh lỗi permission)
        if (!isBotAdmin) {
            return api.sendMessage("🚫 Bot cần quyền Quản trị viên nhóm để thực hiện lệnh này.", threadID);
        }

        // Rule 2: Nếu đổi tên cho NGƯỜI KHÁC, người dùng lệnh phải là Admin hoặc chủ bot
        if (String(targetID) !== String(senderID)) {
            if (!isSenderAdmin && !isSenderBotAdmin) {
                return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc chủ bot mới được đổi biệt danh cho người khác!", threadID);
            }
        }

        // 4. THỰC THI (NẾU ĐỦ QUYỀN)
        try {
            // Dùng await để đảm bảo đồng bộ
            await api.changeNickname(nickname, threadID, targetID, (err) => {
                if (err) {
                    console.error("Lỗi đổi tên:", err);
                    return api.sendMessage("❌ Không thể đổi tên (Có thể do mạng hoặc lỗi Facebook).", threadID);
                }
                api.sendMessage(`✅ Đã cập nhật biệt danh thành công!`, threadID);
            });
        } catch (e) {
            console.error("Crash tại setbd:", e);
            api.sendMessage("❌ Đã xảy ra lỗi khi gọi hàm đổi tên.", threadID);
        }
    }
};