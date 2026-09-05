const { checkCooldown } = require("../../utils/cooldown");
const {
  SEPARATOR,
  fetchPTGRoleName,
  addPTGAccount,
  delPTGAccount,
  getAccountsByUser,
  getActiveGiftcodes,
  autoRedeemCodeForUser,
  autoRedeemAllCodesForUser,
  addGiftcode,
  extractGiftcodesFromText,
  getThreadSettings,
  updateThreadSettings
} = require("../../utils/ptgHelper");
const { startPTGScheduler } = require("../../utils/ptgScheduler");

// Khởi tạo scheduler chạy nền
startPTGScheduler();

module.exports = {
  name: "ptg",
  aliases: ["codeptg", "playtogether"],
  category: "tools",
  description: "Bộ công cụ hỗ trợ game Play Together: Quản lý ID tài khoản & Nhập Giftcode tự động",
  usage: `\n{prefix}ptg → Xem menu hướng dẫn\n{prefix}ptg list → Xem danh sách ID tài khoản PTG đã lưu\n{prefix}ptg add <id> → Lưu ID tài khoản PTG (tự động lấy tên nhân vật)\n{prefix}ptg del <id> → Xóa ID tài khoản đã lưu\n{prefix}ptg code [giftcode/all] → Tra cứu hoặc nhập giftcode cho các tài khoản\n{prefix}ptg addcode <code> [quà] → Thêm giftcode mới vào bot\n{prefix}ptg notify [on/off] → Bật/tắt tự động bắt giftcode cho nhóm`,
  permission: 0,
  cooldowns: 2,

  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;
    const prefix = config?.prefix || "!";

    // Cooldown 2s
    const cd = checkCooldown({ command: "ptg", key: senderID, durationMs: 2000 });
    if (!cd.allowed) {
      return api.sendMessage(`⏳ Vui lòng đợi ${cd.timeLeft}s trước khi tiếp tục.`, threadID, messageID);
    }

    const sub = String(args[0] || "").trim().toLowerCase();

    // 1. LỆNH LIST: Xem danh sách ID đã nhập
    if (sub === "list") {
      const userAccounts = await getAccountsByUser(senderID);

      if (userAccounts.length === 0) {
        return api.sendMessage(
          `🎮 TÀI KHOẢN PLAY TOGETHER\n${SEPARATOR}\n❌ Bạn chưa lưu tài khoản Play Together nào!\n💡 Dùng lệnh: ${prefix}ptg add <ID_Game> để thêm tài khoản.`,
          threadID,
          messageID
        );
      }

      let msg = `🎮 DANH SÁCH TÀI KHOẢN PLAY TOGETHER\n${SEPARATOR}\n📦 Đã liên kết: ${userAccounts.length} tài khoản\n${SEPARATOR}\n`;
      userAccounts.forEach((acc, index) => {
        const ptgName = acc.nickname ? `🎮 ${acc.nickname}` : `🎮 Chưa đặt tên`;
        msg += `${index + 1}. ${ptgName} (ID: ${acc.ptg_id})\n`;
      });
      msg += `${SEPARATOR}\n💡 Reply (phản hồi) số thứ tự (hoặc "del <số>") để xóa nhanh ID!`;

      return api.sendMessage(msg, threadID, (err, info) => {
        if (!err && info?.messageID) {
          if (!global.client) global.client = {};
          if (!global.client.handleReply) global.client.handleReply = [];
          global.client.handleReply.push({
            name: "ptg",
            messageID: info.messageID,
            author: senderID,
            type: "list_reply",
            accounts: userAccounts
          });
        }
      }, messageID);
    }

    // 2. LỆNH ADD: Thêm ID tài khoản (Tự động tra cứu tên nhân vật qua API VNG)
    if (sub === "add") {
      const ptgId = args[1];
      if (!ptgId) {
        return api.sendMessage(
          `❌ Vui lòng nhập ID Play Together cần thêm!\n👉 Cú pháp: ${prefix}ptg add <ID_Game>\nVí dụ: ${prefix}ptg add RJHD-ZT9L-LMYY`,
          threadID,
          messageID
        );
      }

      let nickname = args.slice(2).join(" ").trim() || null;

      // Nếu user không nhập tên -> Tự động tra cứu tên nhân vật từ API VNG
      if (!nickname) {
        const lookup = await fetchPTGRoleName(ptgId);
        if (lookup.success && lookup.roleName) {
          nickname = lookup.roleName;
        }
      }

      const res = await addPTGAccount(senderID, ptgId, nickname, "vng");

      if (res.success) {
        const ptgNameLine = nickname ? `🎮 Tên Ingame: ${nickname}\n` : "";
        return api.sendMessage(
          `✅ Đã lưu thành công tài khoản Play Together!\n${SEPARATOR}\n${ptgNameLine}🆔 ID Game: ${res.ptgId}\n${SEPARATOR}\n💡 Dùng ${prefix}ptg list để xem lại danh sách.`,
          threadID,
          messageID
        );
      } else {
        return api.sendMessage(`❌ Thêm ID thất bại: ${res.reason || "Lỗi không xác định"}`, threadID, messageID);
      }
    }

    // 3. LỆNH DEL: Xóa ID tài khoản
    if (sub === "del" || sub === "delete" || sub === "remove") {
      const ptgId = args[1];
      if (!ptgId) {
        return api.sendMessage(
          `❌ Vui lòng nhập ID cần xóa!\n👉 Cú pháp: ${prefix}ptg del <ID_Tài_Khoản>`,
          threadID,
          messageID
        );
      }

      const res = await delPTGAccount(senderID, ptgId);
      if (res.success) {
        return api.sendMessage(`✅ Đã xóa thành công tài khoản ID "${ptgId}" khỏi danh sách.`, threadID, messageID);
      } else {
        return api.sendMessage(`❌ Không tìm thấy tài khoản ID "${ptgId}" trong danh sách của bạn.`, threadID, messageID);
      }
    }

    // 4. LỆNH CODE / REDEEM: Tra cứu giftcode hoặc nhập giftcode
    if (sub === "code" || sub === "redeem" || sub === "giftcode") {
      const inputCode = args[1];

      // Nếu không nhập mã code -> Hiển thị danh sách giftcode còn hạn
      if (!inputCode) {
        const codes = await getActiveGiftcodes();
        if (codes.length === 0) {
          return api.sendMessage(
            `🎁 PLAY TOGETHER • GIFTCODE\n${SEPARATOR}\nHiện tại chưa có giftcode mới nào trong hệ thống.\n💡 Bạn có thể đóng góp mã mới bằng: ${prefix}ptg addcode <MÃ> [Phần thưởng]`,
            threadID,
            messageID
          );
        }

        let msg = `🎁 PLAY TOGETHER • GIFTCODE CÒN HẠN\n${SEPARATOR}\n`;
        codes.forEach((c, idx) => {
          const exp = c.expires_at ? ` (Hạn: ${c.expires_at})` : "";
          msg += `${idx + 1}. 🔑 ${c.code}\n   💎 ${c.description || "Quà tặng sự kiện"}${exp}\n   🔗 playtogether://coupon?code=${c.code}\n\n`;
        });
        msg += `${SEPARATOR}\n💡 Chạm trực tiếp vào link playtogether://... trên điện thoại để nhận quà ngay vào hòm thư!`;

        return api.sendMessage(msg.trim(), threadID, messageID);
      }

      // Nhập TẤT CẢ giftcode cho tài khoản
      if (inputCode.toLowerCase() === "all" || inputCode.toLowerCase() === "nhapall") {
        const userAccounts = await getAccountsByUser(senderID);
        if (userAccounts.length === 0) {
          return api.sendMessage(
            `❌ Bạn chưa lưu tài khoản Play Together nào!\n💡 Dùng lệnh: ${prefix}ptg add <ID_Game> để thêm tài khoản trước.`,
            threadID,
            messageID
          );
        }

        api.sendMessage(`⏳ Đang tự động nhập tất cả Giftcode cho ${userAccounts.length} tài khoản của bạn...`, threadID);
        const res = await autoRedeemAllCodesForUser(senderID);
        let msg = `🎁 KẾT QUẢ NHẬP TẤT CẢ GIFTCODE\n${SEPARATOR}\n`;

        for (const item of res.summary || []) {
          const accName = item.account.nickname ? `🎮 ${item.account.nickname}` : `🆔 ID: ${item.account.ptg_id}`;
          msg += `${accName}:\n`;
          for (const cr of item.codeResults) {
            const icon = cr.success ? "✅" : cr.isClaimed ? "⚠️" : "❌";
            msg += `• [${cr.code}]: ${icon} ${cr.message}\n`;
          }
          msg += `${SEPARATOR}\n`;
        }
        msg += `💡 Kiểm tra Hộp Thư trong game Play Together để nhận quà!`;
        return api.sendMessage(msg.trim(), threadID, messageID);
      }

      // Nhập 1 giftcode cụ thể cho tài khoản
      const cleanCode = inputCode.trim().toUpperCase();
      const userAccounts = await getAccountsByUser(senderID);

      if (userAccounts.length === 0) {
        return api.sendMessage(
          `🎁 PLAY TOGETHER • GIFTCODE\n${SEPARATOR}\n🔑 Mã quà: ${cleanCode}\n⚠️ Bạn chưa lưu ID tài khoản nào (${prefix}ptg add <ID>)\n${SEPARATOR}\n🔗 Mở nhận 1-chạm:\nplaytogether://coupon?code=${cleanCode}\n🌐 Web VNG:\nhttps://levelup.vnggames.com/`,
          threadID,
          messageID
        );
      }

      const redeemRes = await autoRedeemCodeForUser(senderID, cleanCode);
      let msg = `🎁 KẾT QUẢ NHẬP GIFTCODE\n${SEPARATOR}\n🔑 Mã quà: ${cleanCode}\n${SEPARATOR}\n`;
      for (const r of redeemRes.results) {
        const accName = r.account.nickname ? `🎮 ${r.account.nickname}` : `🆔 ID: ${r.account.ptg_id}`;
        const icon = r.success ? "✅" : r.isClaimed ? "⚠️" : "❌";
        msg += `${accName} (ID: ${r.account.ptg_id}):\n${icon} ${r.message}\n\n`;
      }
      msg += `${SEPARATOR}\n🔗 Hoặc nhận 1-chạm:\nplaytogether://coupon?code=${cleanCode}`;

      return api.sendMessage(msg.trim(), threadID, messageID);
    }

    // 5. LỆNH ADDCODE: Thêm giftcode mới vào kho bot
    if (sub === "addcode") {
      const code = args[1];
      if (!code) {
        return api.sendMessage(
          `❌ Vui lòng nhập mã Giftcode cần thêm!\n👉 Cú pháp: ${prefix}ptg addcode <MÃ_CODE> [Phần_Thưởng]`,
          threadID,
          messageID
        );
      }

      const desc = args.slice(2).join(" ").trim() || "Quà tặng Play Together";
      const res = await addGiftcode(code, desc, `Player`);

      if (res.success) {
        return api.sendMessage(
          `✅ Đã thêm Giftcode mới vào hệ thống!\n${SEPARATOR}\n🔑 Mã: ${res.code}\n💎 Phần thưởng: ${desc}\n💡 Các thành viên trong nhóm có thể dùng: ${prefix}ptg code ${res.code}`,
          threadID,
          messageID
        );
      } else if (res.isDuplicate) {
        return api.sendMessage(`⚠️ Mã code "${res.code}" đã có sẵn trong hệ thống từ trước.`, threadID, messageID);
      } else {
        return api.sendMessage(`❌ Thêm code thất bại: ${res.reason || "Lỗi không xác định"}`, threadID, messageID);
      }
    }

    // 6. LỆNH NOTIFY: Bật / tắt thông báo tự động bắt Giftcode
    if (sub === "notify" || sub === "thongbao") {
      const status = String(args[1] || "").toLowerCase();

      if (!status) {
        const cur = await getThreadSettings(threadID);
        const st = cur.notify_code ? "🟢 BẬT" : "🔴 TẮT";
        const notifyMsg = `🔔 CẤU HÌNH THÔNG BÁO PLAY TOGETHER\n${SEPARATOR}\n🎁 Tự động bắt giftcode: ${st}\n${SEPARATOR}\n👉 Cú pháp: ${prefix}ptg notify on (hoặc off)`;

        return api.sendMessage(notifyMsg, threadID, messageID);
      }

      const isEnable = status === "on" || status === "1" || status === "bat" || status === "bật";
      const isDisable = status === "off" || status === "0" || status === "tat" || status === "tắt";

      if (!isEnable && !isDisable) {
        return api.sendMessage(`❌ Trạng thái không hợp lệ! Vui lòng chọn "on" hoặc "off".\nVí dụ: ${prefix}ptg notify on`, threadID, messageID);
      }

      await updateThreadSettings(threadID, { notify_code: isEnable ? 1 : 0 });
      const textStatus = isEnable ? "BẬT" : "TẮT";

      return api.sendMessage(
        `✅ Đã ${textStatus} tính năng tự động nhận diện Giftcode cho nhóm này!`,
        threadID,
        messageID
      );
    }

    // MENU HƯỚNG DẪN MẶC ĐỊNH
    const menuMsg = `🎮 HỖ TRỢ PLAY TOGETHER • GIFTCODE\n${SEPARATOR}\n1. ${prefix}ptg list → Danh sách ID tài khoản đã lưu\n2. ${prefix}ptg add <ID> → Thêm ID (tự lấy tên nhân vật)\n3. ${prefix}ptg del <ID> → Xóa ID tài khoản\n4. ${prefix}ptg code → Xem danh sách Giftcode còn hạn\n5. ${prefix}ptg code all → Tự động nhập tất cả Code vào game\n6. ${prefix}ptg addcode <Mã> → Đóng góp Giftcode mới\n7. ${prefix}ptg notify on/off → Bật/tắt tự bắt Giftcode\n${SEPARATOR}\n💡 Reply (phản hồi) số từ 1 đến 5 để thao tác nhanh!`;

    return api.sendMessage(menuMsg, threadID, (err, info) => {
      if (!err && info?.messageID) {
        if (!global.client) global.client = {};
        if (!global.client.handleReply) global.client.handleReply = [];
        global.client.handleReply.push({
          name: "ptg",
          messageID: info.messageID,
          author: senderID,
          type: "menu_reply"
        });
      }
    }, messageID);
  },

  // Tự động nhận diện Giftcode từ các tin nhắn trong nhóm
  handleEvent: async ({ api, event, config }) => {
    const { threadID, messageID, senderID, body } = event;
    if (!body || typeof body !== "string" || senderID === api.getCurrentUserID()) return;

    // Không bắt nếu tin nhắn bắt đầu bằng prefix lệnh
    const prefix = config?.prefix || "!";
    if (body.startsWith(prefix)) return;

    // Quét phát hiện giftcode PTG
    const extractedCodes = extractGiftcodesFromText(body);
    if (extractedCodes.length === 0) return;

    const settings = await getThreadSettings(threadID);
    if (settings.notify_code === 0) return;

    for (const code of extractedCodes) {
      // Thêm vào database nếu là code mới
      await addGiftcode(code, "Tự động phát hiện từ nhóm", `Thread ${threadID}`);

      // Lấy danh sách ID đã lưu của người gửi để tự động nhập
      const userAccounts = await getAccountsByUser(senderID);
      let redeemInfo = "";

      if (userAccounts.length > 0) {
        const redeemRes = await autoRedeemCodeForUser(senderID, code);
        redeemInfo += `🚀 Kết quả tự động nhập quà:\n`;
        for (const r of redeemRes.results) {
          const accName = r.account.nickname ? `🎮 ${r.account.nickname}` : `🆔 ID: ${r.account.ptg_id}`;
          const icon = r.success ? "✅" : r.isClaimed ? "⚠️" : "❌";
          redeemInfo += `• ${accName}: ${icon} ${r.message}\n`;
        }
      } else {
        redeemInfo += `📦 Đã lưu mã quà mới vào kho Play Together.\n💡 Bạn chưa liên kết tài khoản (${prefix}ptg add <ID>)\n`;
      }

      const msg = `🎁 PHÁT HIỆN GIFTCODE PLAY TOGETHER\n${SEPARATOR}\n🔑 Mã quà: ${code}\n${SEPARATOR}\n${redeemInfo}${SEPARATOR}\n🔗 Mở nhận 1-chạm:\nplaytogether://coupon?code=${code}\n🌐 Web VNG:\nhttps://levelup.vnggames.com/`;

      api.sendMessage(msg.trim(), threadID, messageID);
    }
  },

  // Xử lý reply
  handleReply: async ({ api, event, handleReply, config, Users }) => {
    const { threadID, messageID, senderID, body } = event;
    const prefix = config?.prefix || "!";
    const text = String(body || "").trim();

    // Bắt buộc phải có handleReply context của chính lệnh ptg
    if (!handleReply || handleReply.name !== "ptg") return;

    // 1. Xử lý Reply xóa nhanh ID từ lệnh !ptg list
    if (handleReply.type === "list_reply") {
      if (senderID !== handleReply.author) {
        return api.sendMessage("⚠️ Chỉ người xem danh sách mới có quyền thao tác xóa tài khoản này!", threadID, messageID);
      }

      const lower = text.toLowerCase();
      // Xóa tất cả nếu nhập "all" hoặc "del all" hoặc "xoa all"
      if (lower === "all" || lower === "del all" || lower === "xoa all" || lower === "xóa all") {
        const accs = handleReply.accounts || [];
        for (const acc of accs) {
          await delPTGAccount(senderID, acc.ptg_id);
        }
        return api.sendMessage(`✅ Đã xóa toàn bộ ${accs.length} tài khoản Play Together của bạn thành công!`, threadID, messageID);
      }

      // Bóc tách các số thứ tự được gửi (hỗ trợ "1", "del 1", "xoa 1 2", "1, 2")
      const nums = text.match(/\d+/g);
      if (!nums || nums.length === 0) {
        return api.sendMessage(`❌ Vui lòng phản hồi số thứ tự tài khoản cần xóa (ví dụ: 1 hoặc del 1).`, threadID, messageID);
      }

      const accs = handleReply.accounts || [];
      const deletedList = [];

      for (const n of nums) {
        const idx = parseInt(n, 10) - 1;
        if (idx >= 0 && idx < accs.length) {
          const target = accs[idx];
          const res = await delPTGAccount(senderID, target.ptg_id);
          if (res.success) {
            const nameStr = target.nickname ? `🎮 ${target.nickname} (ID: ${target.ptg_id})` : `ID: ${target.ptg_id}`;
            deletedList.push(nameStr);
          }
        }
      }

      if (deletedList.length > 0) {
        return api.sendMessage(
          `✅ Đã xóa thành công tài khoản: ${deletedList.join(", ")} khỏi danh sách!\n💡 Dùng ${prefix}ptg list để xem lại danh sách.`,
          threadID,
          messageID
        );
      } else {
        return api.sendMessage(`❌ Số thứ tự không hợp lệ trong danh sách!`, threadID, messageID);
      }
    }

    // 2. Xử lý Reply Menu chính
    if (handleReply.type === "menu_reply") {
      // Dọn dẹp context khỏi cache sau khi chọn
      if (global.client && Array.isArray(global.client.handleReply)) {
        const idx = global.client.handleReply.findIndex(h => String(h.messageID) === String(handleReply.messageID));
        if (idx > -1) global.client.handleReply.splice(idx, 1);
      }

      const choice = text;
      if (choice === "1") {
        return module.exports.execute({ api, event: { ...event, senderID }, args: ["list"], config, Users });
      } else if (choice === "2") {
        return api.sendMessage(`👉 Cú pháp: ${prefix}ptg add <ID_Game>\nVí dụ: ${prefix}ptg add RJHD-ZT9L-LMYY`, threadID, messageID);
      } else if (choice === "3") {
        return api.sendMessage(`👉 Cú pháp: ${prefix}ptg del <ID_Tài_Khoản>`, threadID, messageID);
      } else if (choice === "4") {
        return module.exports.execute({ api, event: { ...event, senderID }, args: ["code"], config, Users });
      } else if (choice === "5") {
        return module.exports.execute({ api, event: { ...event, senderID }, args: ["code", "all"], config, Users });
      }
    }
  }
};
