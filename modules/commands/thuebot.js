const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execute } = require("../utils/database");
const { ensureRentedGroupsSchema } = require("../utils/rentalSchema");
const { getThreadInfoCached } = require("../utils/threadInfo");

async function sendRentedList(api, threadID, senderID, page) {
  try {
    await ensureRentedGroupsSchema();
    const rented = await execute(
      "SELECT * FROM rented_groups ORDER BY expire_date DESC"
    );

    if (!rented || rented.length === 0) {
      return api.sendMessage("📭 Hiện tại không có nhóm nào đang thuê bot.", threadID);
    }

    const itemsPerPage = 5;
    const totalPages = Math.ceil(rented.length / itemsPerPage);

    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const startIndex = (page - 1) * itemsPerPage;
    const pageItems = rented.slice(startIndex, startIndex + itemsPerPage);

    let msg = `📋 DANH SÁCH NHÓM THUÊ BOT [Trang ${page}/${totalPages}]\n━━━━━━━━━━━━━\n\n`;

    for (let i = 0; i < pageItems.length; i++) {
      const displayIndex = startIndex + i + 1;
      const group = pageItems[i];
      const rThreadID = group.thread_id;
      const expireDate = new Date(group.expire_date);
      const rentedAt = group.rented_at ? new Date(group.rented_at) : null;
      const renterId = group.renter_id ? String(group.renter_id) : "";

      const now = new Date();
      const diffMs = expireDate - now;
      let statusText = "";

      if (diffMs > 0) {
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        statusText = `còn ${diffDays} ngày`;
      } else {
        statusText = `ĐÃ HẾT HẠN`;
      }

      let groupName = "Không rõ";
      try {
        const tInfo = await getThreadInfoCached(api, rThreadID);
        if (tInfo && tInfo.threadName) groupName = tInfo.threadName;
      } catch (e) {}

      let renterName = "Không rõ";
      try {
        if (renterId) {
          const uInfo = await api.getUserInfo(renterId);
          if (uInfo && uInfo[renterId] && uInfo[renterId].name) {
            renterName = `${uInfo[renterId].name} (${renterId})`;
          } else {
            renterName = renterId;
          }
        } else {
          const tx = await execute(
            "SELECT user_id FROM transactions WHERE thread_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1",
            [rThreadID]
          );
          if (tx && tx.length > 0) {
            const uid = tx[0].user_id;
            const uInfo = await api.getUserInfo(uid);
            if (uInfo && uInfo[uid] && uInfo[uid].name) {
              renterName = `${uInfo[uid].name} (${uid})`;
            } else {
              renterName = uid;
            }
          }
        }
      } catch (e) {}

      const packageType = group.is_admin_rental ? "ADMIN-BOT" : "THƯỜNG";
      msg += `${displayIndex}. Nhóm: ${groupName}\n`;
      msg += `   TID: ${rThreadID}\n`;
      msg += `   Gói: ${packageType}\n`;
      msg += `   Người thuê: ${renterName}\n`;
      msg += `   Thời điểm thuê: ${rentedAt ? rentedAt.toLocaleString("vi-VN") : "Không rõ"}\n`;
      msg += `   Hết hạn: ${expireDate.toLocaleString("vi-VN")} (${statusText})\n\n`;
    }

    msg += "━━━━━━━━━━━━━\n";
    msg += `👉 Phản hồi (reply) tin nhắn này kèm:\n`;
    msg += `• del <Số thứ tự> để xóa nhóm khỏi danh sách\n`;
    msg += `• giahan <Số thứ tự> <thuong/admin> <thời gian: 30d/1m>\n`;
    msg += `• page <Số trang> để chuyển trang (Ví dụ: page 2)\n`;
    msg += `⚠️ Tin nhắn này sẽ tự động gỡ sau khi thực hiện thao tác.`;

    const info = await api.sendMessage(msg.trimEnd(), threadID);
    if (!global.client) global.client = {};
    if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];

    // Xóa các handleReply admin_list cũ của thuebot trong thread này
    const list = global.client.handleReply;
    for (let i = list.length - 1; i >= 0; i--) {
      if (
        list[i].name === "thuebot" &&
        list[i].type === "admin_list" &&
        String(list[i].threadID) === String(threadID)
      ) {
        list.splice(i, 1);
      }
    }

    global.client.handleReply.push({
      name: "thuebot",
      type: "admin_list",
      author: senderID,
      messageID: info.messageID,
      threadID: threadID,
      page: page
    });
  } catch (e) {
    console.error("Lỗi khi tải hoặc hiển thị danh sách thuebot:", e);
    return api.sendMessage("❌ Lỗi khi lấy danh sách.", threadID);
  }
}

