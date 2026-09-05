const { ensureMentionsFromHistory } = require('../../utils/mentionResolver');
const { getThreadPrefix, setThreadPrefix, removeThreadPrefix } = require('../../utils/threadPrefixStorage');
const prefix = process.env.BOT_PREFIX || "!";

module.exports = {
    name: "setbd",
    description: "Đổi biệt danh & Cài đặt ký tự riêng cho nhóm",
    usage: `\n${prefix}setbd [tên mới] → Đổi biệt danh cho bản thân\n${prefix}setbd @tag [tên mới] → Đổi cho người được tag\n${prefix}setbd (reply) [tên mới] → Đổi cho người được reply\n${prefix}setbd setkitu [ký tự] → Cài ký tự biệt danh riêng cho nhóm (VD: SK- hoặc SK.)\n${prefix}setbd setkitu off → Xóa ký tự biệt danh riêng của nhóm\n━━━━━━━━━━━━━\n📌 Tối đa 64 ký tự | Bỏ trống = xóa biệt danh\n⚠️ Bot cần quyền QTV nhóm\n🔒 Chỉ QTV mới được đổi cho người khác hoặc cài setkitu`,
    execute: async ({ api, event, args, config }) => {
        await ensureMentionsFromHistory(api, event);
        const { threadID, messageID, senderID, mentions, messageReply } = event;
        const botID = String(api.getCurrentUserID());
        const { checkCooldown } = require('../../utils/cooldown');
        const { getAdminBotUIDs, toAdminIdList } = require('../../utils/checkPermission');
        const { getThreadInfoCached } = require('../../utils/threadInfo');

        const cmdPrefix = config?.prefix || prefix;

        // Cooldown 10s
        const cooldown = checkCooldown({ command: "setbd", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        // 0. CHECK HÀM THƯ VIỆN
        if (!api.changeNickname) {
            return api.sendMessage("❌ Lỗi: Thư viện chưa nạp hàm changeNickname.", threadID);
        }

        // 1. XỬ LÝ CÚ PHÁP SETKITU / KITU
        const firstArg = args[0] ? args[0].toLowerCase() : "";
        if (firstArg === "setkitu" || firstArg === "kitu") {
            // Lấy thông tin quyền hạn nhóm
            let threadInfo;
            try {
                threadInfo = await getThreadInfoCached(api, threadID);
            } catch (e) {
                return api.sendMessage("❌ Không thể lấy thông tin nhóm để kiểm tra quyền.", threadID, messageID);
            }

            if (!threadInfo || typeof threadInfo !== 'object') {
                return api.sendMessage("❌ Không thể lấy thông tin nhóm để kiểm tra quyền.", threadID, messageID);
            }

            const adminIDs = toAdminIdList(threadInfo);
            const isSenderAdmin = adminIDs.includes(String(senderID));
            const adminBotUIDs = getAdminBotUIDs();
            const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

            if (!isSenderAdmin && !isSenderBotAdmin) {
                return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc Admin Bot mới có quyền cài đặt ký tự biệt danh!", threadID, messageID);
            }

            const body = event.body || "";
            const match = body.match(/^.*?setbd\s+(?:setkitu|kitu)(?:\s+([\s\S]+))?$/i);
            const inputSymbol = match && match[1] !== undefined ? match[1] : args.slice(1).join(" ");
            const trimmedSymbol = inputSymbol ? inputSymbol.trim() : "";

            // Kiểm tra nếu không nhập gì hoặc nhập check/info
            if (!trimmedSymbol || trimmedSymbol.toLowerCase() === "check" || trimmedSymbol.toLowerCase() === "info") {
                const currentPrefix = await getThreadPrefix(threadID);
                if (currentPrefix) {
                    return api.sendMessage(`📌 Ký tự biệt danh hiện tại của nhóm: "${currentPrefix}"\n━━━━━━━━━━━━━\n👉 Cách dùng:\n• ${cmdPrefix}setbd setkitu [ký tự] → Cài ký tự mới cho nhóm (VD: ${cmdPrefix}setbd setkitu SK-)\n• ${cmdPrefix}setbd setkitu off → Xóa ký tự biệt danh của nhóm`, threadID, messageID);
                } else {
                    return api.sendMessage(`📌 Nhóm chưa cài đặt ký tự biệt danh riêng.\n━━━━━━━━━━━━━\n👉 Cách dùng:\n• ${cmdPrefix}setbd setkitu [ký tự] → Cài ký tự mới cho nhóm (VD: ${cmdPrefix}setbd setkitu SK- hoặc SK.)\n• ${cmdPrefix}setbd setkitu off → Xóa ký tự biệt danh của nhóm`, threadID, messageID);
                }
            }

            // Xóa ký tự biệt danh nhóm
            if (["off", "del", "delete", "xoa", "reset", "clear", "none"].includes(trimmedSymbol.toLowerCase())) {
                await removeThreadPrefix(threadID);
                return api.sendMessage("✅ Đã xóa ký tự biệt danh riêng của nhóm!", threadID, messageID);
            }

            // Cài đặt ký tự mới
            if (inputSymbol.length > 20) {
                return api.sendMessage("⚠️ Ký tự biệt danh quá dài (tối đa 20 ký tự).", threadID, messageID);
            }

            await setThreadPrefix(threadID, inputSymbol, senderID);
            return api.sendMessage(`✅ Đã cài đặt ký tự biệt danh riêng cho nhóm là: "${inputSymbol}"\n👉 Từ giờ khi dùng lệnh setbd [tên], bot sẽ tự động thêm "${inputSymbol}" phía trước (ví dụ: ${inputSymbol}Tên).`, threadID, messageID);
        }

        // 2. XÁC ĐỊNH MỤC TIÊU VÀ TÊN MỚI
        let targetID = senderID;
        let nickname = "";

        // Cách 1: Tag người dùng
        if (Object.keys(mentions).length > 0) {
            targetID = Object.keys(mentions)[0];
            const tag = mentions[targetID];
            const tagContent = tag.replace("@", "");
            const body = event.body || "";
            let temp = body.replace(/^.*?setbd/i, "");
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

        if (String(targetID) === botID) {
            return api.sendMessage("⚠️ Bạn không được tự ý đổi biệt danh của Bot! Vui lòng sử dụng lệnh setnamebot để thay đổi.", threadID, messageID);
        }

        // 3. TỰ ĐỘNG GHÉP KÝ TỰ BIỆT DANH RIÊNG CỦA NHÓM (NẾU CÓ)
        const groupPrefix = await getThreadPrefix(threadID);
        if (nickname && groupPrefix) {
            if (!nickname.startsWith(groupPrefix)) {
                nickname = groupPrefix + nickname;
            }
        }

        // Validate độ dài biệt danh (FB tối đa 64 ký tự)
        if (nickname.length > 64) {
            const note = groupPrefix ? ` (bao gồm cả ký tự nhóm "${groupPrefix}")` : "";
            return api.sendMessage(`⚠️ Biệt danh quá dài (tối đa 64 ký tự${note}).`, threadID);
        }

        // 4. LẤY THÔNG TIN QUYỀN HẠN TRONG NHÓM
        let threadInfo;
        try {
            threadInfo = await getThreadInfoCached(api, threadID);
        } catch (e) {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm để kiểm tra quyền.", threadID);
        }

        if (!threadInfo || typeof threadInfo !== 'object') {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm để kiểm tra quyền.", threadID);
        }

        const adminIDs = toAdminIdList(threadInfo);
        const isBotAdmin = adminIDs.includes(botID);
        const isSenderAdmin = adminIDs.includes(String(senderID));
        const adminBotUIDs = getAdminBotUIDs();
        const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

        // 5. KIỂM TRA QUYỀN (LOGIC BẢO MẬT)
        if (!isBotAdmin) {
            return api.sendMessage("🚫 Bot cần quyền Quản trị viên nhóm để thực hiện lệnh này.", threadID);
        }

        if (String(targetID) !== String(senderID)) {
            if (!isSenderAdmin && !isSenderBotAdmin) {
                return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc chủ bot mới được đổi biệt danh cho người khác!", threadID);
            }
        }

        // 6. THỰC THI
        try {
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