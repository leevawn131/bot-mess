const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { execute } = require("../../utils/database");
const { ensureAutosendSchema } = require("../../utils/autosendSchema");
const { getAdminBotUIDs, toAdminIdList, checkPermission } = require("../../utils/checkPermission");
const { getThreadInfoCached } = require("../../utils/threadInfo");
const { getVNTimeInfo } = require("../../utils/autosendScheduler");
const config = require("../../../config.json");

/**
 * Tìm lệnh dựa vào tên lệnh hoặc alias
 */
function resolveCommand(commandName) {
  const key = String(commandName || "").trim().toLowerCase();
  if (!key || !global.commands || !(global.commands instanceof Map)) return null;

  const direct = global.commands.get(commandName) || global.commands.get(key);
  if (direct) return direct;

  for (const command of global.commands.values()) {
    const names = [command?.name, command?.config?.name]
      .concat(command?.aliases || [])
      .concat(command?.config?.aliases || [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);

    if (names.includes(key)) {
      return command;
    }
  }

  return null;
}

const prefix = config?.prefix || "/";

// Thư mục lưu trữ media lâu dài
const MEDIA_DIR = path.join(__dirname, "../../../cache", "autosend_media");
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

/**
 * Tải media từ URL attachment và lưu vào cache/autosend_media
 */
async function saveAttachment(url, type) {
  try {
    let ext = ".tmp";
    if (type === "photo") ext = ".png";
    else if (type === "video") ext = ".mp4";
    else if (type === "audio") ext = ".mp3";
    else if (type === "animated_image") ext = ".gif";

    const filename = `media_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    const filePath = path.join(MEDIA_DIR, filename);

    const response = await axios({
      method: "get",
      url: url,
      responseType: "stream",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    // Lấy extension thật từ header nếu có
    let finalPath = filePath;
    const contentType = response.headers["content-type"] || "";
    if (contentType.includes("image/")) {
      const t = contentType.split("/")[1] || "png";
      finalPath = filePath.replace(ext, `.${t}`);
    } else if (contentType.includes("video/")) {
      const t = contentType.split("/")[1] || "mp4";
      finalPath = filePath.replace(ext, `.${t}`);
    } else if (contentType.includes("audio/")) {
      const t = contentType.split("/")[1] || "mp3";
      finalPath = filePath.replace(ext, `.${t}`);
    }

    const writer = fs.createWriteStream(finalPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        // Trả về đường dẫn tương đối để lưu database gọn gàng
        const botRootDir = path.resolve(__dirname, "../../../");
        const relativePath = path.relative(botRootDir, finalPath);
        resolve(relativePath);
      });
      writer.on("error", (err) => {
        fs.unlink(finalPath, () => {});
        reject(err);
      });
    });
  } catch (error) {
    console.error("Lỗi lưu file attachment:", error.message);
    return null;
  }
}

module.exports = {
  name: "autosend",
  description: "Tự động gửi tin nhắn theo khung giờ cố định và lịch tùy chỉnh",
  usage: `\n• ${prefix}autosend <giờ:phút> [lịch] <nội dung> (Reply media để đính kèm)\n• ${prefix}autosend list (Xem danh sách lịch)\n• ${prefix}autosend toggle <id_lịch> (Bật/tắt lịch)\n• ${prefix}autosend delete <id_lịch> (Xóa lịch)`,
  hasPermission: 1, // Quản trị viên nhóm

  execute: async ({ api, event, args }) => {
    const { threadID, messageID, senderID, messageReply, attachments } = event;

    try {
      await ensureAutosendSchema();

      // 1. Kiểm tra quyền hạn (QTV nhóm hoặc Admin Bot)
      const threadInfo = await getThreadInfoCached(api, threadID);
      const adminIDs = toAdminIdList(threadInfo);
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const adminBotUIDs = getAdminBotUIDs();
      const isSenderBotAdmin = adminBotUIDs.includes(String(senderID));

      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc Admin Bot mới được sử dụng lệnh này.", threadID, messageID);
      }

      const cmdPrefix = global.config?.prefix || prefix;

      if (args.length === 0) {
        return api.sendMessage(
          `📝 Hướng dẫn sử dụng lệnh autosend:\n` +
          `━━━━━━━━━━━━━\n` +
          `1️⃣ Tạo lịch mới:\n` +
          `👉 Cú pháp: ${cmdPrefix}autosend <giờ:phút> [lịch] <nội dung>\n` +
          `• [lịch] có thể chọn: daily (mỗi ngày), weekly (hàng tuần vào thứ của ngày tạo), monthly (hàng tháng vào ngày hiện tại), monthly5 (ngày 5 hàng tháng), hoặc t2/t4/t6 (chỉ gửi các thứ 2/4/6).\n` +
          `• Nếu không chỉ định [lịch], bot mặc định là daily.\n` +
          `• Phản hồi (reply) tin nhắn có chứa ảnh/video/nhạc để đính kèm file media.\n\n` +
          `2️⃣ Xem danh sách:\n` +
          `👉 Cú pháp: ${cmdPrefix}autosend list\n\n` +
          `3️⃣ Bật/Tắt lịch:\n` +
          `👉 Cú pháp: ${cmdPrefix}autosend toggle <id>\n\n` +
          `4️⃣ Xóa lịch:\n` +
          `👉 Cú pháp: ${cmdPrefix}autosend del <id> hoặc reply tin nhắn list kèm số thứ tự.`,
          threadID,
          messageID
        );
      }

      const action = String(args[0]).toLowerCase().trim();

      // --- CHỨC NĂNG 1: LIST DANH SÁCH ---
      if (action === "list") {
        // Nếu là admin bot: có thể xem được tất cả box, nếu là QTV nhóm chỉ xem của nhóm hiện tại
        let query = "SELECT * FROM autosend_jobs WHERE thread_id = ? ORDER BY time ASC";
        let params = [threadID];

        // Nếu admin bot nhắn ở inbox hoặc muốn xem tất cả
        if (isSenderBotAdmin && !event.isGroup) {
          query = "SELECT * FROM autosend_jobs ORDER BY thread_id, time ASC";
          params = [];
        }

        const jobs = await execute(query, params);

        if (!jobs || jobs.length === 0) {
          return api.sendMessage("📭 Hiện tại nhóm chưa có lịch gửi tin nhắn tự động nào.", threadID, messageID);
        }

        let msg = `⏰ DANH SÁCH LỊCH GỬI TỰ ĐỘNG KHU VỰC NÀY ⏰\n━━━━━━━━━━━━━\n\n`;
        const jobList = [];

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          const stt = i + 1;
          jobList.push({ stt, id: job.id });

          let scheduleText = job.schedule_type;
          if (scheduleText === "daily") scheduleText = "Hàng ngày";
          else if (scheduleText.startsWith("monthly")) {
            const mDay = scheduleText.replace("monthly", "");
            scheduleText = `Hàng tháng (Ngày ${mDay})`;
          } else if (scheduleText.startsWith("t") || scheduleText === "cn") {
            scheduleText = `Thứ: ${scheduleText.toUpperCase()}`;
          }

          const statusText = job.status === 1 ? "🟢 ĐANG BẬT" : "🔴 ĐANG TẮT";
          const hasMedia = job.media_path ? "📁 Có" : "❌ Không";

          let groupName = "";
          if (isSenderBotAdmin && !event.isGroup) {
            try {
              const tInfo = await getThreadInfoCached(api, job.thread_id);
              groupName = ` [Nhóm: ${tInfo?.threadName || job.thread_id}]`;
            } catch (e) {
              groupName = ` [TID: ${job.thread_id}]`;
            }
          }

          msg += `STT [ ${stt} ] - ID: ${job.id}${groupName}\n`;
          msg += `⏰ Giờ gửi: ${job.time}\n`;
          msg += `📅 Lịch gửi: ${scheduleText}\n`;
          msg += `📁 Đính kèm: ${hasMedia}\n`;
          msg += `⚡ Trạng thái: ${statusText}\n`;
          msg += `💬 Nội dung: ${job.message || "(Chỉ gửi file media)"}\n`;
          msg += `━━━━━━━━━━━━━\n\n`;
        }

        msg += `👉 Reply số thứ tự để XÓA nhanh (ví dụ: 1 hoặc 1, 2).\n👉 Gõ STT + on/off để BẬT/TẮT nhanh (ví dụ: 1 off hoặc 1, 2 on).`;

        const listInfo = await api.sendMessage(msg.trimEnd(), threadID, messageID);

        // Đăng ký handleReply để xóa nhanh
        if (!global.client.handleReply) global.client.handleReply = [];
        // Dọn dẹp handleReply cũ của autosend trong thread này
        global.client.handleReply = global.client.handleReply.filter(
          item => !(item.name === "autosend" && item.threadID === threadID)
        );

        global.client.handleReply.push({
          name: "autosend",
          type: "list_reply",
          author: senderID,
          messageID: listInfo.messageID,
          threadID: threadID,
          jobs: jobList
        });

        return;
      }

      // --- CHỨC NĂNG 2: TOGGLE BẬT/TẮT ---
      if (action === "toggle") {
        const targetId = parseInt(args[1]);
        if (isNaN(targetId)) {
          return api.sendMessage("⚠️ Vui lòng nhập ID lịch hợp lệ. Ví dụ: /autosend toggle 3", threadID, messageID);
        }

        // Lấy thông tin công việc để kiểm tra quyền
        const job = await execute("SELECT * FROM autosend_jobs WHERE id = ?", [targetId]);
        if (!job || job.length === 0) {
          return api.sendMessage(`❌ Không tìm thấy lịch gửi nào có ID là ${targetId}`, threadID, messageID);
        }

        if (job[0].thread_id !== threadID && !isSenderBotAdmin) {
          return api.sendMessage("❌ Bạn không có quyền bật/tắt lịch của nhóm khác.", threadID, messageID);
        }

        const newStatus = job[0].status === 1 ? 0 : 1;
        await execute("UPDATE autosend_jobs SET status = ? WHERE id = ?", [newStatus, targetId]);

        const statusMsg = newStatus === 1 ? "🟢 Đã BẬT kích hoạt" : "🔴 Đã TẮT kích hoạt";
        return api.sendMessage(`✅ ${statusMsg} thành công cho lịch gửi ID: ${targetId}`, threadID, messageID);
      }

      // --- CHỨC NĂNG 3: XÓA LỊCH ---
      if (action === "delete" || action === "del") {
        const targetId = parseInt(args[1]);
        if (isNaN(targetId)) {
          return api.sendMessage("⚠️ Vui lòng nhập ID lịch hợp lệ để xóa. Ví dụ: /autosend del 3", threadID, messageID);
        }

        // Lấy thông tin công việc để xóa file media
        const job = await execute("SELECT * FROM autosend_jobs WHERE id = ?", [targetId]);
        if (!job || job.length === 0) {
          return api.sendMessage(`❌ Không tìm thấy lịch gửi nào có ID là ${targetId}`, threadID, messageID);
        }

        if (job[0].thread_id !== threadID && !isSenderBotAdmin) {
          return api.sendMessage("❌ Bạn không có quyền xóa lịch của nhóm khác.", threadID, messageID);
        }

        // Xóa file media nếu có
        if (job[0].media_path) {
          const botRootDir = path.resolve(__dirname, "../../../");
          const filePath = path.isAbsolute(job[0].media_path)
            ? job[0].media_path
            : path.resolve(botRootDir, job[0].media_path);
          if (fs.existsSync(filePath)) {
            fs.unlink(filePath, () => {});
          }
        }

        await execute("DELETE FROM autosend_jobs WHERE id = ?", [targetId]);
        return api.sendMessage(`✅ Đã xóa thành công lịch gửi ID: ${targetId}`, threadID, messageID);
      }

      // --- CHỨC NĂNG 4: THÊM LỊCH MỚI (Cú pháp trực tiếp: /autosend <giờ:phút> [loại_lịch] <nội dung>) ---
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (timeRegex.test(action)) {
        // Chuẩn hóa giờ gửi thành HH:mm
        const [h, m] = action.split(":");
        const formattedTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

        let scheduleType = "daily";
        let messageStartIdx = 1;

        // Kiểm tra xem tham số tiếp theo có phải loại lịch không
        if (args.length > 1) {
          const secondArg = String(args[1]).toLowerCase().trim();
          const scheduleRegex = /^(daily|weekly|monthly|monthly\d+|(t[2-7]|cn)(\/(t[2-7]|cn))*)$/;
          
          if (scheduleRegex.test(secondArg)) {
            scheduleType = secondArg;
            messageStartIdx = 2;
          }
        }

        // Lấy nội dung tin nhắn
        const messageContent = args.slice(messageStartIdx).join(" ").trim();

        // Kiểm tra xem tin nhắn có phải là lệnh bot hay không, nếu có thì kiểm tra quyền ngay lúc cài đặt
        if (messageContent) {
          const msgStr = messageContent.trim();
          if (msgStr.startsWith(cmdPrefix) && msgStr.length > cmdPrefix.length) {
            const commandText = msgStr.slice(cmdPrefix.length).trim();
            const rawArgs = commandText ? commandText.split(/ +/) : [];
            if (rawArgs.length > 0) {
              const commandName = rawArgs[0].toLowerCase();
              const command = resolveCommand(commandName);
              if (command) {
                // Kiểm tra quyền hạn của người gửi đối với lệnh này
                const permCheck = await checkPermission(threadID, senderID, api, commandName);
                if (!permCheck.allowed) {
                  return api.sendMessage(
                    `❌ Bạn không có quyền cài đặt lệnh ngầm này.\n🔍 Lý do: ${permCheck.reason || "Lệnh yêu cầu quyền cao hơn."}`,
                    threadID,
                    messageID
                  );
                }
                console.log(`[AUTOSEND] Đã xác thực quyền cài đặt lệnh ngầm: ${commandName} cho UID: ${senderID}`);
              }
            }
          }
        }

        // Kiểm tra xem có đính kèm file media nào không
        let mediaPath = null;
        let attachmentUrl = null;
        let attachmentType = null;

        // Trích xuất attachment từ tin nhắn reply hoặc tin nhắn hiện tại
        if (messageReply && messageReply.attachments && messageReply.attachments.length > 0) {
          attachmentUrl = messageReply.attachments[0].url;
          attachmentType = messageReply.attachments[0].type;
        } else if (attachments && attachments.length > 0) {
          attachmentUrl = attachments[0].url;
          attachmentType = attachments[0].type;
        }

        // Nếu có attachment, thực hiện tải và lưu
        if (attachmentUrl) {
          const savingMsg = await api.sendMessage("📥 Đang tải và xử lý file media đính kèm...", threadID);
          mediaPath = await saveAttachment(attachmentUrl, attachmentType);
          if (savingMsg && savingMsg.messageID) {
            api.unsendMessage(savingMsg.messageID);
          }
          if (!mediaPath) {
            return api.sendMessage("❌ Thất bại khi tải file media. Vui lòng thử lại.", threadID, messageID);
          }
        }

        // Nếu không có cả nội dung tin nhắn lẫn media
        if (!messageContent && !mediaPath) {
          return api.sendMessage("⚠️ Vui lòng nhập nội dung tin nhắn hoặc đính kèm media để gửi.", threadID, messageID);
        }

        // Xử lý các loại lịch đặc biệt. Nếu giờ đã qua tại thời điểm tạo,
        // đánh dấu hôm nay là đã xử lý để scheduler không gửi bù ngay lập tức.
        const { timeKey: currentTime, dateKey: currentDate, dayOfMonth, dayOfWeekStr } = getVNTimeInfo();
        const initialLastSent = formattedTime < currentTime ? currentDate : null;
        if (scheduleType === "weekly") {
          scheduleType = dayOfWeekStr; // Lấy thứ hiện tại
        } else if (scheduleType === "monthly") {
          scheduleType = `monthly${dayOfMonth}`; // Lấy ngày mùng hiện tại
        }

        // Thêm vào database
        const insertRes = await execute(
          `INSERT INTO autosend_jobs (thread_id, time, schedule_type, message, media_path, created_by, last_sent)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [threadID, formattedTime, scheduleType, messageContent || null, mediaPath, senderID, initialLastSent]
        );

        let scheduleLabel = scheduleType;
        if (scheduleLabel === "daily") scheduleLabel = "Hàng ngày";
        else if (scheduleLabel.startsWith("monthly")) {
          scheduleLabel = `Hàng tháng (ngày ${scheduleLabel.replace("monthly", "")})`;
        } else if (scheduleLabel.startsWith("t") || scheduleLabel === "cn") {
          scheduleLabel = `Thứ: ${scheduleLabel.toUpperCase()}`;
        }

        const mediaStatus = mediaPath ? "Có kèm file media 📁" : "Không kèm media";
        const startNotice = initialLastSent
          ? "\nℹ️ Giờ hôm nay đã qua; lịch sẽ bắt đầu chạy từ lần phù hợp tiếp theo."
          : "";
        return api.sendMessage(
          `✅ Đã tạo lịch gửi tin nhắn tự động thành công!\n` +
          `━━━━━━━━━━━━━\n` +
          `🆔 ID lịch: ${insertRes.insertId || "Vừa tạo"}\n` +
          `⏰ Giờ gửi: ${formattedTime}\n` +
          `📅 Lịch gửi: ${scheduleLabel}\n` +
          `📁 Media: ${mediaStatus}\n` +
          `💬 Nội dung: ${messageContent || "(Chỉ gửi file media)"}` +
          startNotice,
          threadID,
          messageID
        );
      }

      return api.sendMessage(`⚠️ Cú pháp không hợp lệ. Gõ "/autosend" để xem hướng dẫn sử dụng.`, threadID, messageID);

    } catch (error) {
      console.error("Lỗi thực thi lệnh autosend:", error);
      return api.sendMessage(`❌ Đã xảy ra lỗi: ${error.message}`, threadID, messageID);
    }
  },

  handleReply: async ({ api, event, config }) => {
    const { threadID, messageID, senderID, body, messageReply } = event;
    if (!messageReply || !messageReply.messageID) return;

    const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
    const handleReplyObj = list.find(h => String(h.messageID) === String(messageReply.messageID) && h.name === "autosend");
    if (!handleReplyObj) return;
    
    // Chỉ cho phép tác giả của lệnh list thực thi reply
    if (String(senderID) !== String(handleReplyObj.author)) return;

    try {
      await ensureAutosendSchema();

      // Quyền hạn
      const threadInfo = await getThreadInfoCached(api, threadID);
      const adminIDs = toAdminIdList(threadInfo);
      const isSenderAdmin = adminIDs.includes(String(senderID));
      const adminBotUIDs = getAdminBotUIDs();
      const isSenderBotAdmin = adminBotUIDs.includes(String(senderID));

      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage("⚠️ Chỉ Quản trị viên nhóm hoặc Admin Bot mới được sử dụng thao tác này.", threadID, messageID);
      }

      const input = String(body).trim();
      
      // Chuẩn hóa ký tự phân cách (phẩy, gạch chéo, chấm phẩy...) thành khoảng trắng
      const normalizedInput = input.replace(/[,/;+\-]+/g, " ");
      const tokens = normalizedInput.split(/\s+/).filter(Boolean);
      
      // Xác định hành động
      let actionType = "delete"; // Mặc định là xóa
      const deleteKeywords = ["del", "xoa", "delete", "remove"];
      const onKeywords = ["on", "bat", "enable", "active"];
      const offKeywords = ["off", "tat", "disable", "inactive"];
      const toggleKeywords = ["toggle", "tg"];
      
      const sttList = [];
      
      for (const token of tokens) {
        const lowerToken = token.toLowerCase();
        if (deleteKeywords.includes(lowerToken)) {
          actionType = "delete";
        } else if (onKeywords.includes(lowerToken)) {
          actionType = "on";
        } else if (offKeywords.includes(lowerToken)) {
          actionType = "off";
        } else if (toggleKeywords.includes(lowerToken)) {
          actionType = "toggle";
        } else if (/^\d+$/.test(token)) {
          sttList.push(parseInt(token));
        }
      }
      
      if (sttList.length === 0) {
        return; // Không có STT nào thì bỏ qua không xử lý
      }

      // Lọc các job trùng lặp nếu người dùng nhập trùng STT
      const uniqueSttList = [...new Set(sttList)];
      const successes = [];
      const failures = [];

      for (const stt of uniqueSttList) {
        const matchedJob = handleReplyObj.jobs.find(j => j.stt === stt);
        if (!matchedJob) {
          failures.push(`STT ${stt}: Không tìm thấy`);
          continue;
        }

        const targetId = matchedJob.id;

        try {
          if (actionType === "delete") {
            const job = await execute("SELECT * FROM autosend_jobs WHERE id = ?", [targetId]);
            if (job && job.length > 0) {
              if (job[0].media_path) {
                const botRootDir = path.resolve(__dirname, "../../../");
                const filePath = path.isAbsolute(job[0].media_path)
                  ? job[0].media_path
                  : path.resolve(botRootDir, job[0].media_path);
                if (fs.existsSync(filePath)) {
                  fs.unlink(filePath, () => {});
                }
              }
              await execute("DELETE FROM autosend_jobs WHERE id = ?", [targetId]);
              successes.push(`Xóa STT ${stt} (ID: ${targetId})`);
            } else {
              failures.push(`STT ${stt} (ID: ${targetId}): Không tồn tại trên hệ thống`);
            }
          } else if (actionType === "on" || actionType === "off") {
            const statusVal = actionType === "on" ? 1 : 0;
            const updated = await execute("UPDATE autosend_jobs SET status = ? WHERE id = ?", [statusVal, targetId]);
            if (updated && updated.affectedRows > 0) {
              successes.push(`Thay đổi trạng thái STT ${stt} (ID: ${targetId}) thành ${statusVal === 1 ? "BẬT" : "TẮT"}`);
            } else {
              failures.push(`STT ${stt}: Không thể thay đổi hoặc không tìm thấy`);
            }
          } else if (actionType === "toggle") {
            const job = await execute("SELECT status FROM autosend_jobs WHERE id = ?", [targetId]);
            if (job && job.length > 0) {
              const newStatus = job[0].status === 1 ? 0 : 1;
              await execute("UPDATE autosend_jobs SET status = ? WHERE id = ?", [newStatus, targetId]);
              successes.push(`Đổi trạng thái STT ${stt} (ID: ${targetId}) thành ${newStatus === 1 ? "BẬT" : "TẮT"}`);
            } else {
              failures.push(`STT ${stt}: Không tìm thấy`);
            }
          }
        } catch (err) {
          failures.push(`STT ${stt}: Lỗi (${err.message})`);
        }
      }

      // Phản hồi kết quả
      let resultMsg = "";
      if (successes.length > 0) {
        resultMsg += `✅ Thành công:\n${successes.map(s => `• ${s}`).join("\n")}\n`;
      }
      if (failures.length > 0) {
        resultMsg += `❌ Thất bại:\n${failures.map(f => `• ${f}`).join("\n")}\n`;
      }

      // Nếu là hành động xóa thành công tất cả lịch đã chọn, ta gỡ tin nhắn list cũ đi
      if (actionType === "delete" && successes.length === uniqueSttList.length) {
        try {
          api.unsendMessage(handleReplyObj.messageID);
        } catch (e) {}
        
        // Gỡ handleReply khỏi cache
        if (global.client.handleReply) {
          global.client.handleReply = global.client.handleReply.filter(
            item => !(item.messageID === handleReplyObj.messageID)
          );
        }
      }

      return api.sendMessage(resultMsg.trim(), threadID, messageID);

    } catch (e) {
      console.error("Lỗi handleReply autosend:", e);
      return api.sendMessage(`❌ Đã xảy ra lỗi khi thực thi xóa: ${e.message}`, threadID, messageID);
    }
  }
};
