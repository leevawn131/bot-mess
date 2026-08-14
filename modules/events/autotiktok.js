const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { isAutodownTiktokEnabled } = require("../utils/tiktokSettings");
const { checkCooldown } = require("../utils/cooldown");

const MESSAGE_RETRY_COUNT = 3;
const MESSAGE_RETRY_DELAY_MS = 1500;

function isTemporaryMessengerError(error) {
    return /parseAndCheckLogin got status code:\s*408\b|status code:\s*408\b/i.test(
        String(error?.message || error)
    );
}

async function sendMessageWithRetry(api, payload, threadID, messageID) {
    let lastError;

    for (let attempt = 0; attempt < MESSAGE_RETRY_COUNT; attempt++) {
        try {
            return await api.sendMessage(payload, threadID, messageID);
        } catch (error) {
            lastError = error;
            if (!isTemporaryMessengerError(error) || attempt === MESSAGE_RETRY_COUNT - 1) {
                throw error;
            }

            console.warn(`[autodownTiktok] Messenger trả 408, thử lại lần ${attempt + 2}/${MESSAGE_RETRY_COUNT}.`);
            await new Promise((resolve) => setTimeout(resolve, MESSAGE_RETRY_DELAY_MS * (attempt + 1)));
        }
    }

    throw lastError;
}

async function fetchTikTokData(tiktokUrl) {
    // 1. Thử API chính: TikWM (POST) với timeout 8 giây
    try {
        const response = await axios.post("https://www.tikwm.com/api/", new URLSearchParams({
            url: tiktokUrl
        }), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 8000
        });

        const resData = response.data;
        if (resData && resData.code === 0 && resData.data && resData.data.play) {
            return {
                videoUrl: resData.data.play,
                caption: resData.data.title || "Không có caption",
                authorName: resData.data.author?.nickname || resData.data.author?.unique_id || "Ẩn danh",
                username: resData.data.author?.unique_id ? `@${resData.data.author.unique_id}` : ""
            };
        }
    } catch (e) {
        console.error("[autodownTiktok] TikWM POST thất bại:", e.message);
    }

    // 2. Dự phòng 1: TikWM (GET) với timeout 8 giây
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`, {
            timeout: 8000
        });

        const resData = response.data;
        if (resData && resData.code === 0 && resData.data && resData.data.play) {
            return {
                videoUrl: resData.data.play,
                caption: resData.data.title || "Không có caption",
                authorName: resData.data.author?.nickname || resData.data.author?.unique_id || "Ẩn danh",
                username: resData.data.author?.unique_id ? `@${resData.data.author.unique_id}` : ""
            };
        }
    } catch (e) {
        console.error("[autodownTiktok] TikWM GET thất bại:", e.message);
    }

    // 3. Dự phòng 2: Vytie API
    try {
        const response = await axios.get(`https://api.vytie.dp.ng/v1/tiktok?url=${encodeURIComponent(tiktokUrl)}`, {
            timeout: 8000
        });
        if (response.data && response.data.video) {
            return {
                videoUrl: response.data.video,
                caption: response.data.title || "Không có caption",
                authorName: response.data.author || "Ẩn danh",
                username: ""
            };
        }
    } catch (e) {
        console.error("[autodownTiktok] Vytie API thất bại:", e.message);
    }

    return null;
}

function downloadStreamWithTimeout(videoUrl, tempFilePath, timeoutMs = 15000) {
    return new Promise(async (resolve, reject) => {
        let isSettled = false;
        let writer = null;
        let streamResponse = null;

        const timer = setTimeout(() => {
            if (!isSettled) {
                isSettled = true;
                if (streamResponse && streamResponse.data) {
                    try { streamResponse.data.destroy(); } catch (_) {}
                }
                if (writer) {
                    try { writer.destroy(); } catch (_) {}
                }
                reject(new Error(`Tải stream video quá thời gian cho phép (${timeoutMs / 1000}s)`));
            }
        }, timeoutMs);

        try {
            streamResponse = await axios({
                method: "get",
                url: videoUrl,
                responseType: "stream",
                timeout: timeoutMs
            });

            writer = fs.createWriteStream(tempFilePath);
            streamResponse.data.pipe(writer);

            writer.on("finish", () => {
                if (!isSettled) {
                    isSettled = true;
                    clearTimeout(timer);
                    resolve();
                }
            });

            writer.on("error", (err) => {
                if (!isSettled) {
                    isSettled = true;
                    clearTimeout(timer);
                    reject(err);
                }
            });

            streamResponse.data.on("error", (err) => {
                if (!isSettled) {
                    isSettled = true;
                    clearTimeout(timer);
                    reject(err);
                }
            });
        } catch (err) {
            if (!isSettled) {
                isSettled = true;
                clearTimeout(timer);
                reject(err);
            }
        }
    });
}

