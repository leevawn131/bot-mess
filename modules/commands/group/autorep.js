const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { pipeline } = require("stream/promises");
const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const {
    buildMediaPath,
    listAutorepRules,
    removeAutorepRule,
    sanitizeFileName,
    upsertAutorepRule,
} = require("../../utils/autorepSettings");
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

function parseAutorepInput(args) {
    const raw = String(args.join(" ") || "").trim();
    if (!raw) {
        return { keyword: "", responseText: "" };
    }

    const separators = ["|", "=>", "::", " - "];
    for (const separator of separators) {
        const index = raw.indexOf(separator);
        if (index > -1) {
            const keyword = raw.slice(0, index).trim().replace(/^['"]|['"]$/g, "");
            const responseText = raw.slice(index + separator.length).trim();
            return { keyword, responseText };
        }
    }

    const quotedMatch = raw.match(/^(["'])(.+?)\1\s+([\s\S]+)$/);
    if (quotedMatch) {
        return {
            keyword: quotedMatch[2].trim(),
            responseText: quotedMatch[3].trim(),
        };
    }

    const firstSpace = raw.indexOf(" ");
    if (firstSpace === -1) {
        return { keyword: raw.trim(), responseText: "" };
    }

    return {
        keyword: raw.slice(0, firstSpace).trim(),
        responseText: raw.slice(firstSpace + 1).trim(),
    };
}

function formatAutorepRules(threadID) {
    const rules = listAutorepRules(threadID);
    if (!rules.length) {
        return "Chưa có autorep nào.";
    }

    return rules
        .map((rule, index) => {
            const mediaText = rule.media?.path ? " [media]" : "";
            const responseText = rule.responseText ? rule.responseText : "[media only]";
            return `${index + 1}. ${rule.keyword} → ${responseText}${mediaText}`;
        })
        .join("\n");
}

function parseKeywordOnly(args) {
    const raw = String(args.join(" ") || "").trim();
    if (!raw) return "";

    const quotedMatch = raw.match(/^(?:["'])(.+?)(?:["'])$/);
    if (quotedMatch) {
        return quotedMatch[1].trim();
    }

    return raw;
}

module.exports = {
    name: "autorep",
    description: "Tạo autorep theo từ khóa trong nhóm",
    usage: `\n${prefix}autorep [cụm từ] | [nội dung autorep] → Lưu autorep cho nhóm\n${prefix}autorep [cụm từ] | → Lưu chỉ media nếu bạn reply ảnh/video\n${prefix}autorep list → Xem danh sách autorep\n${prefix}autorep del [cụm từ] → Xóa autorep\n${prefix}autorep clear → Xóa hết autorep của nhóm (chỉ chủ bot/adminBot)\nVí dụ: ${prefix}autorep @Ngân Hà | Đúng rồi em\n━━━━━━━━━━━━━━━━━━\n💬 Khi tin nhắn chứa cụm từ, bot sẽ tự nhắn lại nội dung đã cài\n🖼️ Nếu reply ảnh/video khi cài, bot sẽ gửi kèm media đó`,

    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;
        const prefix = config?.prefix || "!";

        const cooldown = checkCooldown({ command: "autorep", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        try {
            const threadInfo = await getThreadInfoCached(api, threadID);
            if (!threadInfo || typeof threadInfo !== "object" || !threadInfo.isGroup) {
                return api.sendMessage("⚠️ Lệnh này chỉ dùng trong nhóm.", threadID, messageID);
            }

            const adminIDs = toAdminIdList(threadInfo);
            const botID = String(api.getCurrentUserID());
            const isSenderAdmin = adminIDs.includes(String(senderID));
            const adminBotUIDs = getAdminBotUIDs();
            const isSenderBotAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;
            const isBotAdmin = adminIDs.includes(botID);

            const action = String(args[0] || "").trim().toLowerCase();

            if (["list", "ls", "show"].includes(action)) {
                return api.sendMessage(
                    `📋 DANH SÁCH AUTOREP\n\n${formatAutorepRules(threadID)}`,
                    threadID,
                    messageID,
                );
            }

            if (["clear", "clr", "reset"].includes(action)) {
                // only adminBot (bot owner) can clear all rules
                if (!isSenderBotAdmin) {
                    return api.sendMessage("❌ Chỉ chủ bot mới được dùng lệnh clear autorep.", threadID, messageID);
                }

                const rules = listAutorepRules(threadID);
                if (!rules.length) {
                    return api.sendMessage("ℹ️ Nhóm chưa có autorep nào để clear.", threadID, messageID);
                }

                for (const r of rules) {
                    try {
                        removeAutorepRule(threadID, r.keyword);
                    } catch (e) {}
                }

                return api.sendMessage(`✅ Đã xóa ${rules.length} autorep cho nhóm này.`, threadID, messageID);
            }

            if (["del", "delete", "remove", "xoa", "xóa"].includes(action)) {
                const keyword = parseKeywordOnly(args.slice(1));
                if (!keyword) {
                    return api.sendMessage(
                        `⚠️ Cách dùng: ${prefix}autorep del [cụm từ]\nVí dụ: ${prefix}autorep del @Ngân Hà`,
                        threadID,
                        messageID,
                    );
                }

                const removed = removeAutorepRule(threadID, keyword);
                if (!removed) {
                    return api.sendMessage(`❌ Không tìm thấy autorep cho từ khóa "${keyword}".`, threadID, messageID);
                }

                return api.sendMessage(`✅ Đã xóa autorep cho từ khóa "${removed.keyword}".`, threadID, messageID);
            }

            const replyAttachment = getThreadAttachment(event);
            const { keyword, responseText } = parseAutorepInput(args);

            if (!keyword || (!responseText && !replyAttachment)) {
                return api.sendMessage(
                    `⚠️ Cách dùng: ${prefix}autorep [cụm từ] | [nội dung autorep]\nVí dụ: ${prefix}autorep @Ngân Hà | Đúng rồi em\nHoặc: ${prefix}autorep @Ngân Hà | (reply ảnh/video để lưu chỉ media)\n\n${formatAutorepRules(threadID)}`,
                    threadID,
                    messageID,
                );
            }
            let media = null;

            if (replyAttachment) {
                const extension = getExtensionFromAttachment(replyAttachment);
                let targetPath = buildMediaPath(threadID, `${keyword}_${Date.now()}`, extension);
                await downloadAttachment(replyAttachment, targetPath);

                const isVideo = String(replyAttachment.type || "").toLowerCase().includes("video") || extension === ".mp4" || extension === ".mov" || extension === ".webm";
                if (isVideo) {
                    try {
                        const compressedPath = buildMediaPath(threadID, `${keyword}_compressed_${Date.now()}`, ".mp4");
                        const ffmpeg = require("fluent-ffmpeg");
                        const ffmpegPath = require("ffmpeg-static");
                        ffmpeg.setFfmpegPath(ffmpegPath);

                        await new Promise((resolve, reject) => {
                            ffmpeg(targetPath)
                                .outputOptions([
                                    "-vcodec libx264",
                                    "-crf 30",
                                    "-preset veryfast",
                                    "-acodec aac",
                                    "-b:a 64k",
                                    "-vf scale=-2:480"
                                ])
                                .on("end", () => resolve())
                                .on("error", (err) => reject(err))
                                .save(compressedPath);
                        });

                        if (fs.existsSync(targetPath)) {
                            fs.unlinkSync(targetPath);
                        }
                        targetPath = compressedPath;
                    } catch (compressError) {
                        console.error("⚠️ [autorep] Lỗi nén video, sử dụng video gốc:", compressError);
                    }
                }

                media = {
                    path: targetPath,
                    type: String(replyAttachment.type || "").trim(),
                    mimeType: String(replyAttachment.mimeType || replyAttachment.mimetype || "").trim(),
                    originalName: sanitizeFileName(replyAttachment.name || path.basename(targetPath)),
                };
            }

            const saved = upsertAutorepRule(threadID, keyword, responseText, media, senderID);
            return api.sendMessage(
                `✅ Đã lưu autorep cho từ khóa "${saved.keyword}"${saved.media?.path ? " kèm media" : ""}.`,
                threadID,
                messageID,
            );
        } catch (error) {
            console.error("❌ Lỗi autorep:", error);
            return api.sendMessage(`❌ Có lỗi xảy ra: ${error.message}`, threadID, messageID);
        }
    },
};