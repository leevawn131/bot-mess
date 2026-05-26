const fs = require("fs");
const { findMatchingRule } = require("../utils/autorepSettings");

function buildAutorepPayload(rule) {
    const payload = {};

    if (String(rule?.responseText || "").trim()) {
        payload.body = rule.responseText;
    }

    if (rule?.media?.path && fs.existsSync(rule.media.path)) {
        payload.attachment = fs.createReadStream(rule.media.path);
    }

    return payload;
}

module.exports = {
    name: "autorep",
    eventType: ["message", "message_reply"],

    execute: async ({ api, event, config }) => {
        const body = String(event?.body || "").trim();
        const threadID = String(event?.threadID || "");
        const senderID = String(event?.senderID || "");
        const botID = String(api.getCurrentUserID());
        const prefix = String(config?.prefix || "!");

        if (!body || !threadID || !senderID) return;
        if (senderID === botID) return;
        if (body.startsWith(prefix)) return;

        const rule = findMatchingRule(threadID, body);
        if (!rule) return;

        let attachmentStream = null;
        try {
            const payload = buildAutorepPayload(rule);

            if (payload.attachment) {
                attachmentStream = payload.attachment;
            }

            await api.sendMessage(payload, threadID, event.messageID);
        } catch (error) {
            console.error(`❌ Lỗi autorep [${rule.keyword}]:`, error);
            if (attachmentStream) {
                try {
                    attachmentStream.destroy();
                } catch {}
            }

            try {
                if (String(rule.responseText || "").trim()) {
                    await api.sendMessage({ body: rule.responseText }, threadID, event.messageID);
                } else if (rule.media?.path && fs.existsSync(rule.media.path)) {
                    await api.sendMessage({ attachment: fs.createReadStream(rule.media.path) }, threadID, event.messageID);
                }
            } catch (fallbackError) {
                console.error(`❌ Lỗi autorep fallback [${rule.keyword}]:`, fallbackError);
            }
        } finally {
            if (attachmentStream) {
                try {
                    attachmentStream.destroy();
                } catch {}
            }
        }
    },
};