const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { checkRentalStatus } = require("../../utils/rental");
const { execute } = require("../../utils/database");
const { getThreadInfoCached } = require("../../utils/threadInfo");

async function resolveUserName(api, uid) {
  const id = String(uid || "").trim();
  if (!id) return null;

  if (global.data?.userName?.has(id)) {
    return global.data.userName.get(id);
  }

  try {
    const rows = await execute("SELECT name FROM messenger_users WHERE psid = ? AND name != 'Người dùng' AND name != '' LIMIT 1", [id]);
    if (rows && rows[0] && rows[0].name) {
      if (global.data?.userName) global.data.userName.set(id, rows[0].name);
      return rows[0].name;
    }
  } catch {}

  try {
    const info = await api.getUserInfo(id);
    if (!info) return null;

    let foundName = null;
    if (info[id] && typeof info[id].name === 'string' && info[id].name.trim()) {
      foundName = info[id].name.trim();
    } else if (typeof info.name === 'string' && info.name.trim()) {
      foundName = info.name.trim();
    } else if (Array.isArray(info) && info.length > 0) {
      const first = info[0];
      if (first && typeof first === 'object') {
        if (first[id] && typeof first[id].name === 'string') foundName = first[id].name.trim();
        else if (typeof first.name === 'string') foundName = first.name.trim();
      }
    }

    if (foundName) {
      if (global.data?.userName) global.data.userName.set(id, foundName);
      return foundName;
    }
  } catch {}

  return null;
}

module.exports = {
  name: "gopy",
  description: "Gửi góp ý hoặc phản hồi của người thuê bot tới Admin",
  usage: "\n!gopy [nội dung góp ý] → Gửi góp ý tới Admin\n━━━━━━━━━━━━━\n💡 Ví dụ: !gopy Lệnh tài xỉu bị lỗi hiển thị xúc sắc",

  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;
    const prefix = config?.prefix || "!";

    // 1. Kiểm tra spam (cooldown 60s)
    const cooldown = checkCooldown({
      command: "gopy",
      key: senderID,
      durationMs: 60000,
    });

    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi gửi tiếp góp ý.`,
        threadID,
        messageID
      );
    }

    // 2. Kiểm tra quyền của người dùng (người thuê bot hoặc admin)
    const adminBotUIDs = getAdminBotUIDs();
    const isAdmin = adminBotUIDs.includes(String(senderID));

    const isCurrentGroupRented = await checkRentalStatus(threadID);

    let isRenter = false;
    try {
      const renterCheck = await execute(
        "SELECT 1 FROM rented_groups WHERE renter_id = ? AND expire_date > CURRENT_TIMESTAMP LIMIT 1",
        [String(senderID)]
      );
      isRenter = renterCheck && renterCheck.length > 0;
    } catch (e) {
      console.error("Lỗi khi kiểm tra renter ID trong Database:", e);
    }

    const isAuthorized = isAdmin || isCurrentGroupRented || isRenter;
    if (!isAuthorized) {
      return api.sendMessage(
        "⚠️ Lệnh này chỉ dành cho người thuê bot hoặc nhóm đang thuê bot sử dụng.",
        threadID,
        messageID
      );
    }

    // 3. Kiểm tra nội dung góp ý
    const content = args.join(" ").trim();
    if (!content) {
      return api.sendMessage(
        `⚠️ Vui lòng nhập nội dung góp ý.\nCú pháp: ${prefix}gopy [nội dung]`,
        threadID,
        messageID
      );
    }

    // 4. Lấy thông tin người gửi và nhóm
    let senderName = "Không rõ";
    try {
      const resolvedName = await resolveUserName(api, senderID);
      if (resolvedName) senderName = resolvedName;
    } catch (e) {}

    let groupName = "Trò chuyện cá nhân";
    try {
      const tInfo = await getThreadInfoCached(api, threadID);
      if (tInfo && tInfo.threadName) groupName = tInfo.threadName;
    } catch (e) {}

    // 5. Tạo tin nhắn góp ý để gửi tới nhóm admin
    const targetAdminThreadID = "844251878447942";
    const feedbackMsg = `📩 **GÓP Ý TỪ NGƯỜI DÙNG** 📩\n━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 **Người góp ý:** ${senderName}\n` +
      `🆔 **UID:** ${senderID}\n` +
      `👥 **Nhóm:** ${groupName}\n` +
      `🆔 **TID:** ${threadID}\n` +
      `📝 **Nội dung:** ${content}\n` +
      `━━━━━━━━━━━━━━━━━━━━`;

    try {
      await api.sendMessage(feedbackMsg, targetAdminThreadID);
      return api.sendMessage(
        "✅ Đã gửi góp ý của bạn đến Admin thành công! Cảm ơn bạn đã đóng góp ý kiến.",
        threadID,
        messageID
      );
    } catch (err) {
      console.error("Lỗi gửi tin nhắn góp ý tới nhóm Admin:", err);
      return api.sendMessage(
        "❌ Không thể gửi góp ý của bạn tới Admin lúc này. Vui lòng thử lại sau!",
        threadID,
        messageID
      );
    }
  }
};
