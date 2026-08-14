# 📋 CHANGELOG - Nhật Ký Cập Nhật Messenger Bot

---

## [v2.5.0] - Dọn Dẹp Mã Nguồn, Tối Ưu Hóa Git & Đại Tu Tài Liệu (2026-08-14)

### 🧹 Dọn Dẹp & Quản Trị Dự Án
- **Loại bỏ File Rác & Scratch Test Scripts:** Xóa hơn 35 tệp tin tạm thời, log/shm/wal file cũ, script debug 1 lần và các thư mục test rác (`test_task/`, `modules/cache/`).
- **Hoàn Thiện `.gitignore`:** Cấu hình lại các quy tắc bỏ qua an toàn, khắc phục triệt để việc ẩn nhầm mã nguồn trong `src/cache/`, `src/database/schema/schema.sql` và các asset GIF của lệnh đấm/hôn trong `modules/commands/cache/`.
- **Đại Tu Tài Liệu:** Viết lại toàn bộ [README.md](file:///home/leevawn/bot-loz/bot-mess/README.md) và [DOCUMENTATION.md](file:///home/leevawn/bot-loz/bot-mess/DOCUMENTATION.md) chi tiết, chuẩn xác, liệt kê đầy đủ hơn 80 lệnh và kiến trúc SQLite3 / AI Social Engine.
- **Chuẩn Hóa `.env.example`:** Cung cấp đầy đủ cấu hình cho Groq, Gemini, OpenAI, Ollama, ComfyUI, SQLite và trích xuất cookie tự động.

---

## [v2.4.0] - Tích Hợp Đa AI, Groq Cloud & Hệ Thống Cấp Độ (Level System)

### 🚀 Tính Năng Mới
- **Tích Hợp Groq Cloud (Llama 3.3):** Nâng cấp lệnh `!noitu` và tính năng chat AI sang sử dụng Groq API với độ trễ phản hồi siêu thấp.
- **Hệ Thống Level & EXP:** Tự động cộng điểm kinh nghiệm qua tin nhắn, bảng xếp hạng `!toplv`, thông báo thăng cấp kèm danh hiệu độc quyền và lệnh quản lý `!rankup on/off`.
- **Hot-Reloading cho Autosend:** Cho phép nạp lại lịch gửi tin nhắn tự động thông qua `!cmd reload autosendScheduler` mà không cần khởi động lại bot.
- **Hệ Thống AI Social Engine (`src/`):** Xây dựng thế giới nhân vật AI sống động với ký ức dài hạn, cảm xúc, nhật ký và bí mật.

---

## [v2.3.0] - Tối Ưu Database SQLite3 & Sửa Lỗi Runtime

### 🚀 Tính Năng & Cải Tiến
- **Chuyển Đổi SQLite3 Toàn Diện:** Chuyển đổi toàn bộ CSDL sang SQLite3 đặt tại `/runtime/bot.db` với chế độ WAL cho hiệu năng cao và không cần cài đặt MySQL.
- **Hệ Thống Thuê Bot (`!thuebot`):** Nâng cấp lệnh `!setthue` hỗ trợ cộng thêm thời gian thủ công linh hoạt cho Admin và tự động nhận diện `adminIDs`.
- **Hệ Thống Minigame (Tài Xỉu, Bầu Cua):** Hỗ trợ Tiếng Việt có dấu trọn vẹn, tính năng soi cầu và xử lý cược đa dạng.
- **Khả Năng Tương Thích Docker:** Cập nhật lệnh `!reset` sang `process.exit(1)` tương thích hoàn toàn với cơ chế auto-restart của Docker container và PM2.

### 🐛 Sửa Lỗi (Bug Fixes)
- **Hệ Thống Nhiệm Vụ (`!quest`):** Khắc phục lỗi `Unknown column 'id'` và sửa lỗi Promise hiển thị ở cột Date.
- **Sửa Lỗi Runtime Economy:** Sửa lỗi biến `BOSS_ID` trong `tien.js`, loại bỏ `finally` thừa trong `shop.js` và fix `ReferenceError` trong `openbox.js`.
