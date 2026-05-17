# bot-mess

Bot Messenger viết bằng Node.js, dùng ws3-fca để đăng nhập Facebook và xử lý lệnh theo dạng module.

## Tính năng chính

- Prefix lệnh cấu hình trong `config.json` (mặc định `!`).
- Tổ chức lệnh theo nhóm: kinh tế, minigame, nhóm, công cụ, hệ thống.
- Hệ thống phân quyền mode theo nhóm (`user`, `admingr`, `adminbot`).
- Có scheduler tự động đổi mode theo giờ.
- Lưu thống kê tin nhắn, top ngày/tháng, lịch sử sự kiện vào file JSON cache.
- Hỗ trợ MySQL cho dữ liệu kinh tế/minigame.
- Lệnh `ai` dùng Ollama local.

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
- `ai` (tuỳ chọn): cấu hình Ollama local.

3. Đặt file `appstate.json` ở thư mục gốc dự án.

	Nếu muốn bot tự làm mới đăng nhập khi `appstate.json` hết hạn, tạo file `.env` từ `.env.example` và điền `FB_EMAIL`, `FB_PASSWORD`.

4. Chạy bot:

```bash
node index.js
```

## Chạy bằng Docker

Repo đã có sẵn `Dockerfile` và `docker-compose.yml`.

1. Sửa `config.json` để bot kết nối DB trong Docker:

```json
{
	"database": {
		"host": "mysql",
		"port": 3306,
		"name": "goatbot",
		"user": "bot",
		"password": "123456"
	}
}
```

2. Build và chạy:

```bash
docker compose up -d --build
```

3. Xem log bot:

```bash
docker compose logs -f bot
```

4. Dừng toàn bộ:

```bash
docker compose down
```

Lưu ý:

- `appstate.json`, `config.json`, `cache/` và các file JSON runtime được mount từ máy host vào container bot.
- DB MySQL được giữ trong volume `mysql_data`, không mất khi restart container.
- File `1.sql` sẽ tự chạy khi container MySQL khởi tạo lần đầu.
- Nếu dùng AI local (Ollama chạy trên máy host), đặt `ai.ollamaHost` trong `config.json` thành `http://host.docker.internal:11434`.

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
	},
	"ai": {
		"ollamaHost": "http://127.0.0.1:11434",
		"model": "llama3:latest"
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

## AI local

Lệnh `!ai` gửi câu hỏi tới Ollama local qua endpoint `http://127.0.0.1:11434/api/chat`.

Mặc định bot dùng model `llama3:latest`. Nếu muốn đổi model, có thể cấu hình trong `config.json`:

```json
{
	"ai": {
		"ollamaHost": "http://127.0.0.1:11434",
		"model": "llama3:latest"
	}
}
```

Hoặc dùng trực tiếp:

```text
!ai Cách học Node.js nhanh hơn?
!ai -m llama3:latest Viết cho tôi một câu chào ngắn.
```

## AI auto reply

Bot có thể tự trả lời tin nhắn trong nhóm bằng Ollama local, lưu phiên chat riêng cho từng người trong từng nhóm.

- Mỗi người có lịch sử hội thoại riêng.
- Sau 10 lần bot trả lời cho cùng một người, bot nghỉ 1 phút rồi mới trả lời tiếp.
- Bot ưu tiên tên thật trong danh sách thành viên nhóm, không dùng biệt danh.
- Tuổi và giới tính chỉ có khi đã có trong hồ sơ hoặc người đó đã tự nói trong chat; nếu không có thì bot sẽ trả lời là không rõ.

Bạn có thể cấu hình trong `config.json`:

```json
{
	"ai": {
		"enabled": true,
		"autoReplyEnabled": true,
		"autoReplyOnlyGroups": true,
		"ollamaHost": "http://127.0.0.1:11434",
		"model": "llama3:latest",
		"replyLimit": 10,
		"cooldownMs": 60000,
		"historyTurns": 8,
		"maxMemberHints": 5
	}
}
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
- Nếu muốn tự refresh đăng nhập, lưu `FB_EMAIL` và `FB_PASSWORD` trong `.env`; khi `appstate.json` lỗi, bot sẽ tự gọi `refresh-appstate.js` rồi thử login lại.

## Khắc phục lỗi nhanh

- Lỗi đăng nhập Facebook: nếu là appstate/cookie hết hạn, cấu hình `FB_EMAIL` và `FB_PASSWORD` để bot tự refresh `appstate.json`. Nếu log báo `Error retrieving userID`, thường cần đăng nhập và xác minh tài khoản bằng browser trước.
- Lỗi kết nối DB: xác minh host/port/user/password trong `config.json`.
- Lệnh không nhận: kiểm tra `prefix` và quyền của người dùng theo mode nhóm.

## Phát triển thêm

Khi thêm lệnh mới:

1. Tạo file trong đúng nhóm ở `modules/commands/...`.
2. Export object có `name`, `description`, `usage`, `execute`.
3. Khởi động lại bot để nạp module mới.