# ⚡ Messenger Bot (DarkWin Engine)

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/Database-SQLite3-blue.svg)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/License-ISC-yellow.svg)](#)
[![AI Providers](https://img.shields.io/badge/AI-Groq%20%7C%20Gemini%20%7C%20OpenAI%20%7C%20Ollama-orange.svg)](#tích-hợp-ai)

Nền tảng **Facebook Messenger Bot** toàn diện viết bằng **Node.js** và **ws3-fca** tùy biến, được thiết kế tối ưu hiệu năng cao, lưu trữ SQLite3 độc lập, hỗ trợ đa mô hình AI (Groq, Gemini, OpenAI, Ollama, ComfyUI), quản lý nhóm chuyên nghiệp, hệ thống minigame & kinh tế phong phú, cấp độ tương tác (Level System) và cơ chế tự động trích xuất cookie/appstate từ trình duyệt.

---

## 📑 Mục Lục
1. [Tính Năng Nổi Bật](#-tính-năng-nổi-bật)
2. [Yêu Cầu Hệ Thống](#-yêu-cầu-hệ-thống)
3. [Cài Đặt & Khởi Chạy Nhanh](#-cài-đặt--khởi-chạy-nhanh)
4. [Cấu Hình Hệ Thống (.env & config.json)](#-cấu-hình-hệ-thống)
5. [Hệ Thống Cơ Sở Dữ Liệu SQLite](#-hệ-thống-cơ-sở-dữ-liệu-sqlite)
6. [Tích Hợp Trí Tuệ Nhân Tạo (AI)](#-tích-hợp-trí-tuệ-nhân-tạo-ai)
7. [Danh Mục Lệnh (Commands Catalog)](#-danh-mục-lệnh-commands-catalog)
   - [Admin Bot (Quản Trị Tối Cao)](#1-admin-bot-modulescommandsadminbot)
   - [Quản Trị Nhóm (QTV)](#2-quản-trị-nhóm-modulescommandsqtv)
   - [Kinh Tế & Tài Chính (Economy)](#3-kinh-tế--tài-chính-modulescommandseconomy)
   - [Minigame & Giải Trí](#4-minigame--giải-trí-modulescommandsminigame)
   - [Tương Tác Nhóm & Level (Group)](#5-tương-tác-nhóm--level-modulescommandsgroup)
   - [Công Cụ & Tiện Ích (Tools)](#6-công-cụ--tiện-ích-modulescommandstools)
   - [Hệ Thống Thuê Bot](#7-hệ-thống-thuê-bot-thuebotjs)
8. [Hệ Thống Cấp Độ & Danh Hiệu (Level System)](#-hệ-thống-cấp-độ--danh-hiệu)
9. [Tự Động Trích Xuất Cookie (Auto AppState)](#-tự-động-trích-xuất-cookie)
10. [Triển Khai (Docker & PM2)](#-triển-khai-production)
11. [Khắc Phục Sự Cố (Troubleshooting)](#-khắc-phục-sự-cố)

---

## 🚀 Tính Năng Nổi Bật

- 🗄️ **SQLite3 Zero-Config**: Cơ sở dữ liệu lưu trữ tập trung tại `/runtime/bot.db`, hiệu năng cao, không phụ thuộc máy chủ MySQL bên ngoài.
- 🧠 **Đa Nền Tảng AI**: Tích hợp Groq Cloud (Llama 3.3 tốc độ phản hồi cực nhanh cho trò chơi nối từ và chat), Gemini 1.5, OpenAI GPT-4o-mini, Ollama Local và ComfyUI tạo ảnh.
- 🛡️ **Quản Trị Nhóm Cấp Cao**: Chống spam, chống đổi tên bot, chống tag all, chống thu hồi tin nhắn, cảnh báo vi phạm, cút vĩnh viễn, duyệt nhóm, set prefix riêng từng nhóm.
- 💰 **Hệ Thống Kinh Tế Ảo**: Ngân hàng gửi/rút/lãi suất, đi làm, điểm danh, vay vốn, cướp bóc, mở rương, mua vật phẩm shop, chuyển tiền, nhiệm vụ hàng ngày.
- 🎲 **Minigame Đa Dạng**: Tài xỉu (hỗ trợ soi cầu), Bầu cua, Lô đề, Sicbo, Nối từ AI, Bóng đá, Câu cá, Ghép đôi, Đuổi hình bắt chữ.
- ⭐ **Hệ Thống Level & EXP**: Tính điểm kinh nghiệm qua từng tin nhắn, bảng xếp hạng cấp độ (`toplv`), thông báo thăng cấp tự động kèm danh hiệu độc quyền.
- ⏰ **Lập Lịch Tự Động**: Tự động gửi tin nhắn theo giờ (Autosend Scheduler), tự động chuyển chế độ hoạt động (Mode Scheduler: ban ngày mở, ban đêm tắt lệnh giải trí).
- 🍪 **Tự Động Làm Mới Cookie**: Hỗ trợ trích xuất cookie từ AdsPower, Brave, Chrome Remote Debugging hoặc Firefox khi appstate hết hạn.

---

## 💻 Yêu Cầu Hệ Thống

- **Node.js**: Phiên bản `18.x` trở lên (Khuyến nghị **Node.js 20 LTS**).
- **SQLite3**: Được biên dịch sẵn cùng `sqlite3` npm package.
- **Hệ Điều Hành**: Linux (Ubuntu/Debian/CentOS), macOS, hoặc Windows.
- **Tài khoản Facebook**: Đã đăng nhập và có file `appstate.json`.

---

## ⚡ Cài Đặt & Khởi Chạy Nhanh

### 1. Clone Source Code & Cài Đặt Thư Viện
```bash
git clone https://github.com/leevawn131/bot-mess.git
cd bot-mess
npm install
```

### 2. Cấu Hình File Biến Môi Trường (.env)
Sao chép file mẫu và cấu hình:
```bash
cp .env.example .env
nano .env
```
Điền các thông tin cơ bản:
- `ADMIN_IDS`: UID Facebook của bạn (Admin bot).
- `GROQ_APIKEY`: API Key từ [Groq Console](https://console.groq.com/) (Dùng cho lệnh `!noitu` và AI chat siêu tốc).
- `SQLITE_DB_PATH`: Mặc định là `./runtime/bot.db`.

### 3. Cung Cấp AppState Facebook
Đặt file `appstate.json` của tài khoản Facebook vào thư mục `runtime/appstate.json` (hoặc thư mục gốc của bot).

### 4. Khởi Động Bot
```bash
node index.js
```

---

## ⚙️ Cấu Hình Hệ Thống

### 1. File `.env`
Hệ thống ưu tiên đọc cấu hình từ biến môi trường:
```env
# Database SQLite
SQLITE_DB_PATH=./runtime/bot.db

# Bot General
BOT_PREFIX=!
BOT_NAME=DarkWin
BOT_LANGUAGE=vi
PORT=3000
ADMIN_IDS=100037351338722,61578017290778

# AI Providers
AI_ENABLED=true
AI_PROVIDER=groq
GROQ_APIKEY=gsk_your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
AI_OLLAMA_HOST=http://127.0.0.1:11434

# Security & Logs
RATE_LIMIT_ENABLED=true
LOG_LEVEL=info
```

### 2. File `config.json`
Cung cấp cấu hình dự phòng và cài đặt bot:
```json
{
  "prefix": "!",
  "botName": "DarkWin",
  "adminIDs": ["100037351338722"],
  "adminOnly": false,
  "fca": {
    "forceLogin": true,
    "selfListen": true,
    "autoMarkDelivery": false
  }
}
```

---

## 🗄️ Hệ Thống Cơ Sở Dữ Liệu SQLite

Toàn bộ dữ liệu của bot được lưu tại thư mục `/runtime`:
- **`runtime/bot.db`**: Cơ sở dữ liệu chính (Tài khoản người dùng, số dư ví, tiền gửi bank, lịch sử thuê bot, cảnh báo vi phạm, bảng xếp hạng EXP, cấu hình prefix nhóm).
- **`runtime/social_engine.sqlite`**: Cơ sở dữ liệu dành riêng cho hệ thống AI Social Engine (nhân vật, ký ức hội thoại, cảm xúc và nhật ký).

Các bảng được tự động khởi tạo (`CREATE TABLE IF NOT EXISTS`) ngay khi bot khởi động lần đầu thông qua `modules/utils/database.js`.

---

## 🧠 Tích Hợp Trí Tuệ Nhân Tạo (AI)

Hệ thống hỗ trợ nhiều Provider linh hoạt:

1. **Groq Cloud (Khuyên dùng)**:
   - Sử dụng mô hình `llama-3.3-70b-versatile` với tốc độ phản hồi tính bằng mili-giây.
   - Ứng dụng: Lệnh `!noitu` (nối từ đỉnh cao chống lặp từ), lệnh `!ai` và sự kiện `aiAutoReply`.
2. **Google Gemini**: Hỗ trợ `gemini-1.5-flash` và `gemini-1.5-pro`.
3. **OpenAI**: Hỗ trợ `gpt-4o`, `gpt-4o-mini`.
4. **Ollama Local**: Chạy hoàn toàn offline trên máy chủ local (`llama3`, `qwen2.5`, `mistral`).
5. **ComfyUI**: Tạo ảnh AI thông qua workflow cục bộ (`src/ai/comfy.js`).

---

## 📚 Danh Mục Lệnh (Commands Catalog)

### 1. Admin Bot (`modules/commands/adminbot/`)
*Dành riêng cho chủ sở hữu bot (`adminIDs`).*

| Lệnh | Cú pháp | Mô tả |
| :--- | :--- | :--- |
| `cluster` | `!cluster [status\|restart]` | Quản lý tiến trình Worker Threads / Cluster đa tài khoản |
| `cmd` | `!cmd [load\|unload\|reload] <file>` | Quản lý hot-reload module trực tiếp không cần restart bot |
| `duyetbox` | `!duyetbox [list\|accept\|del]` | Duyệt và cấp quyền hoạt động cho các nhóm chat mới |
| `mode` | `!mode [status\|set <mode>]` | Đổi chế độ bot (`all`, `admingr`, `adminbot`) |
| `request` | `!request` | Xem và xử lý các yêu cầu thuê bot / hỗ trợ |
| `reset` | `!reset` | Khởi động lại tiến trình bot |
| `resetbotname` | `!resetbotname` | Đặt lại biệt danh mặc định của bot trong tất cả các nhóm |
| `sendallbox` | `!sendallbox <tin nhắn>` | Gửi thông báo đến toàn bộ các nhóm bot đang tham gia |
| `sendtobox` | `!sendtobox <threadID> <nội dung>` | Gửi tin nhắn đến một nhóm cụ thể |
| `setavt` | `!setavt (reply ảnh)` | Đổi avatar tài khoản bot từ ảnh đính kèm |
| `setthue` | `!setthue <threadID> <ngày>` | Cấp hạn thuê bot thủ công cho một nhóm |
| `testapi` | `!testapi` | Kiểm tra trạng thái phản hồi của Facebook Chat API |

---

### 2. Quản Trị Nhóm (`modules/commands/qtv/`)
*Dành cho Quản trị viên nhóm chat (`QTV`) hoặc Admin bot.*

| Lệnh | Cú pháp | Mô tả |
| :--- | :--- | :--- |
| `add` | `!add <link profile / UID>` | Thêm thành viên vào nhóm chat |
| `anti` | `!anti [out\|theme\|name\|tagall]` | Bật/tắt các lớp bảo vệ chống phá nhóm |
| `autochao` | `!autochao [on\|off]` | Bật/tắt tự động gửi lời chào khi có tin nhắn đầu ngày |
| `cambot` | `!cambot [tag / UID]` | Cấm thành viên chỉ định sử dụng bot trong nhóm |
| `canhbao` | `!canhbao [tag] [lý do]` | Cảnh báo thành viên (đủ 3 lần tự động kick) |
| `checkbd` | `!checkbd` | Kiểm tra danh sách thành viên chưa đặt biệt danh |
| `cutvv` | `!cutvv [tag / UID]` | Đưa vào danh sách đen vĩnh viễn (vào lại là tự động kick) |
| `kick` | `!kick [tag / reply]` | Kick thành viên ra khỏi nhóm chat |
| `luatnhom` | `!luatnhom [set\|show]` | Thiết lập hoặc xem nội quy của nhóm |
| `rankup` | `!rankup [on\|off]` | Bật/tắt thông báo khi thành viên thăng cấp (Level Up) |
| `remind` | `!remind <thời gian> <nội dung>` | Hẹn giờ nhắc nhở công việc trong nhóm |
| `setbd` | `!setbd [tag] <biệt danh>` | Đặt biệt danh cho thành viên được tag |
| `setkitu` | `!setkitu <ký tự>` | Đặt tiền tố/hậu tố biệt danh đồng bộ cho cả nhóm |
| `setnamebot` | `!setnamebot <tên>` | Đặt lại biệt danh riêng cho bot trong nhóm |
| `setprefix` | `!setprefix <prefix mới>` | Đổi tiền tố lệnh riêng cho nhóm chat |
| `setwelcome` | `!setwelcome <nội dung>` | Tuỳ chỉnh tin nhắn chào mừng thành viên mới |
| `thongbao` | `!thongbao <nội dung>` | Ghim hoặc gửi thông báo nổi bật trong nhóm |

---

### 3. Kinh Tế & Tài Chính (`modules/commands/economy/`)
*Hệ thống tiền tệ ảo, ngân hàng, công việc và vật phẩm.*

| Lệnh | Cú pháp | Mô tả |
| :--- | :--- | :--- |
| `tien` | `!tien [tag / reply]` | Kiểm tra số dư ví tiền mặt, thể lực và cấp độ |
| `bank` | `!bank [gui\|rut\|check]` | Gửi tiền vào ngân hàng hưởng lãi suất định kỳ |
| `lamviec` | `!lamviec` | Làm việc kiếm tiền (tiêu hao thể lực) |
| `diemdanh` | `!diemdanh` | Điểm danh hàng ngày nhận tiền thưởng và quà |
| `shop` | `!shop [list\|view]` | Xem danh sách các vật phẩm bày bán trong cửa hàng |
| `buy` | `!buy <mã vật phẩm> [số lượng]` | Mua vật phẩm hoặc trang bị từ cửa hàng |
| `inv` | `!inv` | Mở túi đồ cá nhân kiểm tra các vật phẩm đang sở hữu |
| `use` | `!use <mã vật phẩm>` | Sử dụng vật phẩm trong túi đồ (hồi thể lực, buff...) |
| `chuyentien` | `!chuyentien [tag] <số tiền>` | Chuyển tiền mặt cho người khác trong nhóm |
| `vay` | `!vay [tien\|tra]` | Vay tiền nóng với lãi suất định kỳ |
| `cuop` | `!cuop [tag]` | Thử vận may cướp tiền người khác (có tỉ lệ bị bắt phạt) |
| `openbox` | `!openbox` | Mở hộp quà bí mật nhận vật phẩm hiếm |
| `quest` | `!quest` | Xem và nhận thưởng các nhiệm vụ hàng ngày |
| `daigia` | `!daigia` | Bảng xếp hạng các đại gia giàu nhất hệ thống |
| `tu` | `!tu [check\|chuoc]` | Xem trạng thái hoặc chuộc tội khi bị tống giam |

---

### 4. Minigame & Giải Trí (`modules/commands/minigame/`)
*Các trò chơi tương tác cao nhiều người cùng chơi.*

| Lệnh | Cú pháp | Mô tả |
| :--- | :--- | :--- |
| `taixiu` | `!taixiu [tai\|xiu] <tiền cược>` | Trò chơi Tài Xỉu kinh điển, có lưu lịch sử soi cầu |
| `baucua` | `!baucua [bầu\|cua\|tôm...] <tiền>` | Lắc bầu cua tôm cá nhận thưởng hấp dẫn |
| `lode` | `!lode [lo\|de] <số> <tiền>` | Đánh lô, đề theo kết quả ngẫu nhiên minh bạch |
| `sicbo` | `!sicbo [cửa cược] <tiền>` | Xúc xắc Sicbo chuẩn quốc tế với đa dạng cửa đặt |
| `noitu` | `!noitu [bắt đầu / từ ngữ]` | Trò chơi nối từ Tiếng Việt thông minh cùng AI Groq |
| `bongda` | `!bongda [xem\|cuoc]` | Dự đoán tỷ số các trận cầu bóng đá kịch tính |
| `cauca` | `!cauca [quang\|ban\|nangcap]` | Đi câu cá giải trí kiếm nguyên liệu bán lấy tiền |
| `dhbc` | `!dhbc` | Trò chơi Đuổi Hình Bắt Chữ nhìn hình đoán nghĩa |
| `ghepdoi` | `!ghepdoi` | Ghép đôi ngẫu nhiên 2 thành viên trong nhóm với tỷ lệ hợp nhau |

---

### 5. Tương Tác Nhóm & Level (`modules/commands/group/`)
*Tính năng đo lường tương tác và giải trí nhóm.*

| Lệnh | Cú pháp | Mô tả |
| :--- | :--- | :--- |
| `checktt` | `!checktt [locmem\|loc]` | Kiểm tra thống kê tương tác, lọc thành viên ít chat |
| `toplv` | `!toplv` | Bảng xếp hạng cấp độ (Level) và EXP của các thành viên |
| `checkout` | `!checkout` | Xem danh sách những người đã rời khỏi nhóm chat |
| `autorep` | `!autorep [add\|del\|list]` | Cài đặt phản hồi tự động theo từ khóa trong nhóm |
| `grinfo` | `!grinfo` | Xem thông tin chi tiết về nhóm (ID, số lượng QTV, thành viên) |
| `qtv` | `!qtv [add\|del] [tag]` | Thăng chức hoặc hạ chức Quản trị viên nhóm |
| `dam` | `!dam [tag / reply]` | Đấm người khác vui vẻ kèm ảnh GIF động |
| `kiss` | `!kiss [tag / reply]` | Trao nụ hôn ngọt ngào kèm ảnh GIF động |

---

### 6. Công Cụ & Tiện Ích (`modules/commands/tools/`)
*Các công cụ hỗ trợ đa phương tiện và trợ lý thông minh.*

| Lệnh | Cú pháp | Mô tả |
| :--- | :--- | :--- |
| `ai` | `!ai <câu hỏi>` | Trò chuyện, hỏi đáp thông minh cùng AI |
| `music` | `!music <tên bài hát / link>` | Tìm kiếm, phát nhạc YouTube chất lượng cao |
| `vidgai` | `!vidgai` | Xem video gái xinh ngẫu nhiên |
| `say` | `!say <văn bản>` | Chuyển văn bản thành giọng nói (Google / Edge TTS) |
| `dich` | `!dich <văn bản>` | Dịch thuật đa ngôn ngữ sang Tiếng Việt |
| `taoanh` | `!taoanh <prompt>` | Tạo ảnh AI từ văn bản |
| `tiktok` | `!tiktok <link>` | Tải video TikTok không logo |
| `uid` | `!uid [tag / reply]` | Lấy Facebook User ID của bản thân hoặc người khác |
| `ping` | `!ping [nội dung]` | Tag toàn bộ thành viên trong nhóm kèm thông báo |
| `autosend` | `!autosend [add\|del\|list]` | Lập lịch tự động gửi tin nhắn theo khung giờ |
| `help` | `!help [tên lệnh]` | Xem bảng hướng dẫn chi tiết về các lệnh |
| `huongdan` | `!huongdan` | Cẩm nang dành cho người mới bắt đầu làm quen với bot |
| `changelog` | `!changelog` | Xem lịch sử cập nhật và tính năng mới của bot |
| `gopy` | `!gopy <nội dung>` | Gửi phản hồi, ý kiến đóng góp trực tiếp tới Admin |
| `adminbot` | `!adminbot` | Xem danh sách liên hệ của Admin bot |
| `go` | `!go (reply)` | Gỡ tin nhắn do bot đã gửi |

---

### 7. Hệ Thống Thuê Bot (`thuebot.js`)
Hệ thống cho thuê bot tự động hoá toàn diện:
- Lệnh: `!thuebot`
- Hỗ trợ: Kiểm tra thời hạn thuê, tạo giao dịch gia hạn, thông báo sắp hết hạn, tự động hạn chế tính năng khi chưa được kích hoạt thuê.
- Admin có thể cấp ngày trực tiếp qua `!setthue <threadID> <số ngày>`.

---

## 🏆 Hệ Thống Cấp Độ & Danh Hiệu

Bot tích hợp cơ chế cộng điểm kinh nghiệm (`EXP`) khi người dùng nhắn tin trong nhóm chat (`modules/utils/LevelSystem.js`):
- Mỗi tin nhắn hợp lệ cộng ngẫu nhiên từ `10 - 25 EXP` (Cooldown 15 giây chống spam).
- Công thức tính EXP thăng cấp mượt mà: `EXP = 50 * level^1.5`.
- Hệ thống danh hiệu độc quyền theo cấp bậc:
  - Cấp 1 - 5: 🌟 *Tập Sự*
  - Cấp 6 - 10: 🍀 *Mầm Non*
  - Cấp 11 - 20: 📝 *Người Mới* ➔ 💬 *Thành Viên*
  - Cấp 21 - 40: 📣 *Năng Nổ* ➔ ⭐ *Tích Cực* ➔ 🎯 *Chăm Chỉ*
  - Cấp 41 - 70: 🔥 *Cây Chat* ➔ 🌟 *Nổi Bật* ➔ 🎖️ *Gương Mặt Quen Thuộc*
  - Cấp 71 - 100: 💎 *Kỳ Cựu* ➔ 🛡️ *Người Đồng Hành* ➔ 🏅 *Trụ Cột*
  - Cấp 101 - 200: 👑 *Biểu Tượng* ➔ 🚀 *Tiên Phong* ➔ ⚡ *Huyền Thoại* ➔ 🌌 *Bá Chủ* ➔ 🏛️ *Tượng Đài*
  - Cấp 201+: 🏆 *Bất Tử* ➔ ☀️ *Vô Song* ➔ 🌠 *Thần Thoại* ➔ 💠 *Chí Tôn* ➔ ♾️ *Bất Diệt*

---

## 🍪 Tự Động Trích Xuất Cookie

Khi `appstate.json` hết hạn, bot có thể tự động làm mới session mà không cần copy tay:
- **AdsPower**: Tích hợp với trình duyệt chống phát hiện qua REST API (`ADSPOWER_API`).
- **Brave / Chrome**: Kết nối qua Remote Debugging Port (`CHROME_PORT=9222`) hoặc đọc trực tiếp profile SQLite (`export-appstate.js`).

Chạy trích xuất thủ công:
```bash
node export-appstate.js
```

---

## 🐳 Triển Khai Production

### 1. Triển khai bằng PM2 (Khuyên dùng trên Linux VPS)
```bash
# Cài đặt PM2
npm install -g pm2

# Khởi chạy bot
pm2 start index.js --name "messenger-bot"

# Cài đặt tự khởi động cùng hệ thống
pm2 startup
pm2 save
```

### 2. Triển khai bằng Docker
```bash
# Build và chạy ngầm
docker compose up -d --build

# Xem log thời gian thực
docker compose logs -f bot
```

---

## 🛠️ Khắc Phục Sự Cố

1. **Lỗi `Error retrieving userID` hoặc Đăng nhập thất bại:**
   - AppState hoặc Cookie đã hết hạn. Hãy đăng nhập tài khoản Facebook trên trình duyệt máy chủ, sau đó chạy `node export-appstate.js` để làm mới `runtime/appstate.json`.
2. **Lỗi kết nối SQLite:**
   - Đảm bảo thư mục `/runtime` có quyền ghi (`chmod -R 755 runtime`).
3. **Bot không nhận lệnh trong nhóm:**
   - Kiểm tra `!mode` của nhóm (có thể đang ở chế độ `admingr` hoặc `adminbot`).
   - Kiểm tra thời hạn thuê bot bằng lệnh `!thuebot`.
   - Kiểm tra tiền tố lệnh của nhóm bằng cách tag bot hoặc gõ `!setprefix`.

---

## 📄 Bản Quyền & Giấy Phép

Dự án được phát triển và duy trì bởi cộng đồng. Phát hành theo giấy phép [ISC License](LICENSE).