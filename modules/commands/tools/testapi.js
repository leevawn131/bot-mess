module.exports = {
  name: "testapi",
  description: "Test API getThreadInfo và getThreadHistory",
  usage: "\n!testapi → Test API xem có hoạt động không và trả về các trường dữ liệu nào",
  execute: async ({ api, event }) => {
    const { threadID, messageID } = event;
    try {
      api.sendMessage("⏳ Đang gọi api.getThreadInfo...", threadID, messageID);
      
      // Test getThreadInfo
      const threadInfo = await api.getThreadInfo(threadID);
      const infoKeys = Object.keys(threadInfo);
      
      api.sendMessage("⏳ Đang gọi api.getThreadHistory...", threadID, messageID);
      
      // Test getThreadHistory
      const history = await api.getThreadHistory(threadID, 5);
      const historyLength = history.length;
      
      let msg = `✅ **KẾT QUẢ KIỂM TRA API**\n\n`;
      msg += `1️⃣ **api.getThreadInfo**: HOẠT ĐỘNG!\n`;
      msg += `   - Số lượng trường dữ liệu: ${infoKeys.length}\n`;
      msg += `   - Tên nhóm/luồng: ${threadInfo.threadName || "Trò chuyện cá nhân"}\n`;
      msg += `   - Số thành viên: ${threadInfo.participantIDs ? threadInfo.participantIDs.length : 0}\n`;
      msg += `   - Các trường lấy được:\n     \`${infoKeys.join(", ")}\`\n\n`;
      
      msg += `2️⃣ **api.getThreadHistory**: HOẠT ĐỘNG!\n`;
      msg += `   - Lấy được: ${historyLength} tin nhắn/sự kiện gần nhất\n`;
      if (historyLength > 0) {
        const lastMsg = history[historyLength - 1];
        const lastMsgKeys = Object.keys(lastMsg);
        msg += `   - Số lượng trường dữ liệu của tin nhắn: ${lastMsgKeys.length}\n`;
        msg += `   - Các trường lấy được:\n     \`${lastMsgKeys.join(", ")}\`\n`;
        msg += `   - Chi tiết tin nhắn cuối cùng:\n`;
        msg += `     + Loại: ${lastMsg.type}\n`;
        msg += `     + Người gửi ID: ${lastMsg.senderID || "N/A"}\n`;
        msg += `     + Nội dung: "${lastMsg.body || "[Không có văn bản]"}"\n`;
        msg += `     + Thời gian: ${new Date(Number(lastMsg.timestamp)).toLocaleString()}\n`;
      }
      
      return api.sendMessage(msg, threadID, messageID);
    } catch (e) {
      console.error("[testapi] Error:", e);
      return api.sendMessage(`❌ Lỗi khi gọi API: ${e.message || JSON.stringify(e)}`, threadID, messageID);
    }
  }
};
