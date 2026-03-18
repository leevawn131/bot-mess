const { removeLeaveHistoryEntries } = require("../utils/leaveHistory");

module.exports = {
    name: "welcome",
    eventType: ["log:subscribe"], // Sự kiện thêm người vào nhóm
    
    execute: async ({ api, event }) => {
        const { threadID } = event;
        
        // 1. Nếu người được thêm là chính con BOT
        if (event.logMessageData.addedParticipants.some(i => i.userFbId == api.getCurrentUserID())) {
            return api.sendMessage("Kết nối thành công! Chào cả nhà nhé 🤖\nDùng !help để biết danh sách lệnh", threadID);
        }

        try {
            // 2. Lấy danh sách toàn bộ người mới
            const newParticipants = event.logMessageData.addedParticipants;
            const joinedUIDs = newParticipants
                .map(user => String(user.userFbId || "").trim())
                .filter(Boolean);

            if (joinedUIDs.length > 0) {
                removeLeaveHistoryEntries(threadID, joinedUIDs);
            }
            
            // Lấy ra mảng tên: ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C", ...]
            const namesArray = newParticipants.map(user => user.fullName);

            // Nối tất cả tên lại bằng dấu phẩy
            const listNames = namesArray.join(", ");

            // 3. Gửi tin nhắn
            api.sendMessage(`Chào mừng ${listNames} đã tham gia nhóm! 🥳`, threadID);

        } catch (e) {
            console.log("Lỗi tại event welcome: ", e);
        }
    }
};