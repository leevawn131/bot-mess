const fs = require("fs");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");

const REMINDERS_PATH = path.join(__dirname, "../../../cache/reminders.json");
const REMIND_MEDIA_DIR = path.join(__dirname, "../../../cache/remind_media");

const prefix = process.env.BOT_PREFIX || "/";

// Ensure media directory exists
if (!fs.existsSync(REMIND_MEDIA_DIR)) {
    fs.mkdirSync(REMIND_MEDIA_DIR, { recursive: true });
}

// Background pre-upload pools for media attachments (to make sending fast)
const attachmentIdPools = new Map();
const activeUploads = new Set();
const MAX_POOL_SIZE = 1;

/**
 * Upload local media file to Facebook and get metadata entry
 */
async function uploadMediaToFb(mediaPath, api) {
    if (!api) return null;
    if (!fs.existsSync(mediaPath)) return null;

    try {
        const stream = fs.createReadStream(mediaPath);
        const res = await api.postFormData("https://upload.facebook.com/ajax/mercury/upload.php", {
            upload_1024: stream
        });
        const bodyText = res.body?.replace("for (;;);", "") || "{}";
        const json = JSON.parse(bodyText);
        const metadata = json.payload?.metadata?.[0];
        if (metadata) {
            return Object.entries(metadata)[0]; // e.g. ["video_id", 12345]
        }
    } catch (e) {
        console.error(`[remind-pool] Failed to upload ${mediaPath}:`, e);
    }
    return null;
}

/**
 * Refill the preloaded attachment pool for a specific media file
 */
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
            console.log(`[remind-pool] Pre-upload completed for ${mediaPath}. Pool size: ${p.length}`);
        }
    }).catch(err => {
        activeUploads.delete(mediaPath);
        console.error(`[remind-pool] Pre-upload promise error for ${mediaPath}:`, err);
    });
}

/**
 * Retrieve a pre-uploaded attachment token from the pool
 */
function getPreuploadedAttachment(mediaPath) {
    const pool = attachmentIdPools.get(mediaPath) || [];
    if (pool.length > 0) {
        const entry = pool.shift();
        attachmentIdPools.set(mediaPath, pool);
        return entry;
    }
    return null;
}

/**
 * Get current time based on env TZ or default UTC+7
 */
function getLocalTime() {
    const now = new Date();
    if (process.env.TZ) {
        return {
            hours: now.getHours(),
            minutes: now.getMinutes(),
            dateStamp: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
        };
    } else {
        const offset = 7; // Default UTC+7
        const tzTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
        return {
            hours: tzTime.getUTCHours(),
            minutes: tzTime.getUTCMinutes(),
            dateStamp: `${tzTime.getUTCFullYear()}-${String(tzTime.getUTCMonth() + 1).padStart(2, "0")}-${String(tzTime.getUTCDate()).padStart(2, "0")}`
        };
    }
}

/**
 * Read reminders from cache/reminders.json
 */
function readReminders() {
    try {
        if (!fs.existsSync(REMINDERS_PATH)) return [];
        const data = fs.readFileSync(REMINDERS_PATH, "utf8");
        return JSON.parse(data) || [];
    } catch (e) {
        console.error("Error reading reminders.json:", e);
        return [];
    }
}

/**
 * Write reminders to cache/reminders.json
 */
