const { checkCooldown } = require("../../utils/cooldown");

module.exports = {
  name: "huongdan",
  description: "Hướng dẫn người chơi mới bắt đầu chơi",
  usage:
    "\n!huongdan → Hướng dẫn tổng quan cho người mới\n!huongdan chitiet → Hướng dẫn chi tiết từng hệ thống\n━━━━━━━━━━━━━\n📚 Giải thích cách chơi, kiếm tiền, minigame",
  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;
    const prefix = config?.prefix || "!";

    // Cooldown 5s
    const cooldown = checkCooldown({
      command: "huongdan",
      key: senderID,
      durationMs: 5000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    try {
      const mode = String(args?.[0] || "").toLowerCase();

      // 1. HƯỚNG DẪN TỔNG QUAN
      if (!mode || mode === "all") {
        const totalMsg = `🎮 HƯỚNG DẪN NGƯỜI CHƠI MỚI
━━━━━━━━━━━━━━━━━━━
👋 ** BƯỚC 1: TẠO TÀI KHOẢN **
Gõ lệnh: ${prefix}tien
→ Tạo tài khoản và nhận 10k credits đầu tiên.

💰 ** BƯỚC 2: KIẾM TIỀN **
${prefix}lamviec - Làm việc kiếm 10k~100k (có xui/may)
${prefix}diemdanh - Điểm danh hàng ngày nhận thưởng
${prefix}quest - Nhận quest hàng ngày
${prefix}cuop - Cướp tiền (nguy hiểm, có thể mất tiền)

🏦 ** BƯỚC 3: QUẢN LÝ TIỀN **
${prefix}bank - Xem số dư ngân hàng
${prefix}chuyentien [@tên] [số tiền] - Chuyển tiền cho bạn
${prefix}vay [số tiền] - Vay tiền (phải trả lãi)

🎯 ** BƯỚC 4: CHƠI CÁC TRÒ CHƠI **
${prefix}taixiu - Game tài xỉu (cược tiền)
${prefix}baucua - Game bầu cua (cược tiền)
${prefix}lode - Game lô đề

🛍️ ** BƯỚC 5: MUA SẮM & THU TẬP **
${prefix}shop - Xem cửa hàng
${prefix}buy [tên vật phẩm] - Mua vật phẩm
${prefix}inv - Xem hàng tay
${prefix}use [tên] - Dùng vật phẩm

📜 ** XEM CHI TIẾT **
${prefix}huongdan cơ_bản - Thuật ngữ cơ bản
${prefix}huongdan kiếm_tiền - Chi tiết cách kiếm tiền
${prefix}huongdan minigame - Hướng dẫn chơi game
${prefix}huongdan mẹo - Mẹo chơi hay ho
━━━━━━━━━━━━━━━━━━━
Dùng ${prefix}help để xem tất cả lệnh!`;

        return api.sendMessage(totalMsg, threadID, messageID);
      }

      // 2. HƯỚNG DẪN CƠ BẢN
      if (mode === "cơ_bản" || mode === "co_ban") {
        const basicMsg = `📚 THUẬT NGỮ CƠ BẢN
━━━━━━━━━━━━━
💳 Credits: Tiền trong trò chơi, dùng để mua hàng & cược
🔋 Energy (Thể lực): Mỗi lệnh tiêu tốn energy, khôi phục tự động
👑 VIP: Hạng cao cấp, nhận bonus khi làm việc (50% lương)
📦 Inventory: Túi đựng vật phẩm của bạn
⚙️ Active Effects: Những trạng thái đặc biệt đang kích hoạt

💰 HỆ THỐNG TIỀN TỆ
━━━━━━━━━━━━━
• 1 Credits = 1 đơn vị tiền cơ bản
• Lương làm việc: 10k ~ 100k (có bonus từ VIP & Items)
• Có thể âm tiền (nợ), nhưng sẽ bị trừ khi kiếm tiền

🎯 HẠNG VIP
━━━━━━━━━━━━━
Khi có VIP (kích hoạt từ Shop):
• Giảm 50% xui khi làm việc (20% -> 10%)
• Tăng 50% lương khi làm việc
• Các bonus khác tùy theo vật phẩm

⚡ HỆ THỐNG ENERGY
━━━━━━━━━━━━━
• Mỗi action tiêu 15 energy (làm việc, quest, etc.)
• Max energy phụ thuộc vào tầng chơi
• Tự khôi phục theo thời gian`;

        return api.sendMessage(basicMsg, threadID, messageID);
      }

      // 3. HƯỚNG DẪN KIẾM TIỀN
      if (mode === "kiếm_tiền" || mode === "kiem_tien") {
        const earnMsg = `💰 CÁCH KIẾM TIỀN
━━━━━━━━━━━━━
🛠️ LÀMHỢP LỰC (CHÍNH)
${prefix}lamviec
• Nhân: 10k ~ 100k (có thể cao hơn nếu VIP + bonus)
• Xui: 20% fail mất 10k ~ 50k (10% nếu VIP)
• Cooldown: 60 giây

📋 ĐIỂM DANH HÀNG NGÀY
${prefix}diemdanh
• Thưởng cố định hàng ngày
• Cooldown: 24 giờ

🎯 NHẬN QUEST
${prefix}quest
• Nhiệm vụ hàng ngày, hoàn thành để nhận tiền
• Có thể có nhiều quest cùng lúc

⚡ NÂNG CẤP NGÂN HÀNG
${prefix}bank upgrade
• Mở rộng giới hạn tiền có thể lưu trữ
• Bảo vệ tiền khỏi cướp

🔴 CƯỚP TIỀN (NGUY HIỂM)
${prefix}cuop [@tên]
• Có thể kiếm lớn nhưng dễ bị trả đũa
• Rủi ro cao, sau cáu bị phạt
• Mỗi lần dùng tốn 20 thể lực
• Chỉ dùng khi thực sự cần & tin tưởng mình

💎 GIẢM GIÁ VÀ ĐẠI GIÁ
${prefix}daigia [tên vật phẩm]
• Bán vật phẩm cho NPC giá thấp hơn normal`;

        return api.sendMessage(earnMsg, threadID, messageID);
      }

      // 4. HƯỚNG DẪN MINIGAME
      if (mode === "minigame") {
        const gameMsg = `🎮 HƯỚNG DẪN CHƠI MINIGAME
━━━━━━━━━━━━━
🎲 TÀI XIU
${prefix}taixiu [tài|xỉu] [số tiền]
• Dự đoán kết quả dúc xúc: Tài (tổng >= 11) hay Xỉu (< 11)
• Win: +số tiền cược
• Lose: -số tiền cược
• Cooldown: 10 giây

🦀 BẦU CUA CÁ CÓC
${prefix}baucua [chọn] [số tiền]
• Chọn 1 trong 6 hình: bầu, cua, cá, cóc, gà, nai
• Nếu xúc xắc trúng chọn: x2 tiền cược
• Nếu thua: -số tiền
• Cooldown: 10 giây

🎯 LÔ ĐỀ
${prefix}lode [số 0-99] [số tiền]
• Chọn 2 chữ số (00~99) để cược
• Trúng: x70 tiền cược
• Thua: -số tiền
• Cooldown: 20 giây
• Nguy hiểm nhất nhưng thưởng lớn nhất!

🔁 CHI TIẾT RULES
━━━━━━━━━━━━━
• Không có giới hạn số lần chơi (nhưng có cooldown)
• Nên cược nhỏ để tránh mất hết tiền
• Chơi vui, không nên cá cược cả số dư`;

        return api.sendMessage(gameMsg, threadID, messageID);
      }

      // 5. MẸO CHƠI
      if (mode === "mẹo" || mode === "meo") {
        const tipsMsg = `💡 MẸO CHƠI HAY HO
━━━━━━━━━━━━━
✅ KIẾM TIỀN HIỆU QUẢ
1. Làm việc thường xuyên (${prefix}lamviec) - ổn định & an toàn
2. Điểm danh hàng ngày (${prefix}diemdanh) - free tiền
3. Làm quest (${prefix}quest) - bonus khá tốt
4. Lưu tiền vào ngân hàng tránh cướp

✅ QUẢN LÝ TIỀN TỐT
1. Không cược quá 10% số dư hiện tại
2. Giữ dự phòng khoảng 50k cho emergency
3. Đầu tư vào vật phẩm có bonus khi làm việc
4. Vay tiền chỉ khi thực sự cần

❌ TẬP TÍNH NÊN TRÁNH
1. Chơi minigame quá nhiều = thua tiền
2. Cướp tiền người lạ = bị trả đũa
3. Không kiểm tra số dư = mất xác suất
4. Hành động bất thình lình = rủi ro cao

🎯 CHIẾN LƯỢC NÂNG CẤP
1. Tuần 1: Tích luỹ 500k (làm việc + diemdanh)
2. Tuần 2: Mua vật phẩm bonus làm việc
3. Tuần 3: Tham gia game có lãi tích luỹ
4. Tuần 4+: Nâng cap ngân hàng & VIP`;

        return api.sendMessage(tipsMsg, threadID, messageID);
      }

      // Nếu mode không hợp lệ
      return api.sendMessage(
        `❓ Chế độ không tồn tại. Dùng: huongdan [all|cơ_bản|kiếm_tiền|minigame|mẹo]`,
        threadID,
        messageID,
      );
    } catch (e) {
      console.error("Lỗi Hướng dẫn:", e);
      return api.sendMessage(
        "❌ Lỗi xảy ra khi hiển thị hướng dẫn.",
        threadID,
        messageID,
      );
    }
  },
};
