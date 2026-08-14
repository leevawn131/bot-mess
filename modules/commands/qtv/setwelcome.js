const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { pipeline } = require("stream/promises");
const { checkCooldown } = require('../../utils/cooldown');
const { getAdminBotUIDs, toAdminIdList } = require('../../utils/checkPermission');
const { getJoinGreeting, setJoinGreeting, MEDIA_DIR } = require('../../utils/joinGreetingSettings');
const { getThreadInfoCached } = require('../../utils/threadInfo');
const prefix = process.env.BOT_PREFIX;

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

            if (["photo", "image", "animated_image", "video"].includes(type)) {
                return true;
            }

            if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) {
                return true;
            }

            const url = String(attachment.url || "").toLowerCase();
            return /\.(jpg|jpeg|png|gif|webp|mp4|mov|m4v|webm)(\?|#|$)/i.test(url);
        }) || null
    );
}

function getExtensionFromAttachment(attachment) {
    const mimeType = String(attachment?.mimeType || attachment?.mimetype || "").toLowerCase();
    if (mimeType.includes("image/jpeg")) return ".jpg";
    if (mimeType.includes("image/png")) return ".png";
    if (mimeType.includes("image/gif")) return ".gif";
    if (mimeType.includes("image/webp")) return ".webp";
    if (mimeType.includes("video/mp4")) return ".mp4";
    if (mimeType.includes("video/quicktime")) return ".mov";
    if (mimeType.includes("video/webm")) return ".webm";

    const url = String(attachment?.url || "");
    const ext = path.extname(url.split(/[?#]/)[0]).toLowerCase();
    return ext || ".jpg";
}

function buildMediaPath(threadID, extension = ".jpg") {
    if (!fs.existsSync(MEDIA_DIR)) {
        fs.mkdirSync(MEDIA_DIR, { recursive: true });
    }
    const safeThreadID = String(threadID).replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(MEDIA_DIR, `welcome_${safeThreadID}_${Date.now()}${extension}`);
}

async function downloadAttachment(attachment, targetPath) {
    const downloadUrl = attachment.largePreviewUrl || attachment.url || "";
    const response = await axios.get(String(downloadUrl), {
        responseType: "stream",
        headers: {
            "User-Agent": "Mozilla/5.0",
        },
    });

    await pipeline(response.data, fs.createWriteStream(targetPath));
}

module.exports = {
    name: "setwelcome",
    description: "Cài câu chào khi có người vào nhóm (hỗ trợ reply ảnh/video)",
    usage: `\n${prefix}setwelcome [câu chào] → Cài câu chào riêng cho nhóm\n${prefix}setwelcome (reply ảnh/video) → Cài ảnh/video chào mừng riêng\n${prefix}setwelcome check → Xem câu chào hiện tại\n${prefix}setwelcome off → Tắt tính năng chào mừng\n${prefix}setwelcome reset → Quay về câu chào mặc định\n━━━━━━━━━━━━━\n📌 Biến hỗ trợ: {name}, {names}, {count}, {@tag}, {@tags}\n💡 VD: ${prefix}setwelcome Chào {@tag}, nhớ đọc nội quy nha!`,
    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        const botPrefix = config?.prefix || "!";
        const prefix = `${botPrefix}setwelcome`;

        const cooldown = checkCooldown({ command: "setwelcome", key: senderID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        let threadInfo;
        try {
            threadInfo = await getThreadInfoCached(api, threadID);
        } catch (error) {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm.", threadID, messageID);
        }

        if (!threadInfo || typeof threadInfo !== 'object') {
            return api.sendMessage("❌ Không thể lấy thông tin nhóm.", threadID, messageID);
        }

        const adminIDs = toAdminIdList(threadInfo);
        const isBotAdmin = adminIDs.includes(String(api.getCurrentUserID()));
        const isSenderAdmin = adminIDs.includes(String(senderID));
        const adminBotUIDs = getAdminBotUIDs();
        const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;

        if (!isSenderAdmin && !isSenderBotAdmin) {
            return api.sendMessage("⚠️ Chỉ admin nhóm hoặc chủ bot mới được cài câu chào.", threadID, messageID);
        }

        if (!isBotAdmin) {
            return api.sendMessage("🚫 Bot cần quyền Quản trị viên nhóm để đổi câu chào.", threadID, messageID);
        }

        const rawInput = args.join(" ").trim();
        const normalized = rawInput.toLowerCase();
        const replyAttachment = getThreadAttachment(event);

        if (["check", "view", "show", "current"].includes(normalized)) {
            const current = getJoinGreeting(threadID);
            if (current?.text === "off") {
                return api.sendMessage("📌 Tính năng câu chào mừng khi có thành viên mới vào nhóm đang TẮT.", threadID, messageID);
            }
            if (current && (current.text || current.media)) {
                let msg = "📌 Câu chào hiện tại của nhóm:\n";
                if (current.text) msg += current.text;
                if (current.media) msg += (current.text ? "\n" : "") + "📷 [Kèm ảnh/video]";
                return api.sendMessage(msg, threadID, messageID);
            }
            return api.sendMessage(
                `📌 Nhóm đang dùng câu chào mặc định:\nChào mừng {names} đã tham gia nhóm! 🥳`,
                threadID,
                messageID,
            );
        }

        if (normalized === "off") {
            setJoinGreeting(threadID, "off");
            return api.sendMessage("✅ Đã tắt tính năng câu chào mừng khi có thành viên mới vào nhóm.", threadID, messageID);
        }

        if (["reset", "default", "remove", "clear"].includes(normalized)) {
            setJoinGreeting(threadID, "");
            return api.sendMessage("✅ Đã xoá câu chào riêng của nhóm, quay về mặc định.", threadID, messageID);
        }

        if (!rawInput && !replyAttachment) {
            const current = getJoinGreeting(threadID);
            let currentStr = "";
            if (current?.text === "off") {
                currentStr = "Đã tắt tính năng chào mừng (không gửi tin chào mừng)";
            } else if (current && (current.text || current.media)) {
                if (current.text && current.media) {
                    currentStr = `${current.text}\n📷 [Kèm ảnh/video]`;
                } else if (current.media) {
                    currentStr = "📷 [Chỉ có ảnh/video chào mừng]";
                } else {
                    currentStr = current.text;
                }
            } else {
                currentStr = "Chào mừng {names} đã tham gia nhóm! 🥳 (Mặc định)";
            }

            return api.sendMessage(
                `📌 HƯỚNG DẪN ${prefix.toUpperCase()}\n━━━━━━━━━━━━━\n` +
                `• Trạng thái/Câu chào hiện tại:\n${currentStr}\n\n` +
                `• Cú pháp:\n` +
                `  - ${prefix} check → Xem câu chào hiện tại\n` +
                `  - ${prefix} off → Tắt tính năng chào mừng\n` +
                `  - ${prefix} reset → Quay về câu chào mặc định\n` +
                `  - ${prefix} <nội dung> → Cài câu chào riêng cho nhóm\n` +
                `  - Reply ảnh/video + ${prefix} <nội dung> → Cài câu chào kèm ảnh/video\n\n` +
                `• Biến hỗ trợ:\n` +
                `  - {name} = tên người vào nhóm đầu tiên\n` +
                `  - {names} = danh sách tất cả tên\n` +
                `  - {count} = số người vừa vào\n` +
                `  - {@tag} = tag người vào đầu tiên\n` +
                `  - {@tags} = tag tất cả người vừa vào\n\n` +
                `• Ví dụ:\n` +
                `  - ${prefix} Chào {@tag}, nhớ đọc nội quy nha!\n` +
                `  - Reply ảnh rồi gõ: ${prefix} Chào {@tags}, chào mừng đến với nhóm!`,
                threadID,
                messageID,
            );
        }

        if (rawInput.length > 500) {
            return api.sendMessage("⚠️ Câu chào quá dài, tối đa 500 ký tự.", threadID, messageID);
        }

        let media = null;
        if (replyAttachment) {
            try {
                const extension = getExtensionFromAttachment(replyAttachment);
                const targetPath = buildMediaPath(threadID, extension);
                await downloadAttachment(replyAttachment, targetPath);
                media = {
                    path: targetPath,
                    type: String(replyAttachment.type || "").trim(),
                    mimeType: String(replyAttachment.mimeType || replyAttachment.mimetype || "").trim(),
                };
            } catch (err) {
                console.log("❌ Lỗi tải attachment cho setwelcome:", err);
                return api.sendMessage("❌ Lỗi khi tải ảnh/video đính kèm, vui lòng thử lại.", threadID, messageID);
            }
        }

        setJoinGreeting(threadID, rawInput, media);

        if (rawInput && media) {
            return api.sendMessage("✅ Đã cài câu chào riêng kèm ảnh/video cho nhóm.", threadID, messageID);
        } else if (media) {
            return api.sendMessage("✅ Đã cài ảnh/video chào mừng riêng cho nhóm.", threadID, messageID);
        } else {
            return api.sendMessage("✅ Đã cài câu chào riêng cho nhóm.", threadID, messageID);
        }
    }
};