module.exports = {
  name: "thuebot",
  description: "Thuê bot hoặc gia hạn bot bằng mã QR tự động",
  usage: "!thuebot [số_tháng] | list (chỉ admin)",

  async execute({ api, event, args, config }) {
    const threadID = event.threadID;
    const senderID = event.senderID;

    try {
      await ensureRentedGroupsSchema();

      if (args && args[0] === "list") {
        const { getAdminBotUIDs } = require("../utils/checkPermission");
        const adminIDs = getAdminBotUIDs();
        if (!adminIDs.includes(String(senderID))) {
          return;
        }
        await sendRentedList(api, threadID, senderID, 1);
        return;
      }

      // Xử lý lệnh hủy giao dịch
      if (args && (args[0] === "huy" || args[0] === "cancel")) {
        const deleted = await execute(
          "DELETE FROM transactions WHERE thread_id = ? AND status = 'pending'",
          [threadID]
        );
        if (deleted.affectedRows > 0) {
          return api.sendMessage(
            "✅ Đã hủy giao dịch thuê bot đang chờ của nhóm thành công!",
            threadID
          );
        } else {
          return api.sendMessage(
            "ℹ️ Nhóm này không có giao dịch nào đang chờ thanh toán.",
            threadID
          );
        }
      }

      // Kiểm tra xem nhóm đã có giao dịch nào đang chờ trong 15 phút qua chưa
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

      // Kiểm tra thời gian còn lại nếu nhóm đã thuê bot
      const rentalInfo = await execute(
        "SELECT expire_date FROM rented_groups WHERE thread_id = ?",
        [threadID]
      );

      if (rentalInfo && rentalInfo.length > 0) {
        const expireDate = new Date(rentalInfo[0].expire_date);
        const now = new Date();

        if (expireDate > now) {
          const diffMs = expireDate - now;
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const diffHours = Math.floor(
            (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
          );
          const diffMinutes = Math.floor(
            (diffMs % (1000 * 60 * 60)) / (1000 * 60)
          );

          let timeText = "";
          if (diffDays > 0) timeText += `${diffDays} ngày `;
          if (diffHours > 0) timeText += `${diffHours} giờ `;
          if (diffMinutes > 0) timeText += `${diffMinutes} phút`;

          return api.sendMessage(
            `✅ Nhóm này đã thuê bot.\n\n📅 Thời gian còn lại: ${timeText.trim()}\n⏰ Hết hạn: ${expireDate.toLocaleString(
              "vi-VN"
            )}`,
            threadID
          );
        } else {
          // Đã hết hạn, xóa khỏi database
          await execute("DELETE FROM rented_groups WHERE thread_id = ?", [
            threadID
          ]);
          try {
            const { clearRentalCache } = require("../utils/rental");
            clearRentalCache(threadID);
          } catch (e) {
            console.error("Lỗi xóa cache thuê bot khi xóa nhóm hết hạn:", e);
          }
        }
      }
    } catch (e) {
      console.error("Lỗi kiểm tra CSDL thuebot:", e);
    }

    const menuMessage =
      `--- 💸 BẢNG GIÁ THUÊ BOT 💸 ---\n\n` +
      `[ THUÊ BOT THƯỜNG ]\n` +
      `1️⃣ 1 Tháng - 25,000 VNĐ\n` +
      `2️⃣ 3 Tháng - 70,000 VNĐ\n` +
      `3️⃣ 6 Tháng - 150,000 VNĐ\n` +
      `4️⃣ 1 Năm  - 275,000 VNĐ\n\n` +
      `[ THUÊ KÈM QUYỀN ADMIN-BOT ]\n` +
      `(Được toàn quyền dùng mọi lệnh cấm)\n` +
      `5️⃣ 1 Tháng - 50,000 VNĐ\n` +
      `6️⃣ 3 Tháng - 140,000 VNĐ\n` +
      `7️⃣ 6 Tháng - 300,000 VNĐ\n` +
      `8️⃣ 1 Năm  - 550,000 VNĐ\n\n` +
      `👉 Vui lòng REPLY (Phản hồi) tin nhắn này kèm theo SỐ THỨ TỰ ( từ 1 đến 8 ) để chọn gói bạn muốn thuê.`;

    try {
      const info = await api.sendMessage(menuMessage, threadID);
      if (!global.client) global.client = {};
      if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
      
      // Xóa các rent_menu cũ trong thread này
      const list = global.client.handleReply;
      for (let i = list.length - 1; i >= 0; i--) {
        if (
          list[i].name === "thuebot" &&
          list[i].type === "rent_menu" &&
          String(list[i].threadID) === String(threadID)
        ) {
          list.splice(i, 1);
        }
      }

      global.client.handleReply.push({
        name: "thuebot",
        type: "rent_menu",
        author: senderID,
        messageID: info.messageID,
        threadID: threadID
      });
    } catch (e) {
      console.error("Lỗi gửi menu thuê bot:", e);
    }
  },

  async handleReply({ api, event }) {
    const { threadID, messageID, senderID, body, messageReply } = event;
    if (!messageReply || !messageReply.messageID) return;

    const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
    const handleReply = list.find(h => String(h.messageID) === String(messageReply.messageID) && h.name === "thuebot");
    if (!handleReply) return;

    // 1. XỬ LÝ PHẢN HỒI CHO MENU THUÊ BOT (BẢNG GIÁ THUÊ BOT)
    if (handleReply.type === "rent_menu") {
      if (String(handleReply.author) !== String(senderID)) return;

      const choice = parseInt(body.trim());
      if (Number.isNaN(choice)) {
        return api.sendMessage("❌ Vui lòng reply bằng số từ 1 đến 8.", threadID, messageID);
      }

      let months = 0;
      let amount = 0;
      let typePrefix = "BOT";
      let planName = "";

      switch (choice) {
        // Gói Thường
        case 1: months = 1; amount = 25000; typePrefix = "BOT"; planName = "THƯỜNG"; break;
        case 2: months = 3; amount = 70000; typePrefix = "BOT"; planName = "THƯỜNG"; break;
        case 3: months = 6; amount = 140000; typePrefix = "BOT"; planName = "THƯỜNG"; break;
        case 4: months = 12; amount = 275000; typePrefix = "BOT"; planName = "THƯỜNG"; break;
        // Gói Admin
        case 5: months = 1; amount = 50000; typePrefix = "ADM"; planName = "ADMIN-BOT"; break;
        case 6: months = 3; amount = 140000; typePrefix = "ADM"; planName = "ADMIN-BOT"; break;
        case 7: months = 6; amount = 280000; typePrefix = "ADM"; planName = "ADMIN-BOT"; break;
        case 8: months = 12; amount = 550000; typePrefix = "ADM"; planName = "ADMIN-BOT"; break;
        default:
          return api.sendMessage(
            "❌ Lựa chọn không hợp lệ. Vui lòng chọn số từ 1 đến 8.",
            threadID,
            messageID
          );
      }

      const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
      const transactionCode = `${typePrefix}${threadID.substring(
        threadID.length - 4
      )}${randomStr}`;

      try {
        const existingTx = await execute(
          "SELECT * FROM transactions WHERE thread_id = ? AND status = 'pending' AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)",
          [threadID]
        );

        if (existingTx && existingTx.length > 0) {
          return api.sendMessage(
            "⏳ Nhóm này đang có 1 giao dịch thuê bot chờ thanh toán.\n" +
              "Vui lòng thanh toán mã cũ hoặc chờ 15 phút để mã cũ tự động hủy trước khi tạo mã mới!",
            threadID,
            messageID
          );
        }

        await execute(
          "INSERT INTO transactions (transaction_code, amount, thread_id, user_id, status) VALUES (?, ?, ?, ?, ?)",
          [transactionCode, amount, threadID, senderID, "pending"]
        );

        const BANK_ID = "BIDV";
        const ACCOUNT_NO = "96247EUYAJ";
        const qrUrl = `https://qr.sepay.vn/img?acc=${ACCOUNT_NO}&bank=${BANK_ID}&amount=${amount}&des=${transactionCode}`;
        const qrPath = path.join(__dirname, `../../cache/qr_${transactionCode}.png`);

        const response = await axios({
          url: qrUrl,
          method: "GET",
          responseType: "stream"
        });

        const writer = fs.createWriteStream(qrPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
          response.data.on("error", reject);
        });

        // Gỡ tin nhắn bảng giá thuê bot cũ
        try {
          await api.unsendMessage(handleReply.messageID);
        } catch (e) {}

        // Xóa khỏi handleReply
        const list = global.client.handleReply || [];
        const idx = list.findIndex(h => h.messageID === handleReply.messageID);
        if (idx > -1) list.splice(idx, 1);

        await api.sendMessage(
          {
            body:
              `[ HÓA ĐƠN THUÊ BOT - GÓI ${planName} ${months} THÁNG ]\n\n` +
              `💵 Số tiền: ${amount.toLocaleString("vi-VN")} VNĐ\n` +
              `📝 Nội dung chuyển khoản: ${transactionCode}\n\n` +
              `⚠️ LƯU Ý QUAN TRỌNG:\n` +
              `Hãy chuyển ĐÚNG số tiền và ĐÚNG nội dung CK để hệ thống duyệt tự động.\n` +
              `Bot sẽ tự động báo thành công từ 1-3 phút sau khi chuyển khoản.`,
            attachment: fs.createReadStream(qrPath)
          },
          threadID,
          undefined,
          messageID
        );

        setTimeout(() => {
          if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);
        }, 10000);
      } catch (error) {
        console.error("Lỗi tạo QR thuê bot:", error);
        api.sendMessage(
          "❌ Không tạo được ảnh QR, nhưng bạn vẫn có thể chuyển khoản thủ công.\n" +
            `💵 Số tiền: ${amount.toLocaleString("vi-VN")} VNĐ\n` +
            `🏦 Ngân hàng: BIDV\n` +
            `🔢 STK: 8850288200\n` +
            `📝 Nội dung CK: ${transactionCode}`,
          threadID,
          messageID
        );
      }
      return;
    }

    // 2. XỬ LÝ PHẢN HỒI CHO DANH SÁCH NHÓM THUÊ BOT (ADMIN_LIST)
    if (handleReply.type === "admin_list") {
      const { getAdminBotUIDs } = require("../utils/checkPermission");
      const adminIDs = getAdminBotUIDs();
      if (!adminIDs.includes(String(senderID))) {
        return api.sendMessage(
          "⚠️ Chỉ admin bot mới có quyền thực hiện thao tác quản lý này.",
          threadID,
          messageID
        );
      }

      const trimmed = String(body || "").trim();
      const delMatch = trimmed.match(/^del\s+([\d\s,]+)$/i);
      const giahanMatch = trimmed.match(
        /^giahan\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(\d+))?$/i
      );
      const pageMatch = trimmed.match(/^page\s+(\d+)$/i);

      if (!delMatch && !giahanMatch && !pageMatch) {
        return api.sendMessage(
          "⚠️ Cú pháp phản hồi không hợp lệ!\n" +
            "👉 del <Số thứ tự> để xóa nhóm\n" +
            "👉 giahan <Số thứ tự> <thuong/admin> <thời gian: 30d/1m> <id_admin (nếu là admin)>\n" +
            "👉 page <Số trang> để chuyển trang",
          threadID,
          messageID
        );
      }

      // XỬ LÝ SANG TRANG
      if (pageMatch) {
        const targetPage = parseInt(pageMatch[1]);
        try {
          const rented = await execute(
            "SELECT * FROM rented_groups ORDER BY expire_date DESC"
          );
          const totalPages = Math.ceil(rented.length / 5);

          if (targetPage < 1 || targetPage > totalPages) {
            return api.sendMessage(
              `❌ Trang không hợp lệ (Danh sách chỉ có từ 1 đến ${totalPages} trang).`,
              threadID,
              messageID
            );
          }

          // Gỡ tin nhắn cũ
          try {
            await api.unsendMessage(handleReply.messageID);
          } catch (err) {}

          // Xóa handleReply cũ
          const list = global.client.handleReply || [];
          const idx = list.findIndex(h => h.messageID === handleReply.messageID);
          if (idx > -1) list.splice(idx, 1);

          await sendRentedList(api, threadID, senderID, targetPage);
        } catch (e) {
          console.error(e);
          api.sendMessage("❌ Có lỗi xảy ra khi chuyển trang.", threadID, messageID);
        }
        return;
      }

      // XỬ LÝ XÓA NHÓM
      if (delMatch) {
        const choices = delMatch[1]
          .split(/[\s,]+/)
          .map(s => parseInt(s))
          .filter(n => !isNaN(n));

        if (choices.length === 0) {
          return api.sendMessage("❌ Cú pháp xóa không hợp lệ.", threadID, messageID);
        }

        try {
          const rented = await execute(
            "SELECT * FROM rented_groups ORDER BY expire_date DESC"
          );

          const invalidChoices = choices.filter(c => c < 1 || c > rented.length);
          if (invalidChoices.length > 0) {
            return api.sendMessage(
              `❌ Số thứ tự nhóm không tồn tại trong danh sách: ${invalidChoices.join(", ")}`,
              threadID,
              messageID
            );
          }

          const successDeleted = [];
          for (const choice of choices) {
            const targetGroup = rented[choice - 1];
            const targetThreadID = targetGroup.thread_id;

            // Xóa khỏi DB
            await execute("DELETE FROM rented_groups WHERE thread_id = ?", [
              targetThreadID
            ]);

            // Clear cache
            try {
              const { clearRentalCache } = require("../utils/rental");
              clearRentalCache(targetThreadID);
            } catch (e) {}

            // Thông báo cho nhóm bị xóa
            try {
              await api.sendMessage(
                "⚠️ Nhóm của bạn đã bị gỡ quyền sử dụng bot do admin hủy thuê.",
                targetThreadID
              );
            } catch (e) {
              console.error("Không thể gửi thông báo tới nhóm bị xóa:", e);
            }

            successDeleted.push(targetThreadID);
          }

          // Gỡ tin nhắn list cũ
          try {
            await api.unsendMessage(handleReply.messageID);
          } catch (e) {}

          // Xóa handleReply
          const list = global.client.handleReply || [];
          const idx = list.findIndex(h => h.messageID === handleReply.messageID);
          if (idx > -1) list.splice(idx, 1);

          return api.sendMessage(
            `✅ Đã xóa thành công ${successDeleted.length} nhóm khỏi danh sách thuê bot và thông báo tới các nhóm:\n` +
            successDeleted.map(tid => `• TID: ${tid}`).join("\n"),
            threadID,
            messageID
          );
        } catch (e) {
          console.error(e);
          return api.sendMessage("❌ Lỗi khi xóa nhóm.", threadID, messageID);
        }
      }

      // XỬ LÝ GIA HẠN NHÓM
      if (giahanMatch) {
        const orderNumber = parseInt(giahanMatch[1]);
        const packageType = giahanMatch[2].toLowerCase();
        const timeInput = giahanMatch[3].toLowerCase();
        const idAdmin = giahanMatch[4];

        const isAdminPlan = ["admin", "adm"].includes(packageType);
        const isNormalPlan = ["thuong", "bot", "normal"].includes(packageType);

        if (!isAdminPlan && !isNormalPlan) {
          return api.sendMessage(
            "❌ Loại gói không hợp lệ. Vui lòng chọn 'thuong' hoặc 'admin'.",
            threadID,
            messageID
          );
        }

        // idAdmin không còn bắt buộc vì tất cả QTV nhóm đều được dùng lệnh mode

        let daysToAdd = 30;
        let timeStr = "";

        if (timeInput.endsWith("d")) {
          const days = parseInt(timeInput.replace("d", ""));
          if (isNaN(days) || days <= 0) {
            return api.sendMessage("❌ Số ngày không hợp lệ.", threadID, messageID);
          }
          daysToAdd = days;
          timeStr = `${days} ngày`;
        } else {
          const months = parseInt(timeInput.replace("m", ""));
          if (isNaN(months) || months <= 0) {
            return api.sendMessage("❌ Số tháng không hợp lệ.", threadID, messageID);
          }
          daysToAdd = months * 30;
          timeStr = `${months} tháng (${daysToAdd} ngày)`;
        }

        try {
          const rented = await execute(
            "SELECT * FROM rented_groups ORDER BY expire_date DESC"
          );
          if (orderNumber < 1 || orderNumber > rented.length) {
            return api.sendMessage(
              "❌ Số thứ tự nhóm không tồn tại trong danh sách.",
              threadID,
              messageID
            );
          }

          const targetGroup = rented[orderNumber - 1];
          const targetThreadID = targetGroup.thread_id;

          // Cập nhật CSDL
          await execute(
            `
            INSERT INTO rented_groups (thread_id, expire_date, renter_id, rented_at, is_admin_rental)
            VALUES (?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY), ?, CURRENT_TIMESTAMP, ?)
            ON DUPLICATE KEY UPDATE
              expire_date = DATE_ADD(GREATEST(COALESCE(expire_date, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP), INTERVAL ? DAY),
              renter_id = ?,
              rented_at = CURRENT_TIMESTAMP,
              is_admin_rental = ?
          `,
            [targetThreadID, daysToAdd, senderID, isAdminPlan ? 1 : 0, daysToAdd, senderID, isAdminPlan ? 1 : 0]
          );

          // Clear cache
          try {
            const { clearRentalCache } = require("../utils/rental");
            clearRentalCache(targetThreadID);
          } catch (e) {}

          // Lấy hạn sử dụng mới
          const info = await execute(
            "SELECT expire_date FROM rented_groups WHERE thread_id = ?",
            [targetThreadID]
          );
          let expireStr = "Không rõ";
          if (info && info.length > 0) {
            const date = new Date(info[0].expire_date);
            expireStr = date.toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh"
            });
          }

          // Cấp quyền Admin Bot nếu là gói admin
          let adminGrantedMsg = "";
          if (isAdminPlan) {
            adminGrantedMsg = `\n👑 Quyền đổi mode đã được mở khóa cho tất cả QTV nhóm!`;
          }

          // Gỡ tin nhắn list cũ
          try {
            await api.unsendMessage(handleReply.messageID);
          } catch (e) {}

          // Xóa handleReply
          const list = global.client.handleReply || [];
          const idx = list.findIndex(h => h.messageID === handleReply.messageID);
          if (idx > -1) list.splice(idx, 1);

          // Thông báo cho nhóm được gia hạn
          let notifyMsg =
            `🎉 [ THÔNG BÁO GIA HẠN ] 🎉\n\n` +
            `Nhóm của bạn đã được Admin gia hạn thêm ${timeStr} sử dụng Bot.\n` +
            `⏰ Hạn sử dụng mới: ${expireStr}${adminGrantedMsg}\n` +
            `💝 Cảm ơn các bạn đã tiếp tục đồng hành cùng Bot!`;
          try {
            await api.sendMessage(notifyMsg, targetThreadID);
          } catch (e) {
            console.error("Không thể gửi thông báo tới nhóm được gia hạn:", e);
          }

          // Thông báo lại cho Admin thực hiện lệnh
          let adminMsg =
            `✅ Gia hạn thành công cho nhóm:\n` +
            `🆔 TID: ${targetThreadID}\n` +
            `⏱️ Thời gian cộng: ${timeStr}\n` +
            `⏰ Hạn dùng mới: ${expireStr}`;
          if (isAdminPlan) {
            adminMsg += `\n👑 Quyền đổi mode đã được mở khóa cho tất cả QTV nhóm!`;
          }

          return api.sendMessage(adminMsg, threadID, messageID);
        } catch (e) {
          console.error(e);
          return api.sendMessage(
            "❌ Lỗi CSDL khi thực hiện gia hạn nhóm.",
            threadID,
            messageID
          );
        }
      }
    }
  }
};
