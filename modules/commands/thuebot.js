const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execute } = require("../utils/database");

module.exports = {
  name: "thuebot",
  description: "Thuê bot hoặc gia hạn bot bằng mã QR tự động",
  usage: "!thuebot [số_tháng] | list (chỉ admin)",
  
  async execute({ api, event, args }) {
    const threadID = event.threadID;

    try {
      // 1. Tự động tạo Table nếu chưa có
      await execute(`
        CREATE TABLE IF NOT EXISTS transactions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          transaction_code VARCHAR(50) UNIQUE NOT NULL,
          amount INT NOT NULL,
          thread_id VARCHAR(50) NOT NULL,
          user_id VARCHAR(50) NOT NULL,
          status ENUM('pending', 'success', 'failed') DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await execute(`
        CREATE TABLE IF NOT EXISTS rented_groups (
          thread_id VARCHAR(50) PRIMARY KEY,
          expire_date TIMESTAMP NOT NULL
        )
      `);

      if (args && args[0] === "list") {
        const { getAdminBotUIDs } = require("../utils/checkPermission");
        const adminIDs = getAdminBotUIDs();
        if (!adminIDs.includes(String(event.senderID))) {
          return;
        }
        
        try {
          const rented = await execute("SELECT * FROM rented_groups ORDER BY expire_date DESC");
          if (!rented || rented.length === 0) {
            return api.sendMessage("📭 Hiện tại không có nhóm nào đang thuê bot.", threadID);
          }
          
          let msg = "📋 Danh sách các nhóm đang thuê bot:\n\n";
          for (let i = 0; i < rented.length; i++) {
              const rThreadID = rented[i].thread_id;
              const expireDate = new Date(rented[i].expire_date);
              
              const now = new Date();
              const diffMs = expireDate - now;
              const diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
              
              let groupName = "Không rõ";
              try {
                  const tInfo = await api.getThreadInfo(rThreadID);
                  if (tInfo && tInfo.threadName) groupName = tInfo.threadName;
              } catch (e) {}

              let renterName = "Không rõ";
              try {
                  const tx = await execute("SELECT user_id FROM transactions WHERE thread_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1", [rThreadID]);
                  if (tx && tx.length > 0) {
                      const uid = tx[0].user_id;
                      const uInfo = await api.getUserInfo(uid);
                      if (uInfo && uInfo[uid] && uInfo[uid].name) {
                          renterName = `${uInfo[uid].name} (${uid})`;
                      } else {
                          renterName = uid;
                      }
                  }
              } catch (e) {}

              msg += `${i+1}. Nhóm: ${groupName}\n   TID: ${rThreadID}\n   Người thuê: ${renterName}\n   Hết hạn: ${expireDate.toLocaleString('vi-VN')} (còn ${diffDays} ngày)\n\n`;
          }
          return api.sendMessage(msg.trimEnd(), threadID);
        } catch (e) {
          console.error("Lỗi lấy danh sách thuebot:", e);
          return api.sendMessage("❌ Lỗi khi lấy danh sách.", threadID);
        }
      }

      // Xử lý lệnh hủy giao dịch
      if (args && (args[0] === "huy" || args[0] === "cancel")) {
        const deleted = await execute(
          "DELETE FROM transactions WHERE thread_id = ? AND status = 'pending'",
          [threadID]
        );
        if (deleted.affectedRows > 0) {
          return api.sendMessage("✅ Đã hủy giao dịch thuê bot đang chờ của nhóm thành công!", threadID);
        } else {
          return api.sendMessage("ℹ️ Nhóm này không có giao dịch nào đang chờ thanh toán.", threadID);
        }
      }

      // 2. Kiểm tra xem nhóm đã có giao dịch nào đang chờ trong 15 phút qua chưa
      const existingTx = await execute(
        "SELECT * FROM transactions WHERE thread_id = ? AND status = 'pending' AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)",
        [threadID]
      );

      if (existingTx && existingTx.length > 0) {
        return api.sendMessage(
          "⏳ Nhóm này đang có 1 giao dịch thuê bot chờ thanh toán.\n" +
          "Vui lòng thanh toán mã cũ hoặc chờ 15 phút để mã cũ tự động hủy trước khi tạo mã mới!",
          threadID
        );
      }

      // 3. Kiểm tra thời gian còn lại nếu nhóm đã thuê bot
      const rentalInfo = await execute(
        "SELECT expire_date FROM rented_groups WHERE thread_id = ?",
        [threadID]
      );

      if (rentalInfo && rentalInfo.length > 0) {
        const expireDate = new Date(rentalInfo[0].expire_date);
        const now = new Date();

        if (expireDate > now) {
          // Tính toán thời gian còn lại
          const diffMs = expireDate - now;
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

          let timeText = "";
          if (diffDays > 0) timeText += `${diffDays} ngày `;
          if (diffHours > 0) timeText += `${diffHours} giờ `;
          if (diffMinutes > 0) timeText += `${diffMinutes} phút`;

          return api.sendMessage(
            `✅ Nhóm này đã thuê bot.\n\n📅 Thời gian còn lại: ${timeText.trim()}\n⏰ Hết hạn: ${expireDate.toLocaleString('vi-VN')}`,
            threadID
          );
        } else {
          // Đã hết hạn, xóa khỏi database
          await execute("DELETE FROM rented_groups WHERE thread_id = ?", [threadID]);
        }
      }
    } catch (e) {
      console.error("Lỗi kiểm tra CSDL thuebot:", e);
    }

    const menuMessage = `--- 💸 BẢNG GIÁ THUÊ BOT 💸 ---\n\n` +
      `[ THUÊ BOT THƯỜNG ]\n` +
      `1️⃣ 1 Tháng - 30,000 VNĐ\n` +
      `2️⃣ 3 Tháng - 80,000 VNĐ\n` +
      `3️⃣ 6 Tháng - 150,000 VNĐ\n` +
      `4️⃣ 1 Năm  - 250,000 VNĐ\n\n` +
      `[ THUÊ KÈM QUYỀN ADMIN-BOT ]\n` +
      `(Được toàn quyền dùng mọi lệnh cấm)\n` +
      `5️⃣ 1 Tháng - 60,000 VNĐ\n` +
      `6️⃣ 3 Tháng - 160,000 VNĐ\n` +
      `7️⃣ 6 Tháng - 300,000 VNĐ\n` +
      `8️⃣ 1 Năm  - 500,000 VNĐ\n\n` +
      `👉 Vui lòng REPLY (Phản hồi) tin nhắn này kèm theo SỐ THỨ TỰ (từ 1 đến 8) để chọn gói bạn muốn thuê.`;

    api.sendMessage(menuMessage, threadID);
  },

  async handleReply({ api, event }) {
    if (!event.messageReply) return;
    
    if (String(event.messageReply.senderID) !== String(api.getCurrentUserID())) return;
    
    if (!event.messageReply.body) return;

    if (!event.messageReply.body.includes("BẢNG GIÁ THUÊ BOT")) return;

    const threadID = event.threadID;
    const userID = event.senderID;
    const choice = parseInt(event.body.trim());

    let months = 0;
    let amount = 0;
    let typePrefix = "BOT";
    let planName = "";

    switch (choice) {
      // Gói Thường
      case 1: months = 1; amount = 30000; typePrefix = "BOT"; planName = "THƯỜNG"; break;
      case 2: months = 3; amount = 80000; typePrefix = "BOT"; planName = "THƯỜNG"; break;
      case 3: months = 6; amount = 150000; typePrefix = "BOT"; planName = "THƯỜNG"; break;
      case 4: months = 12; amount = 250000; typePrefix = "BOT"; planName = "THƯỜNG"; break;
      // Gói Admin
      case 5: months = 1; amount = 60000; typePrefix = "ADM"; planName = "ADMIN-BOT"; break;
      case 6: months = 3; amount = 160000; typePrefix = "ADM"; planName = "ADMIN-BOT"; break;
      case 7: months = 6; amount = 300000; typePrefix = "ADM"; planName = "ADMIN-BOT"; break;
      case 8: months = 12; amount = 500000; typePrefix = "ADM"; planName = "ADMIN-BOT"; break;
      default:
        return api.sendMessage("❌ Lựa chọn không hợp lệ. Vui lòng chọn số từ 1 đến 8.", threadID);
    }

    // Tạo mã giao dịch random (Tiền tố BOT hoặc ADM)
    const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
    const transactionCode = `${typePrefix}${threadID.substring(threadID.length - 4)}${randomStr}`;

    try {
      // 1. Kiểm tra chống spam (15 phút/1 hóa đơn)
      const existingTx = await execute(
        "SELECT * FROM transactions WHERE thread_id = ? AND status = 'pending' AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)",
        [threadID]
      );

      if (existingTx && existingTx.length > 0) {
        return api.sendMessage(
          "⏳ Nhóm này đang có 1 giao dịch thuê bot chờ thanh toán.\n" +
          "Vui lòng thanh toán mã cũ hoặc chờ 15 phút để mã cũ tự động hủy trước khi tạo mã mới!",
          threadID
        );
      }

      // 2. Lưu giao dịch đang chờ vào database
      await execute(
        "INSERT INTO transactions (transaction_code, amount, thread_id, user_id, status) VALUES (?, ?, ?, ?, ?)",
        [transactionCode, amount, threadID, userID, "pending"]
      );

      // ============================================
      // 3. THÔNG TIN TÀI KHOẢN
      // ============================================
      const BANK_ID = "BIDV"; 
      const ACCOUNT_NO = "96247EUYAJ"; 
      const ACCOUNT_NAME = "LE DINH VAN";
      
      const qrUrl = `https://qr.sepay.vn/img?acc=${ACCOUNT_NO}&bank=${BANK_ID}&amount=${amount}&des=${transactionCode}`;
      
      // 4. Tải và gửi ảnh QR
      const qrPath = path.join(__dirname, `../../cache/qr_${transactionCode}.png`);
      const response = await axios({
        url: qrUrl,
        method: 'GET',
        responseType: 'stream'
      });
      
      const writer = fs.createWriteStream(qrPath);
      response.data.pipe(writer);
      
      writer.on('finish', () => {
        api.sendMessage({
          body: `[ HÓA ĐƠN THUÊ BOT - GÓI ${planName} ${months} THÁNG ]\n\n` +
                `💵 Số tiền: ${amount.toLocaleString('vi-VN')} VNĐ\n` +
                `📝 Nội dung chuyển khoản: ${transactionCode}\n\n` +
                `⚠️ LƯU Ý QUAN TRỌNG:\n` +
                `Hãy chuyển ĐÚNG số tiền và ĐÚNG nội dung CK để hệ thống duyệt tự động.\n` +
                `Bot sẽ tự động báo thành công từ 1-3 phút sau khi chuyển khoản.`,
          attachment: fs.createReadStream(qrPath)
        }, threadID, event.messageID);
        
        // Xóa file QR sau 10 giây để đảm bảo file đã được gửi
        setTimeout(() => {
          if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);
        }, 10000);
      });
      
    } catch (error) {
      console.error("Lỗi tạo QR thuê bot:", error);
      api.sendMessage("Đã xảy ra lỗi hệ thống khi tạo QR. Vui lòng báo cho Admin.", threadID);
    }
  }
};
