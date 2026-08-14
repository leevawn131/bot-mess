const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { pipeline } = require("stream/promises");
const { getAdminBotUIDs, toAdminIdList } = require("../../utils/checkPermission");
const { execute: executeQuery } = require("../../utils/database");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const { markMessageNoUnsend } = require("../../utils/noUnsendStorage");

const { checkRentalStatus } = require("../../utils/rental");

const CACHE_DIR = path.resolve(__dirname, "../../../cache");
const STATE_FILE_PATH = path.join(CACHE_DIR, "sendallbox_broadcast_state.json");

function getExtensionFromAttachment(attachment) {
    const mimeType = String(attachment?.mimeType || attachment?.mimetype || "").toLowerCase();
    if (mimeType.includes("image/jpeg") || mimeType.includes("image/jpg")) return ".jpg";
    if (mimeType.includes("image/png")) return ".png";
    if (mimeType.includes("image/gif")) return ".gif";
    if (mimeType.includes("video/mp4")) return ".mp4";
    if (mimeType.includes("video/quicktime")) return ".mov";
    if (mimeType.includes("audio/mpeg") || mimeType.includes("audio/mp3")) return ".mp3";
    if (mimeType.includes("audio/wav")) return ".wav";

    const type = String(attachment?.type || "").toLowerCase();
    if (type === "photo") return ".jpg";
    if (type === "video") return ".mp4";
    if (type === "audio" || type === "voice") return ".mp3";
    if (type === "animated_image") return ".gif";

    const url = String(attachment?.url || "");
    const ext = path.extname(url.split(/[?#]/)[0]).toLowerCase();
    return ext || ".bin";
}

async function downloadAttachment(url, targetPath) {
    const response = await axios.get(String(url), {
        responseType: "stream",
        headers: {
            "User-Agent": "Mozilla/5.0",
        },
    });
    await pipeline(response.data, fs.createWriteStream(targetPath));
}

function readBroadcastState() {
    try {
        if (fs.existsSync(STATE_FILE_PATH)) {
            const data = fs.readFileSync(STATE_FILE_PATH, "utf8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Lỗi khi đọc file state sendallbox:", e.message);
    }
    return null;
}

function writeBroadcastState(state) {
    try {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
        fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), "utf8");
    } catch (e) {
        console.error("Lỗi khi ghi file state sendallbox:", e.message);
    }
}

function clearBroadcastState(tempFilePaths = []) {
    try {
        if (Array.isArray(tempFilePaths)) {
            for (const fp of tempFilePaths) {
                if (fs.existsSync(fp)) {
                    try { fs.unlinkSync(fp); } catch (_) {}
                }
            }
        }
        if (fs.existsSync(STATE_FILE_PATH)) {
            fs.unlinkSync(STATE_FILE_PATH);
        }
    } catch (e) {
        console.error("Lỗi khi dọn dẹp state sendallbox:", e.message);
    }
}

async function getAllGroupThreadIDs() {
    const rentedIDs = [];

    // Chỉ lấy các nhóm đang trong thời hạn thuê (chưa hết hạn và không bị tạm dừng)
    try {
        const rows = await executeQuery("SELECT DISTINCT thread_id FROM rented_groups");
        if (Array.isArray(rows)) {
            for (const r of rows) {
                if (r?.thread_id) {
                    const tid = String(r.thread_id);
                    const isRented = await checkRentalStatus(tid);
                    if (isRented) {
                        rentedIDs.push(tid);
                    }
                }
            }
        }
    } catch (e) {
        console.error("Lỗi lấy danh sách nhóm thuê từ DB:", e.message);
    }

    return rentedIDs;
}

let isBroadcasting = false;

async function processBroadcast(api) {
    if (isBroadcasting) return;
    const state = readBroadcastState();
    if (!state || state.status !== "in_progress") return;

    isBroadcasting = true;
    try {
        const botID = String(api.getCurrentUserID());
        const { adminThreadID, adminMessageID, content, tempFilePaths, shouldPin, noUnsend, allTargetIDs, sentGroups, kickedGroups, failedGroupsList } = state;

        const notifyMsg = content 
            ? `📢 **THÔNG BÁO TỪ ADMIN BOT** 📢\n━━━━━━━━━━━━━━━━━━━━\n${content}`
            : `📢 **THÔNG BÁO TỪ ADMIN BOT** 📢`;

        let isInterrupted = false;

        for (const targetThreadID of allTargetIDs) {
            const tid = String(targetThreadID);

            // Bỏ qua các nhóm đã gửi thành công hoặc đã bị kick từ trước
            if (sentGroups[tid] || kickedGroups[tid]) continue;

            // Kiểm tra thông tin nhóm và xem bot có còn trong nhóm không
            let groupName = "Nhóm không tên";
            let isKicked = false;

            try {
                const info = await getThreadInfoCached(api, tid);
                if (info) {
                    if (info.threadName) groupName = info.threadName;
                    if (info.isGroup === false) {
                        isKicked = true;
                    } else if (Array.isArray(info.participantIDs)) {
                        const pSet = new Set(info.participantIDs.map(String));
                        if (!pSet.has(botID)) {
                            isKicked = true;
                        }
                    }
                }
            } catch (e) {
                // Nếu không lấy được info nhóm do bot bị kick/khóa
                const errMsg = String(e?.message || e);
                if (errMsg.includes("1545012") || errMsg.includes("not in thread") || errMsg.includes("not a participant")) {
                    isKicked = true;
                }
            }

            if (isKicked) {
                console.log(`[SENDALLBOX] Bỏ qua nhóm ${tid} (${groupName}) vì bot đã bị kick khỏi nhóm.`);
                kickedGroups[tid] = true;
                writeBroadcastState(state);
                continue;
            }

            // Tiến hành gửi tin nhắn cho nhóm
            try {
                const msgPayload = { body: notifyMsg };
                if (Array.isArray(tempFilePaths) && tempFilePaths.length > 0) {
                    const validStreams = tempFilePaths.filter(fp => fs.existsSync(fp)).map(fp => fs.createReadStream(fp));
                    if (validStreams.length > 0) msgPayload.attachment = validStreams;
                }

                const sentInfo = await new Promise((resolve, reject) => {
                    api.sendMessage(msgPayload, tid, (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
                    });
                });

                // Gửi thành công -> Ghi nhận ngay xuống đĩa
                sentGroups[tid] = true;
                writeBroadcastState(state);
                console.log(`✅ [SENDALLBOX] Đã gửi thành công tới nhóm ${tid} (${groupName})`);

                const targetMessageID = sentInfo?.messageID || sentInfo?.message_id;

                // Đánh dấu chống gỡ nếu có cú pháp nounsend
                if (noUnsend && targetMessageID) {
                    markMessageNoUnsend(targetMessageID);
                }

                // Ghim tin nhắn nếu được yêu cầu
                if (shouldPin) {
                    if (targetMessageID && typeof api.pinMessage === "function") {
                        try {
                            await api.pinMessage(targetMessageID, tid);
                        } catch (pinErr) {
                            console.error(`Lỗi ghim tin nhắn tại nhóm ${tid}:`, pinErr.message || pinErr);
                        }
                    }
                }

                // Delay 1 giây giữa các nhóm để tránh throttle
                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                const errMsg = String(err?.message || err);
                console.error(`Lỗi khi gửi thông báo tới nhóm ${tid}:`, errMsg);

                if (errMsg.includes("1545012") || errMsg.includes("not in thread") || errMsg.includes("not a participant") || errMsg.includes("kick")) {
                    // Bot bị kick khỏi nhóm
                    kickedGroups[tid] = true;
                    writeBroadcastState(state);
                } else if (errMsg.includes("login") || errMsg.includes("session") || errMsg.includes("checkpoint") || errMsg.includes("ECONNRESET") || errMsg.includes("ETIMEDOUT")) {
                    // Lỗi kết nối / Đăng xuất -> Ngắt vòng lặp để giữ trạng thái dở dang và chờ bot khôi phục đăng nhập lại tiếp tục gửi!
                    console.error("⚠️ [SENDALLBOX] Phát hiện sự cố mạng / văng tài khoản. Tạm dừng đợt gửi để tự động tiếp tục khi khôi phục!");
                    isInterrupted = true;
                    break;
                } else {
                    // Lỗi khác -> Lưu danh sách nhóm thất bại
                    failedGroupsList.push({ id: tid, name: groupName, reason: errMsg });
                    kickedGroups[tid] = true; // Đánh dấu đã qua để không treo lặp lại
                    writeBroadcastState(state);
                }
            }
        }

        // Kiểm tra xem đã xử lý xong HẾT TẤT CẢ CÁC NHÓM chưa
        const processedCount = Object.keys(sentGroups).length + Object.keys(kickedGroups).length;
        const total = allTargetIDs.length;

        if (!isInterrupted && processedCount >= total) {
            // ĐÃ GỬI HẾT BẰNG HẾT TẤT CẢ CÁC NHÓM -> BẮT ĐẦU GỬI BÁO CÁO TỔNG KẾT
            state.status = "completed";
            writeBroadcastState(state);

            const successCount = Object.keys(sentGroups).length;
            const kickedCount = Object.keys(kickedGroups).length;

            let report = `📊 **KẾT QUẢ GỬI THÔNG BÁO HOÀN TẤT**\n━━━━━━━━━━━━━━━━━━━━\n` +
                `• Tổng số nhóm đã quét: ${total}\n` +
                `• Gửi thành công: ${successCount} nhóm\n` +
                `• Đã kick bot / Bỏ qua: ${kickedCount} nhóm`;

            if (failedGroupsList.length > 0) {
                report += `\n\n❌ **DANH SÁCH NHÓM LỖI (KHÔNG GỬI ĐƯỢC):**\n`;
                failedGroupsList.forEach((g, idx) => {
                    report += `${idx + 1}. ${g.name} (ID: ${g.id})\n`;
                });
            }

            try {
                if (adminThreadID) {
                    await api.sendMessage(report.trim(), adminThreadID, adminMessageID);
                }
            } catch (rErr) {
                console.error("Lỗi khi gửi báo cáo kết quả sendallbox về Admin:", rErr.message);
            }

            // Dọn dẹp tệp tạm và file state
            clearBroadcastState(tempFilePaths);
            console.log("🎉 [SENDALLBOX] Đã hoàn tất gửi cho bằng hết tất cả nhóm và báo cáo về Admin!");
        }
    } finally {
        isBroadcasting = false;
    }
}

async function resumeBroadcastIfPending(api) {
    const state = readBroadcastState();
    if (state && state.status === "in_progress") {
        console.log("🔄 [SENDALLBOX] Phát hiện đợt gửi thông báo chưa hoàn tất. Đang tiếp tục gửi cho bằng hết các nhóm còn lại...");
        processBroadcast(api);
    }
}

module.exports = {
    name: "sendallbox",
    description: "Gửi tin nhắn thông báo cho tất cả các nhóm đang thuê bot",
    usage: "\n!sendallbox [nội dung] → Gửi thông báo tới các nhóm đang thuê bot" +
           "\n!sendallbox pin | [nội dung] → Gửi thông báo và tự động ghim tin nhắn" +
           "\n!sendallbox nounsend | [nội dung] → Gửi thông báo kèm chế độ chống gỡ" +
           "\n!sendallbox pin nounsend | [nội dung] → Tự động ghim và chống gỡ thông báo" +
           "\n━━━━━━━━━━━━━" +
           "\n📷 Hỗ trợ đính kèm hoặc reply tin nhắn chứa ảnh/video/âm thanh" +
           "\n💬 QTV / Người thuê reply thông báo sẽ tự động chuyển phản hồi về Admin" +
           "\n🔒 Chỉ Admin Bot mới được sử dụng",

    execute: async ({ api, event, args, config }) => {
        const { threadID, senderID, messageID } = event;
        const prefix = config?.prefix || "!";

        // 1. Kiểm tra quyền Admin Bot
        const adminBotUIDs = getAdminBotUIDs();
        if (!adminBotUIDs.includes(String(senderID))) {
            return api.sendMessage("⚠️ Bạn không có quyền sử dụng lệnh này. Chỉ Admin Bot mới được sử dụng!", threadID, messageID);
        }

        // Nếu đang có một đợt gửi chưa hoàn tất
        const existingState = readBroadcastState();
        if (existingState && existingState.status === "in_progress") {
            const processedCount = Object.keys(existingState.sentGroups || {}).length + Object.keys(existingState.kickedGroups || {}).length;
            const total = (existingState.allTargetIDs || []).length;
            api.sendMessage(`⏳ Hệ thống đang tiếp tục đợt gửi thông báo dở dang (${processedCount}/${total} nhóm thuê)... Vui lòng chờ đợt trước hoàn tất.`, threadID, messageID);
            processBroadcast(api);
            return;
        }

        // 2. Lấy nội dung thông báo & danh sách tệp đính kèm
        let content = args.join(" ").trim();
        let shouldPin = false;
        let noUnsend = false;

        // Xử lý các tiền tố pin / nounsend
        while (true) {
            let matched = false;
            if (/^pin(?:\s*\|\s*|\s+)/i.test(content)) {
                shouldPin = true;
                content = content.replace(/^pin(?:\s*\|\s*|\s+)/i, "").trim();
                matched = true;
            }
            if (/^nounsend(?:\s*\|\s*|\s+)/i.test(content)) {
                noUnsend = true;
                content = content.replace(/^nounsend(?:\s*\|\s*|\s+)/i, "").trim();
                matched = true;
            }
            if (!matched) break;
        }

        const currentAttachments = Array.isArray(event?.attachments) ? event.attachments : [];
        const replyAttachments = Array.isArray(event?.messageReply?.attachments) ? event.messageReply.attachments : [];
        const rawAttachments = [...currentAttachments, ...replyAttachments];
        const validAttachments = rawAttachments.filter(att => att && att.url);

        if (!content && validAttachments.length === 0) {
            return api.sendMessage(`⚠️ Cú pháp sử dụng:\n${prefix}sendallbox [nội dung]\n${prefix}sendallbox pin | [nội dung]\n${prefix}sendallbox nounsend | [nội dung]\n${prefix}sendallbox pin nounsend | [nội dung]\n(Có thể đính kèm hoặc reply tin nhắn có ảnh/video/âm thanh)`, threadID, messageID);
        }

        // 3. Lấy danh sách nhóm chat đang thuê bot
        const allTargetIDs = await getAllGroupThreadIDs();

        if (!allTargetIDs || allTargetIDs.length === 0) {
            return api.sendMessage("⚠️ Hiện tại không có nhóm nào đang trong thời gian thuê bot.", threadID, messageID);
        }

        // 4. Tải các tệp đính kèm về thư mục tạm (nếu có)
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }

        const tempFilePaths = [];
        if (validAttachments.length > 0) {
            await api.sendMessage(`📥 Đang tải ${validAttachments.length} tệp đính kèm...`, threadID);
            for (let i = 0; i < validAttachments.length; i++) {
                const att = validAttachments[i];
                const ext = getExtensionFromAttachment(att);
                const tempPath = path.join(CACHE_DIR, `sendall_${Date.now()}_${i}${ext}`);
                try {
                    await downloadAttachment(att.url, tempPath);
                    tempFilePaths.push(tempPath);
                } catch (err) {
                    console.error(`Lỗi khi tải tệp đính kèm ${i}:`, err.message);
                }
            }
        }

        // 5. Khởi tạo state đợt gửi
        const newState = {
            adminThreadID: String(threadID),
            adminMessageID: messageID,
            adminSenderID: String(senderID),
            content,
            tempFilePaths,
            shouldPin,
            noUnsend,
            allTargetIDs,
            sentGroups: {},
            kickedGroups: {},
            failedGroupsList: [],
            status: "in_progress",
            startedAt: new Date().toISOString()
        };

        writeBroadcastState(newState);

        await api.sendMessage(`📢 Bắt đầu tiến trình gửi thông báo đến ${allTargetIDs.length} nhóm đang thuê bot...${shouldPin ? " (Có ghim tin nhắn)" : ""}\n👉 Hệ thống sẽ gửi báo cáo kết quả khi hoàn tất.`, threadID);

        // Kích hoạt tiến trình gửi
        processBroadcast(api);
    },

    handleReply: async ({ api, event, config }) => {
        const { threadID, senderID, messageID, messageReply } = event;
        if (!messageReply) return;

        const repliedText = String(messageReply.body || "");
        if (!repliedText.startsWith("📢 **THÔNG BÁO TỪ ADMIN BOT** 📢")) {
            return;
        }

        const adminThreadID = "844251878447942";

        try {
            const adminBotUIDs = getAdminBotUIDs();
            let hasPerm = adminBotUIDs.includes(String(senderID));

            if (!hasPerm) {
                try {
                    const { getRenterID } = require("../../utils/rental");
                    const renterID = await getRenterID(threadID);
                    if (renterID && String(senderID) === String(renterID)) {
                        hasPerm = true;
                    }
                } catch (e) {}
            }

            if (!hasPerm) {
                try {
                    const threadInfo = await getThreadInfoCached(api, threadID);
                    if (threadInfo) {
                        const adminIDs = toAdminIdList(threadInfo);
                        if (adminIDs.includes(String(senderID))) {
                            hasPerm = true;
                        }
                    }
                } catch (e) {}
            }

            if (!hasPerm) {
                return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc người thuê bot mới có quyền phản hồi lại thông báo này.", threadID, messageID);
            }

            let senderName = "Người dùng";
            let threadName = "Nhóm không tên";
            try {
                const threadInfo = await getThreadInfoCached(api, threadID);
                if (threadInfo) {
                    if (threadInfo.threadName) threadName = threadInfo.threadName;
                    const user = threadInfo.userInfo?.find(u => String(u.id) === String(senderID));
                    if (user && user.name) senderName = user.name;
                }
            } catch (e) {}

            const currentAttachments = Array.isArray(event?.attachments) ? event.attachments : [];
            const validAttachments = currentAttachments.filter(att => att && att.url);

            const tempFilePaths = [];
            if (validAttachments.length > 0) {
                if (!fs.existsSync(CACHE_DIR)) {
                    fs.mkdirSync(CACHE_DIR, { recursive: true });
                }
                for (let i = 0; i < validAttachments.length; i++) {
                    const att = validAttachments[i];
                    const ext = getExtensionFromAttachment(att);
                    const tempPath = path.join(CACHE_DIR, `replyall_${Date.now()}_${i}${ext}`);
                    try {
                        await downloadAttachment(att.url, tempPath);
                        tempFilePaths.push(tempPath);
                    } catch (err) {
                        console.error(`Lỗi khi tải tệp đính kèm phản hồi ${i}:`, err.message);
                    }
                }
            }

            const forwardMsg = `📩 **PHẢN HỒI THÔNG BÁO** 📩\n` +
                               `━━━━━━━━━━━━━━━━━━━━\n` +
                               `👤 **Người gửi**: ${senderName} (ID: ${senderID})\n` +
                               `👥 **Nhóm**: ${threadName} (ID: ${threadID})\n` +
                               `💬 **Nội dung phản hồi**:\n${event.body || "[Chỉ gửi kèm tệp đính kèm]"}`;

            try {
                const msgPayload = { body: forwardMsg };
                if (tempFilePaths.length > 0) {
                    msgPayload.attachment = tempFilePaths.map(p => fs.createReadStream(p));
                }
                await api.sendMessage(msgPayload, adminThreadID);
                await api.sendMessage("✅ Đã chuyển tiếp phản hồi của bạn tới Admin thành công!", threadID, messageID);
            } catch (err) {
                console.error("Lỗi khi chuyển tiếp phản hồi về Admin Box:", err);
                await api.sendMessage("❌ Gặp lỗi khi chuyển tiếp phản hồi của bạn tới Admin.", threadID, messageID);
            } finally {
                for (const filePath of tempFilePaths) {
                    try {
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    } catch (e) {
                        console.error("Lỗi khi xóa tệp tạm:", e.message);
                    }
                }
            }

        } catch (error) {
            console.error("Lỗi trong sendallbox handleReply:", error);
        }
    },

    resumeBroadcastIfPending
};
