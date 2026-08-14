# 🐛 [BUG REPORT] & [FEATURE REQUEST]: Hỗ trợ Hot-reloading cho autosendScheduler bằng lệnh cmd reload

**Người tạo:** Tester QA (10 years experience)
**Mức độ nghiêm trọng:** High (Gây khó khăn trong quá trình deploy/hot-fix)
**Thành phần bị ảnh hưởng:** `modules/utils/autosendScheduler.js` và `index.js`

## 1. Mô tả vấn đề
Hiện tại, khi có lỗi ở file `autosendScheduler.js`, việc sử dụng lệnh `cmd reload autosendScheduler` không có tác dụng triệt để. 
Nguyên nhân là do vòng lặp `setInterval` xử lý Autosend đang được lưu trong RAM thông qua một closure cũ. Lệnh `cmd reload` chỉ xóa require cache và nạp lại file, nhưng không hủy đi tiến trình `setInterval` cũ đang chạy ngầm, dẫn đến code mới không được áp dụng vào logic quét định kỳ. Bot bắt buộc phải dùng `pm2 restart all` mới nhận code, gây gián đoạn trải nghiệm người dùng (downtime).

## 2. Mục tiêu tái cấu trúc (Acceptance Criteria)
Một AI Developer cần tiến hành tái cấu trúc lại cơ chế khởi chạy của `autosendScheduler.js` sao cho tương thích với lệnh `cmd reload`.

**Yêu cầu chi tiết cho AI Developer:**
1. **Ở file gốc (`index.js` hoặc nơi khởi tạo lúc login):**
   - Đảm bảo đối tượng `api` được lưu vào biến toàn cục, ví dụ: `global.client.api = api;` (để các module chạy ngầm có thể lấy ra xài mà không cần truyền trực tiếp).
   - Xóa bỏ việc gọi hàm `startAutosendScheduler(api)`.
   - Chỉ cần nạp file 1 lần: `require('./modules/utils/autosendScheduler.js');`.

2. **Ở file `modules/utils/autosendScheduler.js`:**
   - Hủy bỏ hàm `function startAutosendScheduler(api) { ... }`.
   - Đưa đoạn logic dọn dẹp và khởi tạo `setInterval` ra ngoài cùng của file (Root scope).
   - Code khởi tạo nên tuân theo mô hình sau:
     ```javascript
     // 1. Dọn dẹp tiến trình cũ nếu nó đang tồn tại trong RAM
     if (global.autosendSchedulerInterval) {
         clearInterval(global.autosendSchedulerInterval);
     }

     // 2. Bắt đầu tiến trình mới ngay khi file được require
     global.autosendSchedulerInterval = setInterval(() => {
         const currentApi = (global.client && global.client.api) ? global.client.api : null;
         if (currentApi) {
             checkAndSendAutosend(currentApi);
         }
     }, 30000); // 30 giây / lần
     ```

## 3. Các bước kiểm thử (QA Steps sau khi fix)
1. Sửa một đoạn `console.log` bất kỳ bên trong hàm `checkAndSendAutosend` của file `autosendScheduler.js`.
2. Trên Messenger, dùng lệnh `/cmd reload autosendScheduler` (hoặc `/cmd load utils/autosendScheduler.js`).
3. Chờ 30 giây và quan sát PM2 Logs.
4. **Kết quả mong đợi:** Dòng log mới xuất hiện. Bot không bị treo, tiến trình cũ bị hủy và thay bằng tiến trình mới chứa đoạn log vừa sửa, KHÔNG CẦN CHẠY LỆNH `pm2 restart`.

---
*Lưu ý gửi AI Developer: Hãy đọc kỹ file này, phân tích các file liên quan và thực hiện sửa đổi 100% tự động để giải quyết ticket nhé.*