function writeReminders(reminders) {
    try {
        const dir = path.dirname(REMINDERS_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(REMINDERS_PATH, JSON.stringify(reminders, null, 4), "utf8");
    } catch (e) {
        console.error("Error writing reminders.json:", e);
    }
}

/**
 * Check all reminders and trigger if the time matches
 */
function checkAndTriggerReminders(api) {
    try {
        const reminders = readReminders();
        if (reminders.length === 0) return;

        const { hours, minutes, dateStamp } = getLocalTime();
        const currentHHMM = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

        let hasChanged = false;
        const remindersToKeep = [];

        for (const item of reminders) {
            if (item.time === currentHHMM && item.lastTriggeredDate !== dateStamp) {
                item.lastTriggeredDate = dateStamp;
                hasChanged = true;

                // Trigger message send
                sendReminderMessage(api, item);

                if (item.isDaily) {
                    remindersToKeep.push(item);
                } else {
                    // Delete associated media file if it's a one-time reminder
                    if (item.media && item.media.path && fs.existsSync(item.media.path)) {
                        try {
                            fs.unlinkSync(item.media.path);
                        } catch (_) {}
                    }
                }
            } else {
                remindersToKeep.push(item);
            }
        }

        if (hasChanged) {
            writeReminders(remindersToKeep);
        }
    } catch (e) {
        console.error("[remind-scheduler] Error running check:", e);
    }
}

/**
 * Send the reminder message to Facebook thread
 */
async function sendReminderMessage(api, item) {
    const payload = {
        body: `⏰ **NHẮC NHỞ:** ${item.content}`
    };

    let attachmentStream = null;
    try {
        if (item.media && item.media.path && fs.existsSync(item.media.path)) {
            const token = getPreuploadedAttachment(item.media.path);
            if (token) {
                payload.attachment = [token];
            } else {
                attachmentStream = fs.createReadStream(item.media.path);
                payload.attachment = attachmentStream;
            }
        }

        await api.sendMessage(payload, item.threadID);
        console.log(`[remind-scheduler] Sent reminder for thread ${item.threadID}: "${item.content}"`);

        // Refill pool for next trigger
        if (item.media && item.media.path && fs.existsSync(item.media.path)) {
            refillPreuploadedPool(item.media.path, api);
        }
    } catch (err) {
        console.error(`[remind-scheduler] Error sending reminder for thread ${item.threadID}:`, err);
        if (attachmentStream) {
            try { attachmentStream.destroy(); } catch (_) {}
        }

        // Fallback: send directly or try fallback
        try {
            const fallbackPayload = { body: `⏰ **NHẮC NHỞ:** ${item.content}` };
            if (item.media && item.media.path && fs.existsSync(item.media.path)) {
                fallbackPayload.attachment = fs.createReadStream(item.media.path);
            }
            await api.sendMessage(fallbackPayload, item.threadID);
        } catch (fallbackError) {
            console.error(`[remind-scheduler] Fallback send failed:`, fallbackError);
        }

        // Trigger pool refill since the popped token might have expired/been invalid
        if (item.media && item.media.path && fs.existsSync(item.media.path)) {
            refillPreuploadedPool(item.media.path, api);
        }
    } finally {
        if (attachmentStream) {
            try { attachmentStream.destroy(); } catch (_) {}
        }
    }
}

/**
 * Warmup pre-upload attachment pool for existing reminders on boot
 */
function warmUpPool(api) {
    try {
        const reminders = readReminders();
        for (const item of reminders) {
            if (item.media && item.media.path && fs.existsSync(item.media.path)) {
                refillPreuploadedPool(item.media.path, api);
            }
        }
    } catch (err) {
        console.error("[remind-pool] Error during warm up:", err);
    }
}

// Background scheduler initialization
const initInterval = setInterval(() => {
    if (global.api_instance) {
        clearInterval(initInterval);
        console.log("[remind-scheduler] Starting reminder scheduler checking every 15s...");
        
        if (global.remindInterval) {
            clearInterval(global.remindInterval);
        }
        global.remindInterval = setInterval(() => {
            checkAndTriggerReminders(global.api_instance);
        }, 15000);

        // Preload cache for all files on warmup
        warmUpPool(global.api_instance);
    }
}, 5000);

// Helper for finding media attachments in event or reply message
function getThreadAttachment(event) {
    const replyAttachments = Array.isArray(event?.messageReply?.attachments)
        ? event.messageReply.attachments
        : [];
    const currentAttachments = Array.isArray(event?.attachments) ? event.attachments : [];
    const attachments = [...replyAttachments, ...currentAttachments];

    return (
        attachments.find((attachment) => {
            if (!attachment || typeof attachment !== "object") return false;

            const type = String(attachment.type || "").toLowerCase();
            const mimeType = String(attachment.mimeType || attachment.mimetype || "").toLowerCase();

            if (["photo", "image", "animated_image", "video", "audio"].includes(type)) {
                return true;
            }

            if (mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
                return true;
            }

            const url = String(attachment.url || "").toLowerCase();
            return /\.(jpg|jpeg|png|gif|webp|mp4|mov|m4v|webm|mp3|ogg|wav|m4a)(\?|#|$)/i.test(url);
        }) || null
    );
}

// Helper to determine file extension from media attachment mime type or url
function getExtensionFromAttachment(attachment) {
    const mimeType = String(attachment?.mimeType || attachment?.mimetype || "").toLowerCase();
    if (mimeType.includes("image/jpeg")) return ".jpg";
    if (mimeType.includes("image/png")) return ".png";
    if (mimeType.includes("image/gif")) return ".gif";
    if (mimeType.includes("image/webp")) return ".webp";
    if (mimeType.includes("video/mp4")) return ".mp4";
    if (mimeType.includes("video/quicktime")) return ".mov";
    if (mimeType.includes("video/webm")) return ".webm";
    if (mimeType.includes("audio/mpeg")) return ".mp3";
    if (mimeType.includes("audio/ogg")) return ".ogg";
    if (mimeType.includes("audio/wav")) return ".wav";
    if (mimeType.includes("audio/mp4")) return ".m4a";

    const url = String(attachment?.url || "");
    const ext = path.extname(url.split(/[?#]/)[0]).toLowerCase();
    return ext || ".bin";
}

// Downloader helper using pipeline
async function downloadAttachment(attachment, targetPath) {
    const response = await axios.get(String(attachment.url || ""), {
        responseType: "stream",
        headers: {
            "User-Agent": "Mozilla/5.0",
        },
    });

    await pipeline(response.data, fs.createWriteStream(targetPath));
}

module.exports = {
    name: "remind",
    description: "Hẹn giờ nhắc nhở cố định",
    usage: `\n${prefix}remind [hh:mm] [nội dung] → Cài nhắc nhở 1 lần (có thể reply đính kèm media)\n${prefix}remind [hh:mm] [nội dung] -daily → Cài nhắc nhở hàng ngày\n${prefix}remind list → Xem danh sách nhắc nhở của nhóm\n${prefix}remind del [số thứ tự] → Xóa nhắc nhở theo số thứ tự\n━━━━━━━━━━━━━\n⏰ Hẹn giờ nhắc nhở vào các khung giờ cố định trong ngày.\n🖼️ Trả lời (reply) ảnh/video/audio để đính kèm tệp tin tự động.`,
    
    execute: async ({ api, event, args, config }) => {
        const { threadID, senderID, messageID } = event;
        const subCmd = String(args[0] || "").toLowerCase().trim();

        // Check Cooldown 3s
        const cooldown = checkCooldown({ command: "remind", key: senderID, durationMs: 3000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh remind.`, threadID, messageID);
        }

        // 1. List reminders or display help
        if (subCmd === "list" || !subCmd) {
            const reminders = readReminders().filter(r => String(r.threadID) === String(threadID));
            if (reminders.length === 0) {
                return api.sendMessage("ℹ️ Nhóm này chưa cài nhắc nhở nào.\n👉 Dùng cú pháp: /remind [giờ:phút] [nội dung] để tạo mới.", threadID, messageID);
            }

            let msg = `⏰ **DANH SÁCH NHẮC NHỞ CỦA NHÓM (${reminders.length})**\n\n`;
            reminders.forEach((r, idx) => {
                msg += `${idx + 1}. [${r.time}] - ${r.content}${r.isDaily ? " 🔄" : " ⏰"}${r.media ? " 🖼️" : ""}\n`;
            });
            msg += `\n💡 Reply tin nhắn này kèm số thứ tự (ví dụ: 1 hoặc 1, 2) để xóa nhắc nhở tương ứng.`;

            const info = await api.sendMessage(msg, threadID, messageID);
            if (info && info.messageID) {
                if (!Array.isArray(global.client.handleReply)) {
                    global.client.handleReply = [];
                }
                // Filter old handle replies for remind command in this thread
                global.client.handleReply = global.client.handleReply.filter(
                    h => !(h.name === "remind" && String(h.threadID) === String(threadID))
                );
                global.client.handleReply.push({
                    name: "remind",
                    messageID: info.messageID,
                    author: senderID,
                    threadID: threadID
                });
            }
            return;
        }

        // 2. Direct deletion: /remind del [index]
        if (["del", "delete", "remove", "xoa", "xóa"].includes(subCmd)) {
            const index = parseInt(args[1], 10);
            if (isNaN(index) || index <= 0) {
                return api.sendMessage("⚠️ Vui lòng nhập số thứ tự nhắc nhở hợp lệ.\nVí dụ: /remind del 1", threadID, messageID);
            }

            const allReminders = readReminders();
            const threadReminders = allReminders.filter(r => String(r.threadID) === String(threadID));
            if (index > threadReminders.length) {
                return api.sendMessage(`❌ Số thứ tự không hợp lệ. Danh sách chỉ có ${threadReminders.length} nhắc nhở.`, threadID, messageID);
            }

            const reminderToDelete = threadReminders[index - 1];

            // Permissions check: Admin bot, Group Admin (QTV), or Reminder Creator
            const adminBotUIDs = getAdminBotUIDs();
            const isAdminBot = adminBotUIDs.includes(String(senderID));
            const threadInfo = await getThreadInfoCached(api, threadID);
            const adminIDs = toAdminIdList(threadInfo);
            const isGroupAdmin = adminIDs.includes(String(senderID));
            const isCreator = String(reminderToDelete.senderID) === String(senderID);

            if (!isAdminBot && !isGroupAdmin && !isCreator) {
                return api.sendMessage("❌ Bạn không có quyền xóa nhắc nhở này. Chỉ người cài nhắc nhở này hoặc quản trị viên mới có quyền xóa.", threadID, messageID);
            }

            // Remove associated media file if it exists
            if (reminderToDelete.media && reminderToDelete.media.path && fs.existsSync(reminderToDelete.media.path)) {
                try {
                    fs.unlinkSync(reminderToDelete.media.path);
                } catch (_) {}
            }

            // Update reminders database
            const updated = allReminders.filter(r => r.id !== reminderToDelete.id);
            writeReminders(updated);

            return api.sendMessage(`✅ Đã xóa nhắc nhở: [${reminderToDelete.time}] - ${reminderToDelete.content}`, threadID, messageID);
        }

        // 3. Add new reminder: /remind [time] [content]
        const timeStr = subCmd;
        const timeMatch = timeStr.match(/^([0-9]{1,2}):([0-9]{1,2})$/);
        if (!timeMatch) {
            return api.sendMessage("⚠️ Định dạng thời gian không đúng. Vui lòng nhập dạng Giờ:Phút (ví dụ: 08:30, 8:5, 23:00).", threadID, messageID);
        }

        const h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        if (h < 0 || h > 23 || m < 0 || m > 59) {
            return api.sendMessage("⚠️ Thời gian không hợp lệ. Giờ phải từ 0-23 và Phút phải từ 0-59.", threadID, messageID);
        }

        const normalizedTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        
        // Parse daily option
        let isDaily = false;
        let content = args.slice(1).join(" ").trim();
        if (content.endsWith("-daily")) {
            isDaily = true;
            content = content.slice(0, -6).trim();
        } else if (args.includes("-daily")) {
            isDaily = true;
            content = args.slice(1).filter(x => x !== "-daily").join(" ").trim();
        }

        if (!content) {
            return api.sendMessage("⚠️ Vui lòng nhập nội dung nhắc nhở.\nCú pháp: /remind [thời gian] [nội dung] [-daily nếu muốn nhắc hàng ngày]", threadID, messageID);
        }

        let media = null;
        const attachment = getThreadAttachment(event);
        if (attachment) {
            try {
                const ext = getExtensionFromAttachment(attachment);
                const safeFileName = `${threadID}_remind_${Date.now()}${ext}`;
                const targetPath = path.join(REMIND_MEDIA_DIR, safeFileName);

                await downloadAttachment(attachment, targetPath);

                media = {
                    path: targetPath,
                    type: String(attachment.type || "").trim(),
                    mimeType: String(attachment.mimeType || attachment.mimetype || "").trim(),
                    originalName: attachment.name || path.basename(targetPath)
                };

                // Trigger background pre-upload immediately
                refillPreuploadedPool(targetPath, api);
            } catch (err) {
                console.error("Lỗi khi tải tệp đính kèm nhắc nhở:", err);
                return api.sendMessage("❌ Lỗi xảy ra khi lưu tệp đính kèm. Vui lòng thử lại.", threadID, messageID);
            }
        }

        const reminders = readReminders();
        const newReminder = {
            id: `remind_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
            threadID: String(threadID),
            senderID: String(senderID),
            time: normalizedTime,
            content: content,
            media: media,
            isDaily: isDaily,
            lastTriggeredDate: ""
        };

        reminders.push(newReminder);
        writeReminders(reminders);

        return api.sendMessage(`✅ Đã cài nhắc nhở thành công!\n⏰ Thời gian: ${normalizedTime} (${isDaily ? "hàng ngày 🔄" : "chỉ 1 lần vào hôm nay ⏰"})\n📝 Nội dung: ${content}${media ? " (Kèm tệp đính kèm)" : ""}`, threadID, messageID);
    },

    handleReply: async ({ api, event }) => {
        const { threadID, senderID, messageID, body, messageReply } = event;
        if (!messageReply) return;

        const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
        const handleReplyContext = list.find(
            (h) => String(h.messageID) === String(messageReply.messageID) && h.name === "remind"
        );
        if (!handleReplyContext) return;

        if (String(handleReplyContext.author) !== String(senderID)) {
            return; // Only allow the author of the list command to reply to delete
        }

        const indexes = body.split(/[\s,;+]+/).map(x => parseInt(x.trim(), 10)).filter(x => !isNaN(x) && x > 0);
        if (indexes.length === 0) return;

        const allReminders = readReminders();
        const threadReminders = allReminders.filter(r => String(r.threadID) === String(threadID));

        if (threadReminders.length === 0) {
            return api.sendMessage("ℹ️ Nhóm không có nhắc nhở nào.", threadID, messageID);
        }

        // Validate selected indexes
        const invalidIndexes = indexes.filter(idx => idx > threadReminders.length);
        if (invalidIndexes.length > 0) {
            return api.sendMessage(`❌ Số thứ tự không hợp lệ: ${invalidIndexes.join(", ")}. Nhóm chỉ có ${threadReminders.length} nhắc nhở.`, threadID, messageID);
        }

        // Collect targeted reminders
        const remindersToDelete = indexes.map(idx => threadReminders[idx - 1]);

        // Permissions check for deletion
        const adminBotUIDs = getAdminBotUIDs();
        const isAdminBot = adminBotUIDs.includes(String(senderID));
        const threadInfo = await getThreadInfoCached(api, threadID);
        const adminIDs = toAdminIdList(threadInfo);
        const isGroupAdmin = adminIDs.includes(String(senderID));

        const unauthorized = remindersToDelete.filter(r => !isAdminBot && !isGroupAdmin && String(r.senderID) !== String(senderID));
        if (unauthorized.length > 0) {
            return api.sendMessage("❌ Bạn không có quyền xóa nhắc nhở của người khác cài đặt (trừ khi bạn là quản trị viên nhóm hoặc admin bot).", threadID, messageID);
        }

        // Delete associated files
        for (const item of remindersToDelete) {
            if (item.media && item.media.path && fs.existsSync(item.media.path)) {
                try {
                    fs.unlinkSync(item.media.path);
                } catch (_) {}
            }
        }

        const deleteIds = new Set(remindersToDelete.map(r => r.id));
        const remaining = allReminders.filter(r => !deleteIds.has(r.id));
        writeReminders(remaining);

        // Remove reply handler
        if (Array.isArray(global.client.handleReply)) {
            global.client.handleReply = global.client.handleReply.filter(h => h.messageID !== handleReplyContext.messageID);
        }

        const deletedText = remindersToDelete.map(r => `- [${r.time}] - ${r.content}`).join("\n");
        return api.sendMessage(`✅ Đã xóa các nhắc nhở sau:\n${deletedText}`, threadID, messageID);
    }
};