module.exports = {
    name: "autodownTiktok",
    eventType: ["message", "message_reply"],

    run: async function(Obj) { return this.execute(Obj); },
    execute: async ({ api, event, config }) => {
        const { threadID, messageID, senderID, body } = event;
        const botID = String(api.getCurrentUserID());

        // Bỏ qua tin nhắn không có text hoặc do bot gửi
        if (!body || senderID === botID) return;

        // Bỏ qua nếu tin nhắn bắt đầu bằng prefix (không xử lý khi đang gọi lệnh)
        const prefix = config?.prefix || "!";
        if (body.trim().startsWith(prefix)) return;

        // Trích xuất link tiktok từ tin nhắn
        const tiktokRegex = /https?:\/\/(?:vm|vt|v|www)\.tiktok\.com\/[^\s\n]+/i;
        const match = body.match(tiktokRegex);
        if (!match) return;

        const tiktokUrl = match[0];

        // Kiểm tra tính năng có được bật không
        const isEnabled = await isAutodownTiktokEnabled(threadID);
        if (!isEnabled) return;

        // Kiểm tra cooldown (15 giây giữa các lần tự động tải của nhóm)
        const cooldown = checkCooldown({
            command: "autodown_tiktok",
            key: threadID,
            durationMs: 15000
        });
        if (!cooldown.allowed) {
            console.log(`[autodownTiktok] Cooldown hoạt động cho nhóm ${threadID}. Còn lại: ${cooldown.timeLeft}s.`);
            return;
        }

        let tempFilePath = "";
        let processMsg = null;

        try {
            // Thông báo đang xử lý
            processMsg = await sendMessageWithRetry(api, "⏳ Phát hiện link TikTok! Đang tải video, vui lòng chờ...", threadID, messageID);

            // 1. Lấy dữ liệu video với timeout và dự phòng
            const mediaData = await fetchTikTokData(tiktokUrl);
            if (!mediaData || !mediaData.videoUrl) {
                if (processMsg && processMsg.messageID) {
                    try { await api.unsendMessage(processMsg.messageID); } catch (_) {}
                }
                return sendMessageWithRetry(api, "❌ Không thể kết nối hoặc lấy link video TikTok (API bị chậm hoặc hết hạn). Vui lòng thử lại sau!", threadID, messageID);
            }

            const { videoUrl, caption, authorName, username } = mediaData;

            // Tạo thư mục cache nếu chưa có
            const cacheDir = path.resolve(__dirname, "../../cache");
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }

            tempFilePath = path.join(cacheDir, `tiktok_${threadID}_${Date.now()}.mp4`);

            // 2. Tải video với timeout 15 giây
            await downloadStreamWithTimeout(videoUrl, tempFilePath, 15000);

            // 3. Kiểm tra dung lượng (Max 25MB của Messenger)
            if (!fs.existsSync(tempFilePath)) {
                throw new Error("File tạm không tồn tại sau khi tải.");
            }

            const stats = fs.statSync(tempFilePath);
            const fileSizeInBytes = stats.size;
            const MAX_SIZE = 25 * 1024 * 1024; // 25MB

            // Xóa tin nhắn chờ trước khi gửi kết quả
            if (processMsg && processMsg.messageID) {
                try { await api.unsendMessage(processMsg.messageID); } catch (_) {}
            }

            if (fileSizeInBytes > MAX_SIZE) {
                return sendMessageWithRetry(api,
                    `👤 Đăng bởi: ${authorName} ${username}\n` +
                    `📝 Caption: ${caption}\n\n` +
                    `⚠️ Video vượt quá dung lượng giới hạn của Messenger (25MB) nên không thể tải lên.`,
                    threadID,
                    messageID
                );
            }

            // 4. Gửi video thành công
            const sendPayload = {
                body: `👤 Người đăng: ${authorName} ${username}\n📝 Caption: ${caption}`,
                attachment: fs.createReadStream(tempFilePath)
            };

            await sendMessageWithRetry(api, sendPayload, threadID, messageID);

        } catch (error) {
            console.error("Lỗi khi tự động tải TikTok:", error.message || error);
            if (processMsg && processMsg.messageID) {
                try { await api.unsendMessage(processMsg.messageID); } catch (_) {}
            }
            await sendMessageWithRetry(api,
                `❌ Lỗi tải video TikTok: ${error.message || "Tốc độ mạng quá chậm hoặc server bị gián đoạn."}`,
                threadID,
                messageID
            );
        } finally {
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try { fs.unlinkSync(tempFilePath); } catch (_) {}
            }
        }
    }
};
