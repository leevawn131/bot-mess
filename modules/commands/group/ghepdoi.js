const { checkCooldown } = require('../../utils/cooldown');

module.exports = {
    name: "ghepdoi",
    description: "Ghép đôi (Hỗ trợ ghép 2 người cụ thể)",
    usage: "\n- !ghepdoi: Random\n- !ghepdoi tao: Tìm duyên\n- !ghepdoi @A @B: Ghép A với B",

    async execute({ api, event, args }) {
        const { threadID, senderID, mentions, messageReply } = event;

        // Cooldown 3s
        const cooldown = checkCooldown({ command: "ghepdoi", key: threadID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi ghép đôi tiếp!`, threadID);
        }

        try {
            // 1. Lấy danh sách thành viên
            const threadInfo = await api.getThreadInfo(threadID);
            const participants = threadInfo.userInfo;
            const botID = api.getCurrentUserID();

            // Lọc Bot ra
            let validMembers = participants.filter(p => p.id != botID);

            if (validMembers.length < 2) {
                return api.sendMessage("⚠️ Nhóm vắng quá, không đủ người để ghép!", threadID);
            }

            let person1 = null;
            let person2 = null;

            // Định nghĩa các biến
            const mentionIDs = Object.keys(mentions);
            const firstArg = args[0] ? args[0].toLowerCase() : "";
            const selfKeywords = ["tao", "tui", "tớ", "mình", "me", "em", "anh"];
            const isSelf = selfKeywords.includes(firstArg);

            // ====================================================
            // LOGIC CHỌN NGƯỜI
            // ====================================================

            // TRƯỜNG HỢP 1: TAG 2 NGƯỜI CỤ THỂ
            if (mentionIDs.length >= 2) {
                const id1 = mentionIDs[0];
                const id2 = mentionIDs[1];

                person1 = validMembers.find(p => p.id == id1);
                if (!person1) person1 = { id: id1, name: mentions[id1].replace("@", "") };

                person2 = validMembers.find(p => p.id == id2);
                if (!person2) person2 = { id: id2, name: mentions[id2].replace("@", "") };
            }

            // TRƯỜNG HỢP 2: TAO + TAG/REPLY
            else if (isSelf && (mentionIDs.length > 0 || messageReply)) {
                person1 = validMembers.find(p => p.id == senderID);
                if (!person1) person1 = { id: senderID, name: "Bạn" };

                let targetID = messageReply ? messageReply.senderID : mentionIDs[0];
                person2 = validMembers.find(p => p.id == targetID);
                if (!person2) {
                    const nameTag = mentions[targetID] || "Người ấy";
                    person2 = { id: targetID, name: nameTag.replace("@", "") };
                }
            }
            
            // CÁC TRƯỜNG HỢP CÒN LẠI
            else {
                let targetID1 = null;

                if (messageReply) targetID1 = messageReply.senderID;
                else if (mentionIDs.length > 0) targetID1 = mentionIDs[0];
                else if (isSelf) targetID1 = senderID;
                else if (args.length > 0) {
                    const searchName = args.join(" ").replace("@", "").trim().toLowerCase();
                    if (searchName) {
                        const match = validMembers.find(p => p.name && p.name.toLowerCase().includes(searchName));
                        if (match) targetID1 = match.id;
                    }
                }

                if (targetID1) {
                    person1 = validMembers.find(p => p.id == targetID1);
                    if (!person1) person1 = { id: targetID1, name: "Người ấy" };
                } else {
                    const index1 = Math.floor(Math.random() * validMembers.length);
                    person1 = validMembers[index1];
                }

                const remainingMembers = validMembers.filter(p => p.id != person1.id);
                if (remainingMembers.length === 0) {
                    return api.sendMessage(`⚠️ Không còn ai khác để ghép với ${person1.name}!`, threadID);
                }
                const index2 = Math.floor(Math.random() * remainingMembers.length);
                person2 = remainingMembers[index2];
            }

            // ====================================================
            // TÍNH TOÁN & HIỂN THỊ (FIXED MENTIONS)
            // ====================================================
            
            const matchRate = Math.floor(Math.random() * 101);
            
            const fullBar = "█";
            const emptyBar = "░";
            const totalBars = 10;
            const filledBars = Math.round((matchRate / 100) * totalBars);
            const progressBar = fullBar.repeat(filledBars) + emptyBar.repeat(totalBars - filledBars);

            let comment = "";
            if (matchRate < 20) comment = "💔 Thôi toang, không có hy vọng đâu.";
            else if (matchRate < 50) comment = "😐 Hơi nhạt, chắc chỉ làm bạn xã giao.";
            else if (matchRate < 80) comment = "❤️ Cũng ổn áp đấy, thử tìm hiểu xem.";
            else if (matchRate < 95) comment = "💕 Đẹp đôi vãi! Bot đẩy thuyền kèo này!";
            else comment = "💍 ĐỊNH MỆNH! Cưới gấp đi chờ chi nữa!";

            const senderInfo = validMembers.find(p => p.id == senderID);
            const senderName = senderInfo ? senderInfo.name : "Bạn";

            // === FIX: SỬ DỤNG PLACEHOLDER ĐỂ TAG CHÍNH XÁC ===
            const PERSON1_TAG = `@${person1.name}`;
            const PERSON2_TAG = `@${person2.name}`;

            let msgBody = "";

            if (person1.id == senderID) {
                msgBody = `💘 GÓC TÌM DUYÊN 💘\n` +
                          `─────────────────\n` +
                          `🔻 Kết quả:\n` +
                          `1️⃣ ${PERSON1_TAG} (Chính chủ)\n` +
                          `2️⃣ ${PERSON2_TAG} (Đối tượng)\n\n` +
                          `📊 Tỉ lệ hợp đôi: ${matchRate}%\n` +
                          `[${progressBar}]\n\n` +
                          `💬 Bot phán: ${comment}`;
            } 
            else {
                msgBody = `💍 GÓC MAI MỐI 💍\n` +
                          `👤 Ông mai/Bà mối: ${senderName}\n` +
                          `─────────────────\n` +
                          `🔻 Cặp đôi được ghép:\n` +
                          `1️⃣ ${PERSON1_TAG}\n` +
                          `2️⃣ ${PERSON2_TAG}\n\n` +
                          `📊 Tỉ lệ hợp đôi: ${matchRate}%\n` +
                          `[${progressBar}]\n\n` +
                          `💬 Bot phán: ${comment}`;
            }

            // === FIX: MENTIONS VỚI TAG CHÍNH XÁC (BAO GỒM @) ===
            const msg = {
                body: msgBody,
                mentions: [
                    { tag: PERSON1_TAG, id: person1.id },
                    { tag: PERSON2_TAG, id: person2.id }
                ]
            };

            return api.sendMessage(msg, threadID);

        } catch (e) {
            console.error(e);
            return api.sendMessage("❌ Lỗi hệ thống ghép đôi.", threadID);
        }
    }
};
