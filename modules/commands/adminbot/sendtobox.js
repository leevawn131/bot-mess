const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { pipeline } = require("stream/promises");
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");

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
    if (mimeType.includes("audio/mp4")) return ".m4a";
    if (mimeType.includes("audio/ogg")) return ".ogg";

    const url = String(attachment?.url || "");
    const ext = path.extname(url.split(/[?#]/)[0]).toLowerCase();
    return ext || ".bin";
}

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
    name: "sendtobox",
    description: "Gửi tin nhắn kèm tệp đính kèm đến một nhóm cụ thể bằng ID nhóm",
    usage: "\n!sendtobox [ID nhóm] [nội dung] → Gửi tin nhắn đến nhóm cụ thể\n!sendtobox [ID nhóm] (reply tin nhắn) → Gửi tin nhắn reply (kèm tệp đính kèm nếu có) đến nhóm cụ thể\n━━━━━━━━━━━━━\n🔒 Chỉ Admin Bot mới được sử dụng",

    execute: async ({ api, event, args, config }) => {
        const { threadID, senderID, messageID, messageReply } = event;
        const prefix = config?.prefix || "!";

        // 1. Kiểm tra quyền Admin Bot
        const adminBotUIDs = getAdminBotUIDs();
        if (!adminBotUIDs.includes(String(senderID))) {
            return api.sendMessage("⚠️ Bạn không có quyền sử dụng lệnh này. Chỉ Admin Bot mới được sử dụng!", threadID, messageID);
        }

        // 2. Kiểm tra ID nhóm đích
        const targetThreadID = args[0]?.trim();
        if (!targetThreadID || isNaN(targetThreadID)) {
            return api.sendMessage(`⚠️ Vui lòng nhập đúng ID nhóm nhận tin nhắn.\nCách dùng:\n${prefix}sendtobox [ID nhóm] [nội dung]\nHoặc reply tin nhắn cần gửi: ${prefix}sendtobox [ID nhóm]`, threadID, messageID);
        }

        // 3. Chuẩn bị nội dung gửi đi
        let contentToSend = "";
        let attachmentPaths = [];
        
        // Lấy nội dung văn bản đi kèm lệnh
        const extraText = args.slice(1).join(" ").trim();

        try {
            if (messageReply) {
                // Trường hợp reply tin nhắn
                contentToSend = extraText || messageReply.body || "";
                
                // Xử lý tệp đính kèm từ tin nhắn được reply
                const replyAttachments = Array.isArray(messageReply.attachments) ? messageReply.attachments : [];
                if (replyAttachments.length > 0) {
                    const cacheDir = path.join(__dirname, "../../../cache");
                    if (!fs.existsSync(cacheDir)) {
                        fs.mkdirSync(cacheDir, { recursive: true });
                    }

                    for (let i = 0; i < replyAttachments.length; i++) {
                        const att = replyAttachments[i];
                        const ext = getExtensionFromAttachment(att);
                        const tempPath = path.join(cacheDir, `sendtobox_${Date.now()}_${i}${ext}`);
                        await downloadAttachment(att, tempPath);
                        attachmentPaths.push(tempPath);
                    }
                }
            } else {
                // Trường hợp không reply tin nhắn
                contentToSend = extraText;
            }

            // Kiểm tra xem có nội dung gì để gửi không
            if (!contentToSend && attachmentPaths.length === 0) {
                return api.sendMessage("⚠️ Không có nội dung tin nhắn hoặc tệp đính kèm để gửi.", threadID, messageID);
            }

            // 4. Lấy thông tin nhóm nhận để báo cáo cho thân thiện
            let targetName = "Nhóm ẩn hoặc người dùng";
            try {
                const info = await getThreadInfoCached(api, targetThreadID);
                if (info && info.threadName) {
                    targetName = info.threadName;
                }
            } catch (_) {}

            // 5. Tiến hành gửi tin nhắn đến nhóm đích
            const messageData = {};
            if (contentToSend) {
                messageData.body = contentToSend;
            }
            if (attachmentPaths.length > 0) {
                messageData.attachment = attachmentPaths.map(p => fs.createReadStream(p));
            }

            await api.sendMessage(messageData, targetThreadID);
            
            // Báo lại kết quả thành công
            await api.sendMessage(
                `✅ Đã gửi thành công tới nhóm:\n👥 **${targetName}** (ID: ${targetThreadID})`,
                threadID,
                messageID
            );

        } catch (err) {
            console.error("Lỗi khi thực thi lệnh sendtobox:", err);
            await api.sendMessage(`❌ Gửi tin nhắn thất bại. Lỗi: ${err.message}`, threadID, messageID);
        } finally {
            // Dọn dẹp tệp tạm trong cache
            for (const filePath of attachmentPaths) {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (unlinkErr) {
                    console.error("Không thể xóa tệp tạm:", filePath, unlinkErr);
                }
            }
        }
    }
};
