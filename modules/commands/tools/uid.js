const { checkCooldown } = require('../../utils/cooldown');
const { ensureMentionsFromHistory } = require('../../utils/mentionResolver');
const axios = require('axios');

/**
 * Phân giải UID từ đường dẫn hoặc username Facebook
 */
async function resolveUIDFromLink(api, link) {
    link = String(link || "").trim();
    if (!link) return null;

    // 1. Chuỗi số thuần túy (VD: "100054150197536") -> Trả về trực tiếp
    if (/^\d{9,16}$/.test(link)) {
        return link;
    }

    // 2. Link chứa ID dạng profile.php?id=1000xxx hoặc facebook.com/1000xxx
    const profileIdMatch = link.match(/(?:profile\.php\?id=|facebook\.com\/|fb\.com\/)(\d{9,16})/i);
    if (profileIdMatch && profileIdMatch[1]) {
        return profileIdMatch[1];
    }

    // 3. Thử api.getUID từ FCA nếu có
    if (typeof api.getUID === "function") {
        try {
            const uid = await api.getUID(link);
            if (uid && /^\d{9,16}$/.test(String(uid))) {
                return String(uid);
            }
        } catch (e) {}
    }

    // 4. Quét giao diện mbasic HTML
    try {
        let cleanUrl = link;
        if (!cleanUrl.startsWith("http")) {
            cleanUrl = "https://mbasic.facebook.com/" + cleanUrl;
        } else {
            cleanUrl = cleanUrl.replace(/www\.facebook\.com|m\.facebook\.com/i, "mbasic.facebook.com");
        }

        const html = await new Promise((resolve) => {
            api.httpGet(cleanUrl, {}, (err, res) => {
                if (!err && res) resolve(res);
                else resolve(null);
            }, true);
        });

        if (html) {
            const match = html.match(/(?:entity_id|subject_id|target_id|owner_id|profile_id|uid)=(\d{9,16})/i) ||
                          html.match(/href="\/friends\/hovercard\/mbasic\/\?uid=(\d{9,16})/i) ||
                          html.match(/href="\/composer\/mbasic\/\?c_src=profile&amp;t=1&amp;id=(\d{9,16})/i);
            if (match && match[1]) {
                return match[1];
            }
        }
    } catch (e) {}

    // 5. Dự phòng sử dụng API traodoisub
    try {
        const res = await axios.post("https://id.traodoisub.com/api.php", `link=${encodeURIComponent(link)}`, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 6000
        });
        if (res?.data?.id && /^\d{9,16}$/.test(String(res.data.id))) {
            return String(res.data.id);
        }
    } catch (e) {}

    return null;
}

module.exports = {
    name: "uid",
    description: "Lấy ID người dùng (hỗ trợ tag, reply, link Facebook hoặc UID bản thân)",
    usage: "\n!uid → Lấy UID của bản thân\n!uid @tag → Lấy UID người được tag\n!uid (reply) → Lấy UID người được reply\n!uid [link/username FB] → Lấy UID từ link Facebook\n━━━━━━━━━━━━━\n🆔 Trả về Facebook User ID dạng số",

    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;

        await ensureMentionsFromHistory(api, event);

        // Cooldown 5s
        const cooldown = checkCooldown({ command: "uid", key: senderID, durationMs: 5000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }

        let uid = null;

        // 1. Reply tin nhắn
        if (event.type === "message_reply") {
            uid = String(event.messageReply.senderID);
        } 
        // 2. Tag người khác
        else if (event.mentions && Object.keys(event.mentions).length > 0) {
            uid = String(Object.keys(event.mentions)[0]);
        } 
        // 3. Nhập link hoặc username / text
        else if (args[0]) {
            const input = args.join(" ").trim();
            api.sendMessage("🔍 Đang lấy UID từ đường dẫn...", threadID, async (err, info) => {
                const resolvedUID = await resolveUIDFromLink(api, input);
                if (info?.messageID) {
                    try { api.unsendMessage(info.messageID); } catch (e) {}
                }

                if (resolvedUID) {
                    return api.sendMessage(`${resolvedUID}`, threadID, messageID);
                } else {
                    return api.sendMessage("❌ Không thể lấy UID từ đường dẫn hoặc username này. Vui lòng kiểm tra lại link!", threadID, messageID);
                }
            });
            return;
        } 
        // 4. Mặc định lấy UID bản thân
        else {
            uid = String(event.senderID);
        }

        api.sendMessage(`${uid}`, threadID, messageID);
    }
};