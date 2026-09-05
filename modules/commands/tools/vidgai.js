const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { checkCooldown } = require('../../utils/cooldown');
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { getConnection } = require("../../utils/database");
const { consumeEnergy } = require('../../utils/energySystem');

const VIDEO_DIR = path.resolve(__dirname, '../../../cache/vidgai');

// Background pre-upload pools for media attachments (to make sending fast)
const attachmentIdPools = new Map();
const activeUploads = new Set();
const MAX_POOL_SIZE = 1;

function getExtensionFromAttachment(attachment) {
    const mimeType = String(attachment?.mimeType || attachment?.mimetype || "").toLowerCase();
    if (mimeType.includes("video/mp4")) return ".mp4";
    if (mimeType.includes("video/quicktime")) return ".mov";
    if (mimeType.includes("video/webm")) return ".webm";
    if (mimeType.includes("video/x-matroska")) return ".mkv";
    if (mimeType.includes("video/x-msvideo")) return ".avi";
    if (mimeType.includes("video/x-flv")) return ".flv";
    if (mimeType.includes("video/x-ms-wmv")) return ".wmv";

    const url = String(attachment?.url || "");
    const ext = path.extname(url.split(/[?#]/)[0]).toLowerCase();
    return ext || ".mp4";
}

async function downloadAttachment(attachment, targetPath) {
    const downloadUrl = attachment.largePreviewUrl || attachment.url || "";
    const response = await axios.get(String(downloadUrl), {
        responseType: "stream",
        headers: {
            "User-Agent": "Mozilla/5.0",
        },
    });
    const { pipeline } = require("stream/promises");
    await pipeline(response.data, fs.createWriteStream(targetPath));
}

function getThreadVideoAttachments(event) {
    const replyAttachments = Array.isArray(event?.messageReply?.attachments)
        ? event.messageReply.attachments
        : [];
    const currentAttachments = Array.isArray(event?.attachments) ? event.attachments : [];
    const attachments = [...replyAttachments, ...currentAttachments];

    return attachments.filter((attachment) => {
        if (!attachment || typeof attachment !== "object") return false;

        const type = String(attachment.type || "").toLowerCase();
        const mimeType = String(attachment.mimeType || attachment.mimetype || "").toLowerCase();

        if (type === "video" || mimeType.startsWith("video/")) {
            return true;
        }

        const url = String(attachment.url || "").toLowerCase();
        return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url);
    });
}

async function uploadMediaToFb(mediaPath, api) {
    if (!api) return null;
    if (!fs.existsSync(mediaPath)) return null;

    try {
        const stream = fs.createReadStream(mediaPath);
        const res = await api.postFormData('https://upload.facebook.com/ajax/mercury/upload.php', {
            upload_1024: stream
        });
        const bodyText = res.body?.replace('for (;;);', '') || "{}";
        const json = JSON.parse(bodyText);
        const metadata = json.payload?.metadata?.[0];
        if (metadata) {
            return Object.entries(metadata)[0]; // e.g. ["video_id", 12345]
        }
    } catch (e) {
        console.error(`[vidgai-pool] Failed to upload ${mediaPath}:`, e);
    }
    return null;
}

function refillPreuploadedPool(mediaPath, api) {
    if (!api) return;
    if (activeUploads.has(mediaPath)) return;

    const pool = attachmentIdPools.get(mediaPath) || [];
    if (pool.length >= MAX_POOL_SIZE) return;

    activeUploads.add(mediaPath);

    uploadMediaToFb(mediaPath, api).then(entry => {
        activeUploads.delete(mediaPath);
        if (entry) {
            const p = attachmentIdPools.get(mediaPath) || [];
            p.push(entry);
            attachmentIdPools.set(mediaPath, p);
            console.log(`[vidgai-pool] Pre-upload completed for ${mediaPath}. Pool size: ${p.length}`);
        }
    }).catch(err => {
        activeUploads.delete(mediaPath);
        console.error(`[vidgai-pool] Pre-upload promise error for ${mediaPath}:`, err);
    });
}

let isWarmingUp = false;
async function warmUpPool() {
    const api = global.api_instance;
    if (!api) return;
    if (isWarmingUp) return;
    isWarmingUp = true;

    console.log("[vidgai-pool] Warming up pre-uploaded video pool for all files...");
    try {
        if (!fs.existsSync(VIDEO_DIR)) {
            fs.mkdirSync(VIDEO_DIR, { recursive: true });
        }
        const videoFiles = fs.readdirSync(VIDEO_DIR).filter(f => 
            /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(f)
        );

        if (videoFiles.length === 0) return;

        // Shuffle thứ tự tải trước để đa dạng
        const shuffled = videoFiles.sort(() => 0.5 - Math.random());

        // Tải trước tuần tự từng video một, cách nhau 3 giây để tránh spam Facebook
        for (let i = 0; i < shuffled.length; i++) {
            const filePath = path.join(VIDEO_DIR, shuffled[i]);
            refillPreuploadedPool(filePath, api);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        console.log("[vidgai-pool] Warm up completed queueing all video files.");
    } catch (err) {
        console.error("[vidgai-pool] Error during warm up:", err);
    }
}

// Background poll to check if global.api_instance is ready
const intervalId = setInterval(() => {
    if (global.api_instance) {
        clearInterval(intervalId);
        warmUpPool();
    }
}, 5000);

async function fetchTikTokData(tiktokUrl) {
    // 1. Thử API chính: TikWM (POST) với timeout 10 giây (ưu tiên hdplay - HD chất lượng cao nhất)
    try {
        const response = await axios.post("https://www.tikwm.com/api/", new URLSearchParams({
            url: tiktokUrl
        }), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 10000
        });

        const resData = response.data;
        if (resData && resData.code === 0 && resData.data && (resData.data.hdplay || resData.data.play)) {
            return {
                videoUrl: resData.data.hdplay || resData.data.play,
                caption: resData.data.title || "Không có caption",
                authorName: resData.data.author?.nickname || resData.data.author?.unique_id || "Ẩn danh",
                username: resData.data.author?.unique_id ? `@${resData.data.author.unique_id}` : ""
            };
        }
    } catch (e) {
        console.error("[vidgai-tiktok] TikWM POST thất bại:", e.message);
    }

    // 2. Dự phòng 1: TikWM (GET) với timeout 10 giây (ưu tiên hdplay)
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`, {
            timeout: 10000
        });

        const resData = response.data;
        if (resData && resData.code === 0 && resData.data && (resData.data.hdplay || resData.data.play)) {
            return {
                videoUrl: resData.data.hdplay || resData.data.play,
                caption: resData.data.title || "Không có caption",
                authorName: resData.data.author?.nickname || resData.data.author?.unique_id || "Ẩn danh",
                username: resData.data.author?.unique_id ? `@${resData.data.author.unique_id}` : ""
            };
        }
    } catch (e) {
        console.error("[vidgai-tiktok] TikWM GET thất bại:", e.message);
    }

    // 3. Dự phòng 2: Vytie API
    try {
        const response = await axios.get(`https://api.vytie.dp.ng/v1/tiktok?url=${encodeURIComponent(tiktokUrl)}`, {
            timeout: 10000
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
        console.error("[vidgai-tiktok] Vytie API thất bại:", e.message);
    }

    return null;
}

function downloadStreamWithTimeout(videoUrl, tempFilePath, timeoutMs = 20000) {
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
                timeout: timeoutMs,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                }
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
    name: "vidgai",
    description: "Xem video gái TikTok (Miễn phí)",
    usage: "\n!vidgai → Nhận video ngẫu nhiên miễn phí\n!vidgai add [link TikTok] → Thêm video vào kho từ link TikTok (Admin)\n!vidgai add → Thêm video vào kho khi reply/đính kèm tệp video (Admin)\n━━━━━━━━━━━━━\n⏱️ Cooldown: 61s/lần\n⚡ Tốn năng lượng mỗi lần dùng\n🎬 Gửi video gái ngẫu nhiên và tự động thu hồi sau 60s",

    execute: async ({ api, event, args, config }) => {
        const { threadID, senderID, messageID } = event;

        // Xử lý lệnh add dành riêng cho admin
        if (args && args[0] === "add") {
            const adminBotUIDs = getAdminBotUIDs();
            if (!adminBotUIDs.includes(String(senderID))) {
                return api.sendMessage("⚠️ Bạn không có quyền sử dụng lệnh này. Chỉ Admin Bot mới được sử dụng!", threadID, messageID);
            }

            if (!fs.existsSync(VIDEO_DIR)) {
                fs.mkdirSync(VIDEO_DIR, { recursive: true });
            }

            // 1. Kiểm tra xem có link TikTok trong tham số hoặc trong nội dung tin nhắn reply không
            const tiktokRegex = /https?:\/\/(?:vm|vt|v|www|mobile)\.tiktok\.com\/[^\s\n]+/i;
            const textToScan = `${args.slice(1).join(" ")} ${event?.messageReply?.body || ""}`;
            const tiktokMatch = textToScan.match(tiktokRegex);

            if (tiktokMatch) {
                const tiktokUrl = tiktokMatch[0];
                api.sendMessage("⏳ Đang tải video HD chất lượng cao từ link TikTok...", threadID, messageID);

                try {
                    const mediaData = await fetchTikTokData(tiktokUrl);
                    if (!mediaData || !mediaData.videoUrl) {
                        return api.sendMessage("❌ Không thể lấy link video TikTok (API lỗi hoặc link không khả dụng).", threadID, messageID);
                    }

                    const baseName = `vidgai_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
                    const targetPath = path.join(VIDEO_DIR, `${baseName}.mp4`);

                    // Tải trực tiếp giữ nguyên chất lượng gốc cao nhất (HD)
                    await downloadStreamWithTimeout(mediaData.videoUrl, targetPath, 30000);

                    // Kích hoạt pre-upload cho video mới tải xong
                    const apiInstance = global.api_instance || api;
                    refillPreuploadedPool(targetPath, apiInstance);

                    return api.sendMessage(
                        `✅ Đã thêm video TikTok (chất lượng HD cao nhất) vào kho!\n👤 Kênh: ${mediaData.authorName} (${mediaData.username})\n📝 Caption: ${mediaData.caption}`,
                        threadID,
                        messageID
                    );
                } catch (e) {
                    console.error("Lỗi khi thêm video TikTok vào kho:", e);
                    return api.sendMessage(`❌ Thêm video TikTok thất bại: ${e.message || "Lỗi không xác định."}`, threadID, messageID);
                }
            }

            // 2. Nếu không có link TikTok, kiểm tra file đính kèm video từ reply hoặc tin nhắn hiện tại
            const videoAttachments = getThreadVideoAttachments(event);
            if (videoAttachments.length === 0) {
                return api.sendMessage("⚠️ Vui lòng điền link TikTok (Ví dụ: !vidgai add https://vt.tiktok.com/...) hoặc reply/đính kèm tin nhắn chứa video để thêm vào kho!", threadID, messageID);
            }

            let successCount = 0;
            let errorCount = 0;

            for (let i = 0; i < videoAttachments.length; i++) {
                const att = videoAttachments[i];
                try {
                    const ext = getExtensionFromAttachment(att);
                    const baseName = `vidgai_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
                    const targetPath = path.join(VIDEO_DIR, `${baseName}${ext.endsWith(".mp4") ? ".mp4" : ext}`);

                    // Tải tệp giữ nguyên chất lượng gốc không nén
                    await downloadAttachment(att, targetPath);

                    successCount++;

                    // Kích hoạt pre-upload cho video mới tải xong
                    const apiInstance = global.api_instance || api;
                    refillPreuploadedPool(targetPath, apiInstance);
                } catch (e) {
                    console.error("Lỗi khi tải video:", e);
                    errorCount++;
                }
            }

            if (successCount > 0) {
                return api.sendMessage(`✅ Đã thêm thành công ${successCount} video (chất lượng gốc) vào kho!${errorCount > 0 ? ` (Thất bại ${errorCount} video)` : ""}`, threadID, messageID);
            } else {
                return api.sendMessage("❌ Thêm video thất bại. Đã có lỗi xảy ra trong quá trình tải tệp!", threadID, messageID);
            }
        }

        // Lệnh dùng bình thường: Cooldown 61s
        const cooldown = checkCooldown({ command: "vidgai", key: senderID, durationMs: 61000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lệnh này!`, threadID, messageID);
        }

        let connection;
        try {
            connection = await getConnection();

            const energyUse = await consumeEnergy(connection, String(threadID), senderID, 20);
            if (!energyUse.ok) {
                if (energyUse.reason === 'not_enough') {
                    return api.sendMessage(energyUse.message, threadID, messageID);
                }
                return api.sendMessage("❌ Không thể kiểm tra thể lực lúc này.", threadID, messageID);
            }

            if (!fs.existsSync(VIDEO_DIR)) {
                fs.mkdirSync(VIDEO_DIR, { recursive: true });
            }

            // Chọn video ngẫu nhiên từ folder
            let videoFiles = [];
            try {
                videoFiles = fs.readdirSync(VIDEO_DIR).filter(f => 
                    /\.(mp4|avi|mov|mkv|flv|wmv)$/i.test(f)
                );
            } catch (err) {
                console.error("Lỗi đọc folder video:", err);
            }

            if (videoFiles.length === 0) {
                api.sendMessage("❌ Không có video nào trong kho. Vui lòng thử lại sau!", threadID, messageID);
                return;
            }

            // Random nhiều vòng để giảm cảm giác lặp
            const rerollTimes = crypto.randomInt(3, 11); // 3 -> 10 lần random
            let randomFileName = videoFiles[crypto.randomInt(0, videoFiles.length)];
            for (let i = 1; i < rerollTimes; i++) {
                randomFileName = videoFiles[crypto.randomInt(0, videoFiles.length)];
            }

            const filePath = path.join(VIDEO_DIR, randomFileName);

            // Thử lấy token đã được upload trước từ pool (Chỉ cho chat thường, luồng E2EE dùng stream file trực tiếp)
            let attachmentPayload;
            let isPreuploaded = false;
            const isE2EE = event.isE2EE || (api.e2eeThreads && api.e2eeThreads.has(String(threadID))) || (global.api_instance?.e2eeThreads && global.api_instance.e2eeThreads.has(String(threadID)));

            const pool = !isE2EE ? (attachmentIdPools.get(filePath) || []) : [];
            if (pool.length > 0) {
                const token = pool.shift();
                attachmentIdPools.set(filePath, pool);
                attachmentPayload = [token];
                isPreuploaded = true;
            } else {
                attachmentPayload = fs.createReadStream(filePath);
            }

            // Gửi video
            try {
                const videoMsg = await api.sendMessage({ attachment: attachmentPayload }, threadID);

                await api.sendMessage(
                    `🎬 Nhận video thành công!\n⚡ Thể lực: -20 (${energyUse.energy}/${energyUse.maxEnergy})`,
                    threadID,
                    messageID
                );

                // Nạp lại pool cho tệp này ở background
                const apiInstance = global.api_instance || api;
                refillPreuploadedPool(filePath, apiInstance);

                // Xóa video sau 60 giây
                setTimeout(() => {
                    try {
                        api.unsendMessage(videoMsg.messageID, threadID);
                    } catch (e) {
                        console.error("Lỗi xóa video:", e);
                    }
                }, 60000);
            } catch (err) {
                console.error("Lỗi gửi video:", err);

                // Nếu gửi bằng token lỗi (do hết hạn...), thử gửi lại bằng file stream trực tiếp
                if (isPreuploaded) {
                    try {
                        console.log(`[vidgai-pool] Retrying send with stream fallback for ${filePath}`);
                        const videoMsg = await api.sendMessage({ attachment: fs.createReadStream(filePath) }, threadID);

                        await api.sendMessage(
                            `🎬 Nhận video thành công!\n⚡ Thể lực: -20 (${energyUse.energy}/${energyUse.maxEnergy})`,
                            threadID,
                            messageID
                        );

                        const apiInstance = global.api_instance || api;
                        refillPreuploadedPool(filePath, apiInstance);

                        setTimeout(() => {
                            try {
                                api.unsendMessage(videoMsg.messageID);
                            } catch (e) {
                                console.error("Lỗi xóa video:", e);
                            }
                        }, 60000);
                        return;
                    } catch (fallbackErr) {
                        console.error("Lỗi gửi video fallback:", fallbackErr);
                    }
                }

                api.sendMessage("❌ Lỗi gửi video. Vui lòng thử lại!", threadID, messageID);
                const apiInstance = global.api_instance || api;
                refillPreuploadedPool(filePath, apiInstance);
            }
        } catch (error) {
            console.error("Lỗi vidgai:", error);
            api.sendMessage("❌ Lỗi xử lý lệnh. Vui lòng thử lại!", threadID, messageID);
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
};