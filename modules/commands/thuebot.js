const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execute } = require("../utils/database");
const { ensureRentedGroupsSchema, ensureTransactionsSchema } = require("../utils/rentalSchema");
const { ensureAccountClusterSchema } = require("../utils/accountSchema");
const { getThreadInfoCached } = require("../utils/threadInfo");

async function sendRentedList(api, threadID, senderID, page) {
  try {
    await ensureRentedGroupsSchema();
    await ensureAccountClusterSchema();
    const rented = await execute(
      "SELECT * FROM rented_groups WHERE thread_id NOT IN ('1523319575522034', '844251878447942') ORDER BY expire_date DESC"
    );

    if (!rented || rented.length === 0) {
      return api.sendMessage("📭 Hiện tại không có nhóm nào đang thuê bot.", threadID);
    }

    const itemsPerPage = 5;
    const totalPages = Math.ceil(rented.length / itemsPerPage);

    if (page < 1) page = 1;
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

      const isStopped = !!group.is_stopped;
      const pausedMs = Number(group.paused_remaining_ms || 0);

      const now = new Date();
      const diffMs = expireDate - now;
      let statusText = "";

      if (isStopped) {
        const pDays = Math.floor(pausedMs / (1000 * 60 * 60 * 24));
        const pHours = Math.floor((pausedMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        statusText = `⏸️ ĐÃ TẠM DỪNG (Bảo lưu ${pDays}d ${pHours}h)`;
      } else if (diffMs > 0) {
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        statusText = `còn ${diffDays} ngày`;
      } else {
        statusText = `ĐÃ HẾT HẠN`;
      }

      let groupName = "Không rõ";
      try {
        const cachedGroup = await execute("SELECT thread_name FROM thread_info_cache WHERE thread_id = ? LIMIT 1", [rThreadID]);
        if (cachedGroup && cachedGroup[0] && cachedGroup[0].thread_name) {
          groupName = cachedGroup[0].thread_name;
        } else {
          const tRows = await execute("SELECT thread_name FROM threads WHERE thread_id = ? LIMIT 1", [rThreadID]);
          if (tRows && tRows[0] && tRows[0].thread_name) groupName = tRows[0].thread_name;
        }
      } catch (e) { }

      let renterName = "Không rõ";
      try {
        let targetUid = renterId;
        if (!targetUid) {
          const tx = await execute(
            "SELECT user_id FROM transactions WHERE thread_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1",
            [rThreadID]
          );
          if (tx && tx.length > 0) {
            targetUid = tx[0].user_id;
          }
        }

        if (targetUid) {
          const id = String(targetUid).trim();
          if (global.data?.userName?.has(id)) {
            renterName = `${global.data.userName.get(id)} (${id})`;
          } else {
            const dbRows = await execute("SELECT name FROM messenger_users WHERE psid = ? AND name != 'Người dùng' AND name != '' LIMIT 1", [id]);
            if (dbRows && dbRows[0] && dbRows[0].name) {
              if (global.data?.userName) global.data.userName.set(id, dbRows[0].name);
              renterName = `${dbRows[0].name} (${id})`;
            } else {
              renterName = id;
            }
          }
        }
      } catch (e) { }

      let assignedProfilesText = "Default";
      try {
        const binding = await execute(`SELECT cluster_id, assigned_profiles FROM group_profile_bindings WHERE thread_id = ?`, [rThreadID]);
        if (binding && binding.length > 0) {
          const clusterId = binding[0].cluster_id;
          const accountProfilesManager = require("../../src/managers/accountProfilesManager");
          accountProfilesManager.loadConfig();
          const clusters = accountProfilesManager.config ? accountProfilesManager.config.clusters : [];
          const clusterObj = clusters.find(c => String(c.cluster_id) === String(clusterId));
          if (clusterObj && clusterObj.active_profile) {
            assignedProfilesText = clusterObj.active_profile;
          } else {
            const profilesArr = JSON.parse(binding[0].assigned_profiles);
            if (Array.isArray(profilesArr) && profilesArr.length > 0) {
              assignedProfilesText = profilesArr[0];
            }
          }
        }
      } catch (e) { }

      const packageType = group.is_admin_rental ? "ADMIN-BOT" : "THƯỜNG";
      msg += `${displayIndex}. Nhóm: ${groupName}\n`;
      msg += `   TID: ${rThreadID}\n`;
      msg += `   Gói: ${packageType}\n`;
      msg += `   Profile đang chạy: ${assignedProfilesText}\n`;
      msg += `   Người thuê: ${renterName}\n`;
      msg += `   Thời điểm thuê: ${rentedAt ? rentedAt.toLocaleString("vi-VN") : "Không rõ"}\n`;
      if (isStopped) {
        msg += `   Hết hạn: ⏸️ Đang tạm dừng tính ngày (${statusText})\n\n`;
      } else {
        msg += `   Hết hạn: ${expireDate.toLocaleString("vi-VN")} (${statusText})\n\n`;
      }
    }

    msg += "━━━━━━━━━━━━━\n";
    msg += `👉 Phản hồi (reply) tin nhắn này kèm:\n`;
    msg += `• del <Số thứ tự> để xóa nhóm khỏi danh sách\n`;
    msg += `• stop <Số thứ tự> để tạm dừng / tiếp tục tính ngày\n`;
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


async function sendOrderHistory(api, threadID, senderID, page) {
  try {
    await ensureTransactionsSchema();
    await execute(
      "UPDATE transactions SET status = 'cancelled', updated_at = datetime('now') WHERE status = 'pending' AND created_at <= datetime('now', '-15 minutes')"
    );
    const orders = await execute(
      "SELECT * FROM transactions ORDER BY created_at DESC"
    );

    if (!orders || orders.length === 0) {
      return api.sendMessage("📭 Chưa có giao dịch nào trong lịch sử.", threadID);
    }

    const itemsPerPage = 7;
    const totalPages = Math.ceil(orders.length / itemsPerPage);

    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    const startIndex = (page - 1) * itemsPerPage;
    const pageItems = orders.slice(startIndex, startIndex + itemsPerPage);

    const statusEmoji = {
      pending: "⏳ Chờ thanh toán",
      success: "✅ Thành công",
      cancelled: "❌ Đã hủy"
    };

    function formatDate(dateStr) {
      if (!dateStr) return "—";
      try {
        const d = new Date(dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + "Z");
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
      } catch (e) {
        return dateStr;
      }
    }

    let msg = `📋 LỊCH SỬ ĐƠN HÀNG [Trang ${page}/${totalPages}]\n━━━━━━━━━━━━━\n\n`;

    for (let i = 0; i < pageItems.length; i++) {
      const displayIndex = startIndex + i + 1;
      const o = pageItems[i];

      const groupName = o.group_name || "(chưa lưu)";
      const planName = o.plan_name || (o.transaction_code?.startsWith("ADM") ? "ADMIN-BOT" : "THƯỜNG");
      const monthsStr = o.months ? `${o.months} tháng` : "—";
      const amountStr = Number(o.amount).toLocaleString("vi-VN");
      const statusStr = statusEmoji[o.status] || o.status;
      const updatedStr = o.updated_at ? ` (${formatDate(o.updated_at)})` : "";

      msg += `#${displayIndex} — ${o.transaction_code}\n`;
      msg += `   📌 Nhóm: ${groupName}\n`;
      msg += `   🆔 TID: ${o.thread_id}\n`;
      msg += `   👤 Người thuê: ${o.user_id}\n`;
      msg += `   📦 Gói: ${planName} — ${monthsStr}\n`;
      msg += `   💵 Số tiền: ${amountStr} VNĐ\n`;
      msg += `   📅 Tạo: ${formatDate(o.created_at)}\n`;
      msg += `   🏷️ Trạng thái: ${statusStr}${updatedStr}\n\n`;
    }

    msg += `━━━━━━━━━━━━━\n`;
    msg += `📄 Trang ${page}/${totalPages} (Tổng: ${orders.length} đơn)\n`;
    if (totalPages > 1) {
      msg += `Reply "page <số>" để chuyển trang`;
    }

    const info = await api.sendMessage(msg, threadID);

    if (!global.client) global.client = {};
    if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];

    // Xóa các order_history cũ trong thread này
    const list = global.client.handleReply;
    for (let i = list.length - 1; i >= 0; i--) {
      if (
        list[i].name === "thuebot" &&
        list[i].type === "order_history" &&
        String(list[i].threadID) === String(threadID)
      ) {
        list.splice(i, 1);
      }
    }

    global.client.handleReply.push({
      name: "thuebot",
      type: "order_history",
      author: senderID,
      messageID: info.messageID,
      threadID: threadID,
      page: page
    });
  } catch (e) {
    console.error("Lỗi khi tải lịch sử đơn hàng:", e);
    return api.sendMessage("❌ Lỗi khi lấy lịch sử đơn hàng.", threadID);
  }
}


const botPrefix = process.env.BOT_PREFIX || "!";

module.exports = {
  name: "thuebot",
  description: "Bảng giá thuê bot, chuyển khoản tự động, quản lý nhóm thuê & slot cụm acc",
  usage:
    `\n${botPrefix}thuebot → Xem bảng giá & tạo mã QR thuê bot tự động` +
    `\n${botPrefix}thuebot giahan → Gia hạn thời hạn sử dụng bot cho nhóm hiện tại` +
    `\n${botPrefix}thuebot doigoi → Đổi gói thuê (THƯỜNG ⇄ ADMIN-BOT)` +
    `\n${botPrefix}thuebot doigoi xacnhan → Xác nhận thực hiện chuyển đổi gói` +
    `\n${botPrefix}thuebot huy → Hủy giao dịch thuê bot đang chờ thanh toán` +
    `\n━━━━━━━━━━━━━` +
    `\n👑 CÁC LỆNH DÀNH CHO ADMIN BOT:` +
    `\n${botPrefix}thuebot list → Xem danh sách tất cả các nhóm đang thuê bot` +
    `\n${botPrefix}thuebot lichsu → Xem lịch sử đơn hàng thuê bot` +
    `\n${botPrefix}thuebot stop [STT / TID] → Tạm dừng / Tiếp tục đếm ngày thuê bot` +
    `\n${botPrefix}thuebot del [STT / TID] → Xóa nhóm khỏi danh sách thuê bot`,

  async execute({ api, event, args, config }) {
    const threadID = event.threadID;
    const senderID = event.senderID;
    const messageID = event.messageID;
    const prefix = config?.prefix || "!";

    try {
      await ensureRentedGroupsSchema();

      const subArg = args && args[0] ? args[0].toLowerCase() : "";


      // Xử lý các lệnh quản lý trực tiếp bằng TID hoặc STT (chỉ admin bot)
      if (["stop", "pause", "start", "resume", "del", "delete"].includes(subArg) && args[1]) {
        const { getAdminBotUIDs } = require("../utils/checkPermission");
        const adminIDs = getAdminBotUIDs();
        if (!adminIDs.includes(String(senderID))) {
          return api.sendMessage("⚠️ Chỉ Admin Bot mới có quyền dùng lệnh này.", threadID, messageID);
        }

        const targetArg = args[1].trim();
        const rented = await execute(
          "SELECT * FROM rented_groups WHERE thread_id NOT IN ('1523319575522034', '844251878447942') ORDER BY expire_date DESC"
        );

        let targetGroup = null;
        let targetIndexStr = "";

        // 1. Nếu targetArg là TID dạng số dài (length >= 10)
        if (/^\d{10,}$/.test(targetArg)) {
          targetGroup = rented.find(g => String(g.thread_id) === targetArg);
          targetIndexStr = `TID ${targetArg}`;
        } else if (!isNaN(targetArg)) {
          // 2. Nếu targetArg là STT
          const idx = parseInt(targetArg);
          if (idx >= 1 && idx <= rented.length) {
            targetGroup = rented[idx - 1];
            targetIndexStr = `STT ${idx}`;
          }
        }

        if (!targetGroup) {
          return api.sendMessage(`❌ Không tìm thấy nhóm nào có TID hoặc STT là "${targetArg}" trong danh sách thuê bot.`, threadID, messageID);
        }

        const targetThreadID = String(targetGroup.thread_id);

        // Xử lý XÓA
        if (subArg === "del" || subArg === "delete") {
          await execute("DELETE FROM rented_groups WHERE thread_id = ?", [targetThreadID]);
          try {
            const { clearRentalCache } = require("../utils/rental");
            clearRentalCache(targetThreadID);
          } catch (e) { }

          try {
            await api.sendMessage("⚠️ Nhóm của bạn đã bị gỡ quyền sử dụng bot do admin hủy thuê.", targetThreadID);
          } catch (e) { }

          return api.sendMessage(`✅ Đã xóa thành công nhóm ${targetIndexStr} (TID: ${targetThreadID}) khỏi danh sách thuê bot.`, threadID, messageID);
        }

        // Xử lý TẠM DỪNG / TIẾP TỤC
        if (["stop", "pause", "start", "resume"].includes(subArg)) {
          const isStopped = !!targetGroup.is_stopped;
          if (!isStopped) {
            // Tạm dừng
            const expireDate = new Date(targetGroup.expire_date);
            const remainingMs = expireDate.getTime() - Date.now();

            if (remainingMs <= 0) {
              return api.sendMessage(`⚠️ Nhóm ${targetIndexStr} (TID: ${targetThreadID}) đã hết hạn, không thể tạm dừng.`, threadID, messageID);
            }

            await execute("UPDATE rented_groups SET is_stopped = 1, paused_remaining_ms = ? WHERE thread_id = ?", [remainingMs, targetThreadID]);
            try {
              const { clearRentalCache } = require("../utils/rental");
              clearRentalCache(targetThreadID);
            } catch (e) { }

            const pDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
            const pHours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

            try {
              await api.sendMessage(`⏸️ [ THÔNG BÁO TẠM DỪNG TÍNH NGÀY ]\n\nNhóm của bạn đã được Admin tạm dừng tính ngày thuê bot.\n⌛ Thời gian còn lại (${pDays} ngày ${pHours} giờ) đã được bảo lưu!`, targetThreadID);
            } catch (e) { }

            return api.sendMessage(`⏸️ ${targetIndexStr} (TID: ${targetThreadID}): Đã TẠM DỪNG tính ngày (Bảo lưu: ${pDays}d ${pHours}h).`, threadID, messageID);
          } else {
            // Mở lại
            const pausedMs = Number(targetGroup.paused_remaining_ms || 0);
            const newExpire = new Date(Date.now() + pausedMs);

            await execute("UPDATE rented_groups SET is_stopped = 0, paused_remaining_ms = 0, expire_date = ? WHERE thread_id = ?", [newExpire, targetThreadID]);
            try {
              const { clearRentalCache } = require("../utils/rental");
              clearRentalCache(targetThreadID);
            } catch (e) { }

            const expireStr = newExpire.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

            try {
              await api.sendMessage(`▶️ [ THÔNG BÁO TIẾP TỤC TÍNH NGÀY ]\n\nNhóm của bạn đã được Admin mở lại đếm ngày thuê bot.\n⏰ Hạn sử dụng mới: ${expireStr}`, targetThreadID);
            } catch (e) { }

            return api.sendMessage(`▶️ ${targetIndexStr} (TID: ${targetThreadID}): Đã TIẾP TỤC tính ngày (Hạn mới: ${expireStr}).`, threadID, messageID);
          }
        }
      }

      if (args && args[0] === "list") {
        const { getAdminBotUIDs } = require("../utils/checkPermission");
        const adminIDs = getAdminBotUIDs();
        if (!adminIDs.includes(String(senderID))) {
          return;
        }
        await sendRentedList(api, threadID, senderID, 1);
        return;
      }

      if (args && args[0] === "lichsu") {
        const { getAdminBotUIDs } = require("../utils/checkPermission");
        const adminIDs = getAdminBotUIDs();
        if (!adminIDs.includes(String(senderID))) {
          return api.sendMessage("⚠️ Chỉ Admin Bot mới có quyền xem lịch sử đơn hàng.", threadID, messageID);
        }
        await sendOrderHistory(api, threadID, senderID, 1);
        return;
      }

      // Xử lý chuyển đổi gói (doigoi)
      if (args && args[0] === "doigoi") {
        const { getAdminBotUIDs, toAdminIdList } = require("../utils/checkPermission");
        const { getRenterID } = require("../utils/rental");
        const adminIDs = getAdminBotUIDs();
        const renterID = await getRenterID(threadID);

        let isAuthorized = adminIDs.includes(String(senderID)) || (renterID && String(senderID) === String(renterID));
        if (!isAuthorized) {
          try {
            const threadInfo = await getThreadInfoCached(api, threadID);
            if (threadInfo) {
              const grAdmins = toAdminIdList(threadInfo);
              if (grAdmins.includes(String(senderID))) {
                isAuthorized = true;
              }
            }
          } catch (e) { }
        }

        if (!isAuthorized) {
          return api.sendMessage(
            "❌ Chỉ có QTV nhóm, Người thuê bot hoặc Admin Bot mới có thể chuyển đổi gói!",
            threadID,
            messageID
          );
        }

        const rentalInfo = await execute(
          "SELECT expire_date, is_admin_rental FROM rented_groups WHERE thread_id = ?",
          [threadID]
        );

        if (!rentalInfo || rentalInfo.length === 0) {
          return api.sendMessage(
            "❌ Nhóm của bạn chưa đăng ký gói thuê bot nào, không thể chuyển đổi gói!",
            threadID,
            messageID
          );
        }

        const isStopped = !!rentalInfo[0].is_stopped;
        const currentIsAdmin = !!rentalInfo[0].is_admin_rental;
        const now = new Date();

        let diffMs = 0;
        let currentExpire = null;

        if (isStopped) {
          diffMs = Number(rentalInfo[0].paused_remaining_ms || 0);
        } else {
          currentExpire = new Date(rentalInfo[0].expire_date);
          if (currentExpire <= now) {
            return api.sendMessage(
              "❌ Hạn thuê bot của nhóm đã hết, vui lòng gia hạn trước khi đổi gói!",
              threadID,
              messageID
            );
          }
          diffMs = currentExpire - now;
        }

        let newIsAdmin = !currentIsAdmin;
        let newDiffMs = currentIsAdmin ? diffMs * 2 : diffMs / 2;
        let newExpire = isStopped ? null : new Date(now.getTime() + newDiffMs);

        const currentPlanName = currentIsAdmin ? "ADMIN-BOT" : "THƯỜNG";
        const newPlanName = newIsAdmin ? "ADMIN-BOT" : "THƯỜNG";

        const isXacNhan = args[1] && (args[1].toLowerCase() === "xacnhan" || args[1].toLowerCase() === "confirm");

        if (!isXacNhan) {
          const currentDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          const newDays = Math.round(newDiffMs / (1000 * 60 * 60 * 24));
          let warnText = currentIsAdmin
            ? `⚠️ Bạn đang dùng gói [${currentPlanName}]. Khi đổi xuống gói [${newPlanName}], thời hạn còn lại sẽ được nhân đôi (x2) từ ${currentDays} ngày thành ${newDays} ngày.`
            : `⚠️ Bạn đang dùng gói [${currentPlanName}]. Khi đổi lên gói [${newPlanName}], thời hạn còn lại sẽ bị chia đôi (chia 2) từ ${currentDays} ngày còn ${newDays} ngày.`;

          const expireText = isStopped
            ? `▪️ Trạng thái: ⏸️ Đang tạm dừng (Bảo lưu mới: ${newDays} ngày)\n`
            : `▪️ Hạn dùng hiện tại: ${currentExpire.toLocaleString("vi-VN")}\n▪️ Hạn dùng mới sau khi đổi: ${newExpire.toLocaleString("vi-VN")}\n`;

          return api.sendMessage(
            `${warnText}\n\n` +
            `${expireText}\n` +
            `👉 Để xác nhận đổi gói, vui lòng gõ:\n` +
            `  ${prefix}thuebot doigoi xacnhan`,
            threadID,
            messageID
          );
        }

        // Thực hiện cập nhật DB
        if (isStopped) {
          await execute(
            "UPDATE rented_groups SET is_admin_rental = ?, paused_remaining_ms = ? WHERE thread_id = ?",
            [newIsAdmin ? 1 : 0, Math.round(newDiffMs), threadID]
          );
        } else {
          await execute(
            "UPDATE rented_groups SET is_admin_rental = ?, expire_date = ? WHERE thread_id = ?",
            [newIsAdmin ? 1 : 0, newExpire, threadID]
          );
        }

        try {
          const { clearRentalCache } = require("../utils/rental");
          clearRentalCache(threadID);
        } catch (e) { }

        // Nếu đổi từ gói admin về gói thường -> chỉnh mode về qtv nếu đang ở adminbot
        let modeDowngradeMsg = "";
        if (currentIsAdmin && !newIsAdmin) {
          try {
            const { readJsonFile, writeJsonFile } = require("../utils/secureFileOps");
            const modeSettingsPath = path.join(__dirname, "../../mode_settings.json");
            const modeSettings = await readJsonFile(modeSettingsPath, {});
            const currentMode = String(modeSettings[String(threadID)] || "qtv").toLowerCase();

            if (currentMode === "adminbot") {
              modeSettings[String(threadID)] = "qtv";
              await writeJsonFile(modeSettingsPath, modeSettings);
              modeDowngradeMsg = `\n🔄 Mode đã tự động chuyển từ ADMINBOT → QTV (do hạ gói về THƯỜNG)`;
            }
          } catch (e) {
            console.error("Lỗi chỉnh mode khi đổi gói:", e);
          }
        }

        const finalDays = Math.round(newDiffMs / (1000 * 60 * 60 * 24));
        const finalExpireStr = isStopped ? `⏸️ Đang tạm dừng (Bảo lưu ${finalDays} ngày)` : newExpire.toLocaleString("vi-VN");

        return api.sendMessage(
          `🎉 ĐỔI GÓI THÀNH CÔNG!\n━━━━━━━━━━━━━\n` +
          `▪️ Gói mới: ${newPlanName}\n` +
          `▪️ Hạn dùng mới: ${finalExpireStr}\n` +
          `▪️ Thời gian còn lại: ${finalDays} ngày\n\n` +
          (newIsAdmin ? `👑 Quyền đổi mode đã được mở khóa cho tất cả QTV nhóm!` : `ℹ️ Quyền đổi mode đã bị khóa lại (chỉ Admin Bot dùng được).`) +
          modeDowngradeMsg,
          threadID,
          messageID
        );
      }

      // Xử lý lệnh hủy giao dịch
      if (args && (args[0] === "huy" || args[0] === "cancel")) {
        const pendingTx = await execute(
          "SELECT id FROM transactions WHERE thread_id = ? AND status = 'pending'",
          [threadID]
        );
        if (pendingTx && pendingTx.length > 0) {
          await execute(
            "UPDATE transactions SET status = 'cancelled', updated_at = datetime('now') WHERE thread_id = ? AND status = 'pending'",
            [threadID]
          );
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
        "SELECT * FROM transactions WHERE thread_id = ? AND status = 'pending' AND created_at > datetime('now', '-15 minutes')",
        [threadID]
      );

      if (existingTx && existingTx.length > 0) {
        return api.sendMessage(
          "⏳ Nhóm này đang có 1 giao dịch thuê bot chờ thanh toán.\n" +
          "Vui lòng thanh toán mã cũ hoặc chờ 15 phút để mã cũ tự động hủy trước khi tạo mã mới!" +
          `\nHoặc bạn có thể dùng ${prefix}thuebot huy để hủy giao dịch hiện tại.`,
          threadID
        );
      }

      // Kiểm tra thời gian còn lại nếu nhóm đã thuê bot
      const isGiaHan = args && args[0] === "giahan";

      if (!isGiaHan) {
        const rentalInfo = await execute(
          "SELECT expire_date, is_admin_rental, is_stopped, paused_remaining_ms FROM rented_groups WHERE thread_id = ?",
          [threadID]
        );

        if (rentalInfo && rentalInfo.length > 0) {
          const isStopped = !!rentalInfo[0].is_stopped;
          const currentPlanName = !!rentalInfo[0].is_admin_rental ? "ADMIN-BOT" : "THƯỜNG";

          if (isStopped) {
            const pausedMs = Number(rentalInfo[0].paused_remaining_ms || 0);
            const pDays = Math.floor(pausedMs / (1000 * 60 * 60 * 24));
            const pHours = Math.floor((pausedMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const pMins = Math.floor((pausedMs % (1000 * 60 * 60)) / (1000 * 60));

            let pTimeText = "";
            if (pDays > 0) pTimeText += `${pDays} ngày `;
            if (pHours > 0) pTimeText += `${pHours} giờ `;
            if (pMins > 0) pTimeText += `${pMins} phút`;

            return api.sendMessage(
              `✅ Nhóm này đã thuê bot (Gói: ${currentPlanName}).\n\n` +
              `⏸️ Trạng thái: ĐANG TẠM DỪNG TÍNH NGÀY\n` +
              `📅 Thời gian được bảo lưu: ${pTimeText.trim() || "0 phút"}\n\n` +
              `👉 Để gia hạn thêm, vui lòng gõ:\n` +
              `  ${prefix}thuebot giahan\n` +
              `👉 Để đổi gói (ADMIN-BOT ⇄ THƯỜNG), vui lòng gõ:\n` +
              `  ${prefix}thuebot doigoi`,
              threadID
            );
          }

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
              `✅ Nhóm này đã thuê bot (Gói: ${currentPlanName}).\n\n` +
              `📅 Thời gian còn lại: ${timeText.trim()}\n` +
              `⏰ Hết hạn: ${expireDate.toLocaleString("vi-VN")}\n\n` +
              `👉 Để gia hạn thêm, vui lòng gõ:\n` +
              `  ${prefix}thuebot giahan\n` +
              `👉 Để đổi gói (ADMIN-BOT ⇄ THƯỜNG), vui lòng gõ:\n` +
              `  ${prefix}thuebot doigoi`,
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
      }
    } catch (e) {
      console.error("Lỗi kiểm tra CSDL thuebot:", e);
    }


    const menuMessage =
      `--- 💸 BẢNG GIÁ THUÊ BOT 💸 ---\n\n` +
      `[ THUÊ BOT THƯỜNG ]\n` +
      `1️⃣ 1 Tháng - 25,000 VNĐ\n` +
      `2️⃣ 3 Tháng - 70,000 VNĐ\n` +
      `3️⃣ 6 Tháng - 140,000 VNĐ\n` +
      `4️⃣ 1 Năm  - 275,000 VNĐ\n\n` +
      `[ THUÊ KÈM QUYỀN ADMIN-BOT ]\n` +
      `(Có thể dùng lệnh mode để các TV dùng lệnh, không bị cấm)\n` +
      `5️⃣ 1 Tháng - 50,000 VNĐ\n` +
      `6️⃣ 3 Tháng - 140,000 VNĐ\n` +
      `7️⃣ 6 Tháng - 280,000 VNĐ\n` +
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

  async handleReply({ api, event, config, handleReply: passedHandleReply }) {
    const { threadID, messageID, senderID, body, messageReply } = event;
    const prefix = config?.prefix || "!";
    if (!messageReply || !messageReply.messageID) return;

    const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
    const handleReply = passedHandleReply || list.find(h => String(h.messageID) === String(messageReply.messageID) && h.name === "thuebot");
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
          "SELECT * FROM transactions WHERE thread_id = ? AND status = 'pending' AND created_at > datetime('now', '-15 minutes')",
          [threadID]
        );

        if (existingTx && existingTx.length > 0) {
          return api.sendMessage(
            "⏳ Nhóm này đang có 1 giao dịch thuê bot chờ thanh toán.\n" +
            "Vui lòng thanh toán mã cũ hoặc chờ 15 phút để mã cũ tự động hủy trước khi tạo mã mới!" +
            `Bạn cũng có thể dùng ${prefix}thuebot huy để hủy giao dịch ngay lập tức.`,
            threadID,
            messageID
          );
        }

        // Lấy tên nhóm để lưu vào lịch sử
        let groupName = "";
        try {
          const threadInfo = await getThreadInfoCached(api, threadID);
          groupName = threadInfo?.name || threadInfo?.threadName || "";
        } catch (e) {}

        await ensureTransactionsSchema();
        await execute(
          "INSERT INTO transactions (transaction_code, amount, thread_id, user_id, status, group_name, plan_name, months) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [transactionCode, amount, threadID, senderID, "pending", groupName, planName, months]
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
        } catch (e) { }

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
      const stopMatch = trimmed.match(/^(?:stop|pause|start|resume)\s+([\d\s,]+)$/i);
      const giahanMatch = trimmed.match(
        /^giahan\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(\d+))?$/i
      );
      const pageMatch = trimmed.match(/^page\s+(\d+)$/i);

      if (!delMatch && !stopMatch && !giahanMatch && !pageMatch) {
        return api.sendMessage(
          "⚠️ Cú pháp phản hồi không hợp lệ!\n" +
          "👉 del <Số thứ tự> để xóa nhóm\n" +
          "👉 stop <Số thứ tự> để tạm dừng / tiếp tục tính ngày\n" +
          "👉 giahan <Số thứ tự> <thuong/admin> <thời gian: 30d/1m>\n" +
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
            "SELECT * FROM rented_groups WHERE thread_id NOT IN ('1523319575522034', '844251878447942') ORDER BY expire_date DESC"
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
          } catch (err) { }

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
            "SELECT * FROM rented_groups WHERE thread_id NOT IN ('1523319575522034', '844251878447942') ORDER BY expire_date DESC"
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
            } catch (e) { }

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
          } catch (e) { }

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

      // XỬ LÝ TẠM DỪNG / TIẾP TỤC TÍNH NGÀY
      if (stopMatch) {
        const choices = stopMatch[1]
          .split(/[\s,]+/)
          .map(s => parseInt(s))
          .filter(n => !isNaN(n));

        if (choices.length === 0) {
          return api.sendMessage("❌ Cú pháp tạm dừng không hợp lệ.", threadID, messageID);
        }

        try {
          const rented = await execute(
            "SELECT * FROM rented_groups WHERE thread_id NOT IN ('1523319575522034', '844251878447942') ORDER BY expire_date DESC"
          );

          const invalidChoices = choices.filter(c => c < 1 || c > rented.length);
          if (invalidChoices.length > 0) {
            return api.sendMessage(
              `❌ Số thứ tự nhóm không tồn tại trong danh sách: ${invalidChoices.join(", ")}`,
              threadID,
              messageID
            );
          }

          const results = [];
          for (const choice of choices) {
            const targetGroup = rented[choice - 1];
            const targetThreadID = targetGroup.thread_id;
            const isStopped = !!targetGroup.is_stopped;

            if (!isStopped) {
              // Tạm dừng tính ngày
              const expireDate = new Date(targetGroup.expire_date);
              const now = Date.now();
              const remainingMs = expireDate.getTime() - now;

              if (remainingMs <= 0) {
                results.push(`⚠️ STT ${choice} (TID: ${targetThreadID}) đã hết hạn, không thể tạm dừng.`);
                continue;
              }

              await execute(
                "UPDATE rented_groups SET is_stopped = 1, paused_remaining_ms = ? WHERE thread_id = ?",
                [remainingMs, targetThreadID]
              );

              try {
                const { clearRentalCache } = require("../utils/rental");
                clearRentalCache(targetThreadID);
              } catch (e) { }

              const pDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
              const pHours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
              results.push(`⏸️ STT ${choice} (TID: ${targetThreadID}): Đã TẠM DỪNG tính ngày (Bảo lưu: ${pDays}d ${pHours}h).`);

              try {
                await api.sendMessage(
                  `⏸️ [ THÔNG BÁO TẠM DỪNG TÍNH NGÀY ]\n\nNhóm của bạn đã được Admin tạm dừng tính ngày thuê bot.\n⌛ Thời gian còn lại (${pDays} ngày ${pHours} giờ) đã được bảo lưu!`,
                  targetThreadID
                );
              } catch (e) { }
            } else {
              // Mở lại / tiếp tục tính ngày
              const pausedMs = Number(targetGroup.paused_remaining_ms || 0);
              const newExpire = new Date(Date.now() + pausedMs);

              await execute(
                "UPDATE rented_groups SET is_stopped = 0, paused_remaining_ms = 0, expire_date = ? WHERE thread_id = ?",
                [newExpire, targetThreadID]
              );

              try {
                const { clearRentalCache } = require("../utils/rental");
                clearRentalCache(targetThreadID);
              } catch (e) { }

              const expireStr = newExpire.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
              results.push(`▶️ STT ${choice} (TID: ${targetThreadID}): Đã TIẾP TỤC tính ngày (Hạn mới: ${expireStr}).`);

              try {
                await api.sendMessage(
                  `▶️ [ THÔNG BÁO TIẾP TỤC TÍNH NGÀY ]\n\nNhóm của bạn đã được Admin mở lại đếm ngày thuê bot.\n⏰ Hạn sử dụng mới: ${expireStr}`,
                  targetThreadID
                );
              } catch (e) { }
            }
          }

          // Gỡ tin nhắn list cũ
          try {
            await api.unsendMessage(handleReply.messageID);
          } catch (e) { }

          // Xóa handleReply
          const list = global.client.handleReply || [];
          const idx = list.findIndex(h => h.messageID === handleReply.messageID);
          if (idx > -1) list.splice(idx, 1);

          return api.sendMessage(
            `📋 XỬ LÝ TẠM DỪNG / TIẾP TỤC TÍNH NGÀY THÀNH CÔNG:\n━━━━━━━━━━━━━\n` +
            results.join("\n"),
            threadID,
            messageID
          );
        } catch (e) {
          console.error(e);
          return api.sendMessage("❌ Lỗi khi cập nhật trạng thái tạm dừng tính ngày.", threadID, messageID);
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
            "SELECT * FROM rented_groups WHERE thread_id NOT IN ('1523319575522034', '844251878447942') ORDER BY expire_date DESC"
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
          if (targetGroup.is_stopped) {
            const addMs = daysToAdd * 24 * 60 * 60 * 1000;
            const newPausedMs = Number(targetGroup.paused_remaining_ms || 0) + addMs;
            await execute(
              "UPDATE rented_groups SET paused_remaining_ms = ?, renter_id = ?, rented_at = datetime('now'), is_admin_rental = ? WHERE thread_id = ?",
              [newPausedMs, senderID, isAdminPlan ? 1 : 0, targetThreadID]
            );
          } else {
            await execute(
              `
              INSERT INTO rented_groups (thread_id, expire_date, renter_id, rented_at, is_admin_rental, is_stopped, paused_remaining_ms)
              VALUES (?, datetime('now', '+' || ? || ' day'), ?, datetime('now'), ?, 0, 0)
              ON CONFLICT(thread_id) DO UPDATE SET
                expire_date = datetime(max(coalesce(expire_date, datetime('now')), datetime('now')), '+' || ? || ' day'),
                renter_id = ?,
                rented_at = datetime('now'),
                is_admin_rental = ?
            `,
              [targetThreadID, daysToAdd, senderID, isAdminPlan ? 1 : 0, daysToAdd, senderID, isAdminPlan ? 1 : 0]
            );
          }

          // Clear cache
          try {
            const { clearRentalCache } = require("../utils/rental");
            clearRentalCache(targetThreadID);
          } catch (e) { }

          // Lấy hạn sử dụng mới
          const info = await execute(
            "SELECT expire_date, is_stopped, paused_remaining_ms FROM rented_groups WHERE thread_id = ?",
            [targetThreadID]
          );
          let expireStr = "Không rõ";
          if (info && info.length > 0) {
            if (info[0].is_stopped) {
              const pMs = Number(info[0].paused_remaining_ms || 0);
              const pDays = Math.floor(pMs / (1000 * 60 * 60 * 24));
              const pHours = Math.floor((pMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
              expireStr = `⏸️ Đang tạm dừng (Bảo lưu: ${pDays} ngày ${pHours} giờ)`;
            } else {
              const date = new Date(info[0].expire_date);
              expireStr = date.toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh"
              });
            }
          }

          // Cấp quyền Admin Bot nếu là gói admin
          let adminGrantedMsg = "";
          if (isAdminPlan) {
            adminGrantedMsg = `\n👑 Quyền đổi mode đã được mở khóa cho tất cả QTV nhóm!`;
          }

          // Nếu gia hạn từ gói admin về gói thường -> chỉnh mode về qtv nếu đang ở adminbot
          let modeDowngradeMsg = "";
          const wasAdminPlan = !!targetGroup.is_admin_rental;
          if (wasAdminPlan && !isAdminPlan) {
            try {
              const { readJsonFile, writeJsonFile } = require("../utils/secureFileOps");
              const modeSettingsPath = path.join(__dirname, "../../mode_settings.json");
              const modeSettings = await readJsonFile(modeSettingsPath, {});
              const currentMode = String(modeSettings[targetThreadID] || "qtv").toLowerCase();

              if (currentMode === "adminbot") {
                modeSettings[targetThreadID] = "qtv";
                await writeJsonFile(modeSettingsPath, modeSettings);
                modeDowngradeMsg = `\n🔄 Mode đã tự động chuyển từ ADMINBOT → QTV (do hạ gói về THƯỜNG)`;
              }
            } catch (e) {
              console.error("Lỗi chỉnh mode khi gia hạn đổi gói:", e);
            }
          }

          // Gỡ tin nhắn list cũ
          try {
            await api.unsendMessage(handleReply.messageID);
          } catch (e) { }

          // Xóa handleReply
          const list = global.client.handleReply || [];
          const idx = list.findIndex(h => h.messageID === handleReply.messageID);
          if (idx > -1) list.splice(idx, 1);

          // Thông báo cho nhóm được gia hạn
          let notifyMsg =
            `🎉 [ THÔNG BÁO GIA HẠN ] 🎉\n\n` +
            `Nhóm của bạn đã được Admin gia hạn thêm ${timeStr} sử dụng Bot.\n` +
            `⏰ Hạn sử dụng mới: ${expireStr}${adminGrantedMsg}${modeDowngradeMsg}\n` +
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
          if (modeDowngradeMsg) {
            adminMsg += modeDowngradeMsg;
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

    // 3. XỬ LÝ PHẢN HỒI LỊCH SỬ ĐƠN HÀNG
    if (handleReply.type === "order_history") {
      const { getAdminBotUIDs } = require("../utils/checkPermission");
      const adminIDs = getAdminBotUIDs();
      if (!adminIDs.includes(String(senderID))) return;

      const trimmed = String(body || "").trim();
      const pageMatch = trimmed.match(/^page\s+(\d+)$/i);

      if (!pageMatch) {
        return api.sendMessage(
          `📖 Reply "page <số trang>" để chuyển trang lịch sử đơn hàng.`,
          threadID,
          messageID
        );
      }

      const newPage = parseInt(pageMatch[1]);
      if (isNaN(newPage) || newPage < 1) {
        return api.sendMessage("❌ Số trang không hợp lệ.", threadID, messageID);
      }

      // Gỡ tin nhắn cũ
      try {
        await api.unsendMessage(handleReply.messageID);
      } catch (e) {}

      // Xóa handleReply cũ
      const hrList = global.client.handleReply || [];
      const hrIdx = hrList.findIndex(h => h.messageID === handleReply.messageID);
      if (hrIdx > -1) hrList.splice(hrIdx, 1);

      await sendOrderHistory(api, threadID, senderID, newPage);
    }
  }
};
