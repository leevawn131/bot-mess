module.exports = {
    name: "leave",
    eventType: ["log:unsubscribe"],
    
    execute: async ({ api, event }) => {
        try {
            const { threadID, logMessageBody, logMessageData, author } = event;
            const leftID = logMessageData.leftParticipantFbId;
            const botID = api.getCurrentUserID();

            if (leftID == botID) return;

            // --- LOGIC TÁCH TÊN (DÙNG LAST INDEX OF) ---
            let name = "Thành viên";
            
            if (logMessageBody) {
                // TRƯỜNG HỢP 1: BỊ KICK ("...đã xóa [TÊN] khỏi nhóm")
                // Logic: Tìm chữ "đã xóa" CUỐI CÙNG trong câu
                if (logMessageBody.includes("đã xóa") && logMessageBody.includes("khỏi nhóm")) {
                    const actionPhrase = "đã xóa ";
                    const endPhrase = " khỏi nhóm";
                    
                    // Tìm vị trí của chữ "đã xóa" cuối cùng (Tránh tên Admin troll)
                    const lastActionIndex = logMessageBody.lastIndexOf(actionPhrase);
                    
                    if (lastActionIndex !== -1) {
                        // Cắt từ sau chữ "đã xóa" đến trước chữ "khỏi nhóm"
                        // logMessageBody.indexOf(endPhrase, lastActionIndex): Tìm chữ "khỏi nhóm" nằm SAU chữ "đã xóa" vừa tìm được
                        const startIndex = lastActionIndex + actionPhrase.length;
                        const endIndex = logMessageBody.indexOf(endPhrase, startIndex);
                        
                        if (endIndex !== -1) {
                            name = logMessageBody.substring(startIndex, endIndex).trim();
                        }
                    }
                }
                
                // TRƯỜNG HỢP 2: TỰ OUT ("[TÊN] đã rời nhóm")
                // Logic: Lấy toàn bộ phần trước chữ "đã rời nhóm" cuối cùng
                else if (logMessageBody.includes("đã rời nhóm")) {
                    const endPhrase = " đã rời nhóm";
                    const lastEndIndex = logMessageBody.lastIndexOf(endPhrase);
                    
                    if (lastEndIndex !== -1) {
                        name = logMessageBody.substring(0, lastEndIndex).trim();
                    }
                }
            }

            // Fallback: Nếu cắt chuỗi lỗi (do ngôn ngữ khác) thì mới gọi API
            if (name === "Thành viên" || name === "") {
                try {
                    const info = await api.getUserInfo(leftID);
                    if (info[leftID]?.name) name = info[leftID].name;
                } catch (e) {}
            }

            // --- VĂN MẪU BỰA (Như cũ) ---
            const kickMessages = [
                "🚑 {name} đã bị sút ra chuồng gà. Thượng lộ bình an!",
                "🌪️ Gió đưa cành trúc la đà, {name} đi bụi cả nhà đều vui.",
                "👋 {name} đã bị đá đít khỏi vũ trụ này. Không tiễn!",
                "🐧 {name} đã bay màu. Chúc bạn may mắn ở server khác!",
                "🚪 Cửa ở kia, {name} lượn đi cho nước nó trong!",
                "⚰️ R.I.P {name}. Thành kính phân ưu."
            ];

            const leaveMessages = [
                "🏃 {name} đã bỏ của chạy lấy người.",
                "🍃 Gió đã cuốn {name} đi xa...",
                "👋 {name} đã tự rời nhóm. Tạm biệt nhé!",
                "👻 {name} đã lẳng lặng rời đi như một bóng ma."
            ];

            let msg = "";
            if (author != leftID) {
                const random = kickMessages[Math.floor(Math.random() * kickMessages.length)];
                msg = random.replace("{name}", name);
            } else {
                const random = leaveMessages[Math.floor(Math.random() * leaveMessages.length)];
                msg = random.replace("{name}", name);
            }

            return api.sendMessage(msg, threadID);

        } catch (e) {
            console.error("Lỗi event leave:", e);
        }
    }
};