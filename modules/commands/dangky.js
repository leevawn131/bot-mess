const bcrypt = require('bcryptjs');
const path = require('path');
const { execute } = require('../utils/database');

// Khởi tạo bảng web_accounts nếu chưa tồn tại
async function ensureWebAccountsTable() {
    await execute(`
        CREATE TABLE IF NOT EXISTS web_accounts (
            psid TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

module.exports = {
    name: "dangky",
    aliases: ["matkhau", "register", "password", "webpass"],
    category: "tools",
    description: "Đăng ký hoặc cập nhật mật khẩu tài khoản Web Game",
    usage: "\n!dangky <mật_khẩu> → Đăng ký hoặc đổi mật khẩu Web Game\n━━━━━━━━━━━━━\n⚠️ CHÚ Ý: Chỉ thực hiện khi chat riêng 1-1 với Bot để bảo mật!",
    permission: 0,

    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        const stringThreadID = String(threadID);
        const stringSenderID = String(senderID);
        const prefix = config?.prefix || '!';

        // 1. RÀO CHẮN BẢO MẬT: Chỉ cho phép nhắn tin riêng 1-1 với Bot
        if (stringThreadID !== stringSenderID) {
            return api.sendMessage(
                `⚠️ CẢNH BÁO BẢO MẬT\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `❌ Tuyệt đối KHÔNG nhập mật khẩu trong nhóm chat đông người!\n` +
                `👉 Vui lòng mở chat riêng (inbox 1-1) với Bot và gửi cú pháp:\n` +
                `   ${prefix}dangky <mật_khẩu_của_bạn>\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `💡 Ví dụ: ${prefix}dangky MatKhau123@`,
                threadID,
                messageID
            );
        }

        // 2. KIỂM TRA THAM SỐ ĐẦU VÀO
        let rawPassword = args.join(" ").trim();
        
        // Tự động gỡ bỏ cặp ngoặc nhọn <...> nếu người dùng gõ theo cú pháp hướng dẫn <123456789>
        if (rawPassword.startsWith('<') && rawPassword.endsWith('>') && rawPassword.length >= 2) {
            rawPassword = rawPassword.slice(1, -1).trim();
        }

        if (!rawPassword) {
            return api.sendMessage(
                `📝 HƯỚNG DẪN ĐĂNG KÝ WEB GAME\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `📌 Cú pháp: ${prefix}dangky <mật_khẩu>\n` +
                `🔒 Mật khẩu phải có độ dài tối thiểu 6 ký tự.\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `💡 Ví dụ: ${prefix}dangky MatKhau123@`,
                threadID,
                messageID
            );
        }

        if (rawPassword.length < 6) {
            return api.sendMessage(
                `❌ Mật khẩu quá ngắn! Vui lòng đặt mật khẩu có ít nhất 6 ký tự để bảo vệ tài khoản.`,
                threadID,
                messageID
            );
        }

        if (rawPassword.length > 64) {
            return api.sendMessage(
                `❌ Mật khẩu quá dài! Vui lòng đặt mật khẩu không vượt quá 64 ký tự.`,
                threadID,
                messageID
            );
        }

        try {
            // 3. ĐẢM BẢO BẢNG CƠ SỞ DỮ LIỆU ĐÃ TỒN TẠI
            await ensureWebAccountsTable();

            // 4. BĂM MẬT KHẨU BẰNG BCRYPTJS (SALT ROUNDS = 10)
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(rawPassword, saltRounds);

            // 5. LƯU / CẬP NHẬT VÀO BẢNG web_accounts
            await execute(
                `INSERT INTO web_accounts (psid, password_hash, updated_at)
                 VALUES (?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(psid) DO UPDATE SET 
                     password_hash = excluded.password_hash,
                     updated_at = CURRENT_TIMESTAMP`,
                [stringSenderID, passwordHash]
            );

            // Lấy tên hiển thị của người dùng nếu có
            const userName = (global.data && global.data.userName && global.data.userName.get(stringSenderID)) || "Chiến Binh";

            const successMsg = 
                `🎉 ĐĂNG KÝ / ĐỔI MẬT KHẨU THÀNH CÔNG!\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `👤 Tài khoản (UID / PSID): ${stringSenderID}\n` +
                `🔑 Mật khẩu: [ĐÃ MÃ HÓA BẢO MẬT]\n` +
                `🌐 Cổng Web Game: Truy cập Web Game và đăng nhập bằng UID của bạn.\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `⚡ Lưu ý: Mật khẩu này áp dụng cho toàn bộ các Server/Nhóm mà bạn tham gia. Không chia sẻ mật khẩu cho bất kỳ ai!`;

            return api.sendMessage(successMsg, threadID, messageID);

        } catch (error) {
            console.error('❌ [dangky.js] Lỗi khi xử lý đăng ký tài khoản:', error);
            return api.sendMessage(
                `❌ Đã xảy ra lỗi hệ thống trong quá trình lưu tài khoản. Vui lòng thử lại sau!`,
                threadID,
                messageID
            );
        }
    }
};
