# bot-mess

Bot Messenger viết bằng Node.js, dùng ws3-fca để đăng nhập Facebook và xử lý lệnh theo dạng module.

## Tính năng chính

- Prefix lệnh cấu hình trong `config.json` (mặc định `!`).
- Tổ chức lệnh theo nhóm: kinh tế, minigame, nhóm, công cụ, hệ thống.
- Hệ thống phân quyền mode theo nhóm (`user`, `admingr`, `adminbot`).
- Có scheduler tự động đổi mode theo giờ.
- Lưu thống kê tin nhắn, top ngày/tháng, lịch sử sự kiện vào file JSON cache.
- Hỗ trợ MySQL cho dữ liệu kinh tế/minigame.

## Yêu cầu môi trường

- Node.js 18+ (khuyến nghị Node.js 20 LTS).
- MySQL 8+ (hoặc tương thích với `mysql2`).
- Tài khoản Facebook có `appstate.json` hợp lệ.

## Cài đặt

1. Cài dependency:

```bash
npm install
```

2. Cấu hình `config.json`:

- `prefix`: tiền tố lệnh.
- `adminIDs`: danh sách UID chủ bot.
- `database`: thông tin kết nối MySQL.

3. Đặt file `appstate.json` ở thư mục gốc dự án.

4. Chạy bot:

```bash
node index.js
```

## Cấu hình mẫu

```json
{
	"botName": "DarkWin",
	"prefix": "!",
	"adminIDs": ["100037351338722"],
	"database": {
		"type": "mysql",
		"host": "localhost",
		"port": 3306,
		"name": "goatbot",
		"user": "root",
		"password": ""
	}
}
```

## Cấu trúc thư mục

```text
modules/
	commands/
		economy/      # Lệnh kinh tế
		minigame/     # Tài xỉu, bầu cua, lô đề...
		group/        # Lệnh quản lý nhóm
		system/       # Lệnh hệ thống bot
		tools/        # Lệnh tiện ích
	events/         # Xử lý sự kiện join/leave/thu hồi...
	utils/          # Hàm dùng chung
cache/            # File cache runtime
scripts/          # Script migration/bảo trì
```

## Danh sách lệnh nổi bật

- Kinh tế: `tien`, `bank`, `lamviec`, `diemdanh`, `shop`, `buy`, `inv`, `use`, `chuyentien`, `vay`, `cuop`, `quest`.
- Minigame: `taixiu`, `baucua`, `lode`, `duoihinhbatchu`.
- Nhóm: `add`, `kick`, `grinfo`, `antiout`, `checkout`, `checktt`, `setbd`.
- Công cụ: `help`, `ai`, `dich`, `say`, `mp3`, `vidgai`, `changelog`, `reset`.
- Hệ thống: `ping`, `uid`, `go`, `mode`, `tu`.

Xem chi tiết từng lệnh trong chat:

```text
!help
!help taixiu
```

## Một số file dữ liệu quan trọng

- `appstate.json`: trạng thái đăng nhập Facebook.
- `config.json`: cấu hình bot.
- `message_stats.json`: thống kê tin nhắn.
- `mode_settings.json`: mode theo từng nhóm.
- `mode_schedule.json`: lịch tự động đổi mode.
- `cache/taixiu_soicau_history.json`: lịch sử soi cầu tài xỉu.

## Lưu ý bảo mật

- Không đẩy `appstate.json` và thông tin database thật lên repo public.
- Nên tách dữ liệu nhạy cảm sang biến môi trường nếu triển khai production.
- Giới hạn `adminIDs` đúng UID quản trị để tránh lạm quyền.

## Khắc phục lỗi nhanh

- Lỗi đăng nhập Facebook: kiểm tra lại `appstate.json` còn hạn.
- Lỗi kết nối DB: xác minh host/port/user/password trong `config.json`.
- Lệnh không nhận: kiểm tra `prefix` và quyền của người dùng theo mode nhóm.

## Phát triển thêm

Khi thêm lệnh mới:

1. Tạo file trong đúng nhóm ở `modules/commands/...`.
2. Export object có `name`, `description`, `usage`, `execute`.
3. Khởi động lại bot để nạp module mới.