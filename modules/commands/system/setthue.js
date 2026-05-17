const { execute } = require("../../utils/database");

module.exports = {
  name: "setthue",
  description: "Thêm nhóm đã thuê thủ công (Chỉ Admin)",
  usage: "\n!setthue [số_tháng] → Gia hạn cho nhóm hiện tại\n!setthue [threadID] [số_tháng] → Gia hạn cho nhóm khác\n━━━━━━━━━━━━━━━━━━\n📌 Đơn vị: số + m (tháng) hoặc số + d (ngày)\n🔒 Chỉ Admin bot mới dùng được\n💡 Ví dụ: !setthue 3m hoặc !setthue 7d",
  
  async execute({ api, event, args, config }) {
    // 1. Kiểm tra quyền Admin
    const isAdmin = config.adminIDs && config.adminIDs.includes(event.senderID);
    if (!isAdmin) {
      return api.sendMessage("❌ Lệnh này chỉ dành cho Admin của Bot!", event.threadID);
    }

    // 2. Kiểm tra cú pháp
    if (args.length === 0) {
      return api.sendMessage(
        "❌ Sai cú pháp!\n" +
        "Sử dụng: !setthue [số tháng] (để gia hạn cho nhóm hiện tại)\n" +
        "Hoặc: !setthue [threadID] [số tháng] (để gia hạn cho nhóm khác)", 
        event.threadID
      );
    }

    let targetThreadID = String(event.threadID);
    let timeInput = "1m";

    if (args.length === 1) {
      // !setthue [thời gian]
      timeInput = String(args[0]).toLowerCase();
    } else {
      // !setthue [threadID] [thời gian]
      targetThreadID = String(args[0]);
      timeInput = String(args[1]).toLowerCase();
    }

    let daysToAdd = 30;
    let timeStr = "";

    // Phân tích thời gian (hỗ trợ 'd' cho ngày, 'm' cho tháng)
    if (timeInput.endsWith('d')) {
      const days = parseInt(timeInput.replace('d', ''));
      if (isNaN(days) || days <= 0) return api.sendMessage("❌ Số ngày không hợp lệ.", event.threadID);
      daysToAdd = days;
      timeStr = `${days} ngày`;
    } else {
      // Mặc định là tháng nếu không có chữ d, hoặc có chữ m
      const months = parseInt(timeInput.replace('m', ''));
      if (isNaN(months) || months <= 0) return api.sendMessage("❌ Số tháng không hợp lệ.", event.threadID);
      daysToAdd = months * 30;
      timeStr = `${months} tháng (${daysToAdd} ngày)`;
    }

    try {
      // 3. Cập nhật Database
      await execute(`
        INSERT INTO rented_groups (thread_id, expire_date)
        VALUES (?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY))
        ON DUPLICATE KEY UPDATE expire_date = DATE_ADD(expire_date, INTERVAL ? DAY)
      `, [targetThreadID, daysToAdd, daysToAdd]);

      // 4. Lấy thời hạn mới để hiển thị
      const info = await execute(
        "SELECT expire_date FROM rented_groups WHERE thread_id = ?",
        [targetThreadID]
      );
      
      let expireStr = "Không xác định";
      if (info && info.length > 0) {
        // Format ngày tháng chuẩn VN
        const date = new Date(info[0].expire_date);
        expireStr = date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      }

      api.sendMessage(
        `✅ Đã cộng thêm thời gian sử dụng cho nhóm:\n` +
        `🆔 ID: ${targetThreadID}\n` +
        `⏱️ Thời gian cộng: ${timeStr}\n` +
        `⏰ Hạn sử dụng mới: ${expireStr}`,
        event.threadID
      );

      // Nếu thêm nhóm hiện tại, gửi luôn thông báo vô nhóm
      if (targetThreadID === String(event.threadID)) {
        api.sendMessage(
          `🎉 Chúc mừng! Nhóm đã được Admin kích hoạt thủ công thêm ${timeStr} sử dụng Bot.\n` +
          `Các lệnh giải trí/tiện ích đã được mở khóa!`,
          event.threadID
        );
      } else {
        // Gửi thông báo đến nhóm mục tiêu
        api.sendMessage(
          `🎉 Chúc mừng! Nhóm bạn đã được Admin kích hoạt thủ công thêm ${timeStr} sử dụng Bot.\n` +
          `Các lệnh giải trí/tiện ích đã được mở khóa!`,
          targetThreadID
        ).catch(e => console.error("Không thể gửi tin nhắn đến nhóm:", targetThreadID));
      }

    } catch (error) {
      console.error("Lỗi khi setthue thủ công:", error);
      api.sendMessage("❌ Lỗi CSDL khi thêm ngày thuê nhóm.", event.threadID);
    }
  }
};
