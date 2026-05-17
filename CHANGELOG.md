# CHANGELOG

## [Phiên bản Cập nhật Gần nhất] - Tối ưu Database & Sửa lỗi Runtime

### 🚀 Tính năng & Cải tiến mới
*   **Hệ thống Bot Rental (Thuê Bot):** 
    *   Nâng cấp lệnh `!setthue`: Hỗ trợ cộng thêm thời gian thủ công (đơn vị ngày/tháng) linh hoạt cho Admin.
    *   Tối ưu lệnh `!thuebot huy`: Huỷ giao dịch đang chờ một cách mượt mà.
    *   Bổ sung tính năng tự động nhận diện `adminIDs` từ `config.json` để bỏ qua các lớp chặn (Block) quyền sử dụng khi chưa thuê.
*   **Hệ thống Minigame (Tài xỉu):**
    *   Hỗ trợ Tiếng Việt có dấu trọn vẹn: Người chơi có thể nhắn `tài`, `xỉu`, `TÀI`, `XỈU`... bot đều nhận diện được mà không bị trật nhịp.
*   **Khả năng tương thích Docker:**
    *   Cập nhật lệnh `!reset`: Đổi cơ chế sang `process.exit(1)` để tương thích 100% với môi trường container Docker (auto-restart).

### 🐛 Sửa lỗi (Bug Fixes)
*   **Hệ thống Nhiệm vụ (`!quest`):**
    *   Fix lỗi `ER_BAD_FIELD_ERROR (Unknown column 'id')` nghiêm trọng gây sập lệnh `!quest`. Sửa lại luồng SQL đồng bộ hoá nhiệm vụ hàng ngày thông qua hàm chuẩn `ensureUserDailyState`.
    *   Fix lỗi `[object Promise]` hiển thị ở cột Date do hàm `getVNDateString()` bị định nghĩa trùng lặp cả đồng bộ và bất đồng bộ.
*   **Sập Bot do lỗi API (Error: [object Object]):**
    *   Fix lỗi truyền nhầm ID người dùng (`senderID`) thay vì ID tin nhắn (`messageID`) vào hàm reply của API `ws3-fca` trong `taixiu.js` và `baucua.js` khi Boss thử cược.
*   **Lỗi Runtime ở các Lệnh Economy:**
    *   `tien.js`: Fix lỗi `ReferenceError: BOSS_ID is not defined` (do sai chính tả biến thành `bossID`).
    *   `shop.js`: Xoá khối `finally` thừa gây lỗi crash gọi kết nối mạng không tồn tại.
    *   `openbox.js`: Fix lỗi `ReferenceError: connection is not defined`.

### ⚙️ Tối ưu hoá Hệ thống (Refactoring & Database)
*   **Quy chuẩn Connection Pool toàn Hệ thống:**
    *   Thay thế toàn bộ lệnh `connection.end()` (đang bị Deprecated và gây tắc nghẽn) thành `connection.release()` tại tất cả các module (`tien`, `buy`, `cuop`, `baucua`, `taixiu`, `lode`, `vidgai`, `openbox`).
    *   Khắc phục tình trạng tạo "Kết nối vãng lai" (`mysql.createConnection()`) gây lỗi `this.connection.release is not a function`. Tất cả các minigame và lệnh economy hiện đã dùng chung Pool (`getConnection()`) từ `database.js` để chịu tải cực tốt và không leak RAM.
