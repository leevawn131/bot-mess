const { checkCooldown } = require("../../utils/cooldown");
const { getAdminBotUIDs } = require("../../utils/checkPermission");
const { ensureMentionsFromHistory } = require("../../utils/mentionResolver");
const { execute } = require("../../utils/database");
const {
    isVipUser,
    getVipInfo,
    addVipUser,
    removeVipUser,
    getAllVipUsers,
    SETTINGS_PATH
} = require("../../utils/vipManager");

const prefix = process.env.BOT_PREFIX || "!";

async function resolveUserName(api, uid) {
    const id = String(uid || "").trim();
    if (!id) return "Người dùng";

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
        if (!info) return "Người dùng";

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

    return "Người dùng";
}

function resolveTargetUID(event, args) {
    // 1. Check mentions
    if (event.mentions && Object.keys(event.mentions).length > 0) {
        return Object.keys(event.mentions)[0];
    }

    // 2. Check reply
    if (event.type === "message_reply" && event.messageReply && event.messageReply.senderID) {
        return String(event.messageReply.senderID).trim();
    }

    // 3. Check direct args
    if (args[1] && /^\d+$/.test(args[1])) {
        return String(args[1]).trim();
    }

    return null;
}

module.exports = {
    name: "vip",
    aliases: ["setvip", "vipuser"],
    hasPermission: 2,
    description: "Quản lý danh sách thành viên VIP (Dùng bot ở mode QTV/User)",
    usage:
        `\n👑 [ HƯỚNG DẪN LỆNH VIP - ADMIN BOT ]` +
        `\n━━━━━━━━━━━━━` +
        `\n👉 ${prefix}vip add [@tag / reply / UID] [ghi chú]` +
        `\n   ↳ Thêm thành viên vào danh sách VIP (người tặng acc, bạn bè...)` +
        `\n👉 ${prefix}vip del [@tag / reply / UID]` +
        `\n   ↳ Xóa thành viên khỏi danh sách VIP` +
        `\n👉 ${prefix}vip list` +
        `\n   ↳ Xem toàn bộ danh sách thành viên VIP hiện tại` +
        `\n👉 ${prefix}vip check [@tag / reply / UID]` +
        `\n   ↳ Kiểm tra trạng thái VIP của một người dùng` +
        `\n━━━━━━━━━━━━━` +
        `\n💡 Bạn cũng có thể mở file \`runtime/vip_users.json\` để chỉnh sửa thủ công bằng tay!`,

    execute: async ({ api, event, args, config }) => {
        await ensureMentionsFromHistory(api, event);
        const { threadID, messageID, senderID } = event;

        // Chỉ Admin Bot mới được sử dụng
        const adminBotUIDs = getAdminBotUIDs();
        const isAdmin = Array.isArray(adminBotUIDs) ? adminBotUIDs.includes(String(senderID)) : false;
        if (!isAdmin) {
            return api.sendMessage(
                "⛔ Lệnh này chỉ dành cho Admin Bot!",
                threadID,
                messageID
            );
        }

        const subCmd = String(args[0] || "").toLowerCase();

        // 1. THÊM VIP (ADD)
        if (subCmd === "add" || subCmd === "set" || subCmd === "+") {
            const targetUID = resolveTargetUID(event, args);
            if (!targetUID) {
                return api.sendMessage(
                    `⚠️ Vui lòng Tag, Reply tin nhắn hoặc nhập UID của người cần thêm VIP.\n👉 Ví dụ: ${prefix}vip add @tag Tặng acc clone FB`,
                    threadID,
                    messageID
                );
            }

            // Trích xuất ghi chú/lý do
            let note = "";
            if (event.mentions && Object.keys(event.mentions).length > 0) {
                // Lấy phần text sau khi bỏ lệnh và tag
                const mentionId = Object.keys(event.mentions)[0];
                const tag = event.mentions[mentionId] || "";
                note = args.slice(1).join(" ").replace(tag, "").replace(/@\S+/g, "").trim();
            } else if (event.type === "message_reply") {
                note = args.slice(1).join(" ").trim();
            } else if (args[1] && /^\d+$/.test(args[1])) {
                note = args.slice(2).join(" ").trim();
            }

            if (!note) note = "Ân nhân / Bạn bè của Admin";

            const adminName = await resolveUserName(api, senderID);
            const targetName = await resolveUserName(api, targetUID);

            const success = await addVipUser(targetUID, {
                name: targetName,
                note: note,
                addedBy: adminName || "Admin Bot"
            });

            if (success) {
                return api.sendMessage(
                    `✅ [ THÊM VIP THÀNH CÔNG ]\n━━━━━━━━━━━━━\n👤 Tên: ${targetName}\n🆔 UID: ${targetUID}\n📝 Ghi chú: ${note}\n👑 Người thêm: ${adminName}\n━━━━━━━━━━━━━\n✨ Đặc quyền: Dùng bot khi nhóm ở Mode QTV & Mode User mà không cần là QTV nhóm.\n⚠️ Lưu ý: Vẫn không thể dùng các lệnh Quản trị viên nhóm (khi chưa là QTV) và các lệnh của Admin Bot.`,
                    threadID,
                    messageID
                );
            } else {
                return api.sendMessage(
                    "❌ Có lỗi xảy ra khi lưu dữ liệu VIP. Vui lòng thử lại.",
                    threadID,
                    messageID
                );
            }
        }

        // 2. XÓA VIP (DEL / REMOVE)
        if (subCmd === "del" || subCmd === "delete" || subCmd === "remove" || subCmd === "rm" || subCmd === "-") {
            const targetUID = resolveTargetUID(event, args);
            if (!targetUID) {
                return api.sendMessage(
                    `⚠️ Vui lòng Tag, Reply tin nhắn hoặc nhập UID của người cần xóa khỏi VIP.\n👉 Ví dụ: ${prefix}vip del 100012345678`,
                    threadID,
                    messageID
                );
            }

            const targetName = await resolveUserName(api, targetUID);
            const success = await removeVipUser(targetUID);

            if (success) {
                return api.sendMessage(
                    `✅ Đã xóa thành viên khỏi danh sách VIP:\n👤 Tên: ${targetName}\n🆔 UID: ${targetUID}`,
                    threadID,
                    messageID
                );
            } else {
                return api.sendMessage(
                    `⚠️ Người dùng (UID: ${targetUID}) không có trong danh sách VIP.`,
                    threadID,
                    messageID
                );
            }
        }

        // 3. DANH SÁCH VIP (LIST)
        if (subCmd === "list" || subCmd === "all" || subCmd === "ls") {
            const vipList = await getAllVipUsers();
            if (vipList.length === 0) {
                return api.sendMessage(
                    `📋 Hiện tại danh sách VIP đang trống.\n💡 Dùng \`${prefix}vip add [tag/reply/UID] [lý do]\` để thêm mới.`,
                    threadID,
                    messageID
                );
            }

            let msg = `👑 DANH SÁCH THÀNH VIÊN VIP (${vipList.length})\n━━━━━━━━━━━━━\n`;
            vipList.forEach((user, index) => {
                msg += `${index + 1}. ${user.name}\n   🆔 UID: ${user.id}\n   📝 Ghi chú: ${user.note || "Không có"}\n   ⏰ Ngày thêm: ${user.addedAt || "Không rõ"}\n────────────────────\n`;
            });
            msg += `💡 VIP được dùng bot ở Mode QTV & User mà không cần là QTV nhóm.`;

            return api.sendMessage(msg.trim(), threadID, messageID);
        }

        // 4. KIỂM TRA TRẠNG THÁI VIP (CHECK)
        if (subCmd === "check" || subCmd === "info" || subCmd === "view") {
            let targetUID = resolveTargetUID(event, args);
            if (!targetUID) {
                targetUID = senderID;
            }

            const info = await getVipInfo(targetUID);
            const targetName = await resolveUserName(api, targetUID);

            if (info) {
                return api.sendMessage(
                    `👑 [ THÔNG TIN THÀNH VIÊN VIP ]\n━━━━━━━━━━━━━\n👤 Tên: ${info.name || targetName}\n🆔 UID: ${targetUID}\n⭐ Trạng thái: Đang là VIP\n📝 Ghi chú: ${info.note || "Không có"}\n👑 Người thêm: ${info.addedBy || "Admin"}\n⏰ Ngày thêm: ${info.addedAt || "Không rõ"}\n━━━━━━━━━━━━━\n✨ Đặc quyền: Sử dụng bot ở Mode QTV & Mode User.`,
                    threadID,
                    messageID
                );
            } else {
                return api.sendMessage(
                    `ℹ️ Người dùng ${targetName} (UID: ${targetUID}) HIỆN KHÔNG CÓ trong danh sách VIP.`,
                    threadID,
                    messageID
                );
            }
        }

        // MẶC ĐỊNH: HIỂN THỊ HƯỚNG DẪN SỬ DỤNG
        return api.sendMessage(
            module.exports.usage,
            threadID,
            messageID
        );
    }
};
