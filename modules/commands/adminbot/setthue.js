const { execute } = require("../../utils/database");
const { ensureRentedGroupsSchema } = require("../../utils/rentalSchema");

module.exports = {
  name: "setthue",
  description: "Thêm nhóm đã thuê thủ công (Chỉ Admin)",
  usage: "\n!setthue [số_tháng] → Gia hạn gói thường cho nhóm hiện tại\n!setthue [thuong|admin] [số_tháng] → Gia hạn gói thường/admin cho nhóm hiện tại\n!setthue [threadID] [thuong|admin] [số_tháng] → Gia hạn cho nhóm khác\n━━━━━━━━━━━━━\n📌 Đơn vị: số + m (tháng) hoặc số + d (ngày)\n🔒 Chỉ Admin bot mới dùng được\n💡 Ví dụ: !setthue admin 3m hoặc !setthue 123456789 admin 7d",
  
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
        "Sử dụng: !setthue [thuong|admin] [số tháng] (để gia hạn cho nhóm hiện tại)\n" +
        "Hoặc: !setthue [threadID] [thuong|admin] [số tháng] (để gia hạn cho nhóm khác)", 
        event.threadID
      );
    }

    let targetThreadID = String(event.threadID);
    let packageType = "thuong"; // mặc định
    let timeInput = "1m";

    const packageTypes = ["thuong", "normal", "admin", "adm"];

    if (args.length === 1) {
      // !setthue [thời gian]
      timeInput = String(args[0]).toLowerCase();
    } else if (args.length === 2) {
      // A. !setthue [thuong/admin] [thời gian]
      // B. !setthue [threadID] [thời gian]
      const arg0 = String(args[0]).toLowerCase();
      if (packageTypes.includes(arg0)) {
        packageType = arg0;
        timeInput = String(args[1]).toLowerCase();
      } else {
        targetThreadID = String(args[0]);
        timeInput = String(args[1]).toLowerCase();
      }
    } else if (args.length >= 3) {
      // !setthue [threadID] [thuong/admin] [thời gian]
      targetThreadID = String(args[0]);
      packageType = String(args[1]).toLowerCase();
      timeInput = String(args[2]).toLowerCase();
    }

    const isAdminPlan = ["admin", "adm"].includes(packageType);
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
      await ensureRentedGroupsSchema();

      // 3. Cập nhật Database
      await execute(`
        INSERT INTO rented_groups (thread_id, expire_date, renter_id, rented_at, is_admin_rental)
        VALUES (?, datetime('now', '+' || ? || ' day'), ?, datetime('now'), ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          expire_date = datetime(max(coalesce(expire_date, datetime('now')), datetime('now')), '+' || ? || ' day'),
          renter_id = ?,
          rented_at = datetime('now'),
          is_admin_rental = ?
      `, [targetThreadID, daysToAdd, String(event.senderID), isAdminPlan ? 1 : 0, daysToAdd, String(event.senderID), isAdminPlan ? 1 : 0]);

      try {
        const { clearRentalCache } = require("../../utils/rental");
        clearRentalCache(targetThreadID);
      } catch (e) {
        console.error("Lỗi xóa cache thuê bot khi setthue:", e);
      }

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

      const planName = isAdminPlan ? "ADMIN-BOT" : "THƯỜNG";
      const unlockMsg = isAdminPlan ? "\n👑 Quyền đổi mode đã được mở khóa cho tất cả QTV nhóm!" : "";

      api.sendMessage(
        `✅ Đã cộng thêm thời gian sử dụng cho nhóm:\n` +
        `🆔 ID: ${targetThreadID}\n` +
        `📦 Gói: ${planName}\n` +
        `⏱️ Thời gian cộng: ${timeStr}\n` +
        `⏰ Hạn sử dụng mới: ${expireStr}`,
        event.threadID
      );

      // Nếu thêm nhóm hiện tại, gửi luôn thông báo vô nhóm
      if (targetThreadID === String(event.threadID)) {
        api.sendMessage(
          `🎉 Chúc mừng! Nhóm đã được Admin kích hoạt thủ công thêm ${timeStr} sử dụng Bot (Gói: ${planName}).\n` +
          `Các lệnh giải trí/tiện ích đã được mở khóa!${unlockMsg}`,
          event.threadID
        );
      } else {
        // Gửi thông báo đến nhóm mục tiêu
        api.sendMessage(
          `🎉 Chúc mừng! Nhóm bạn đã được Admin kích hoạt thủ công thêm ${timeStr} sử dụng Bot (Gói: ${planName}).\n` +
          `Các lệnh giải trí/tiện ích đã được mở khóa!${unlockMsg}`,
          targetThreadID
        ).catch(e => console.error("Không thể gửi tin nhắn đến nhóm:", targetThreadID));
      }

    } catch (error) {
      console.error("Lỗi khi setthue thủ công:", error);
      const errorText = error?.sqlMessage || error?.message || "Không rõ nguyên nhân";
      api.sendMessage(`❌ Lỗi CSDL khi thêm ngày thuê nhóm.\nChi tiết: ${errorText}`, event.threadID);
    }
  }
};
