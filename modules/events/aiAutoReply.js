const fs = require("fs");
const { getMediaBuffer } = require("../utils/autorepSettings");
const stream = require("stream");
const { findMatchingRule } = require("../utils/autorepSettings");

function buildAutorepPayload(rule, threadID) {
    const payload = {};

    if (String(rule?.responseText || "").trim()) {
        payload.body = rule.responseText;
    }

    if (rule?.media?.path && fs.existsSync(rule.media.path)) {
        // prefer in-memory buffer for small media to avoid disk I/O
        const buf = getMediaBuffer(threadID, rule.normalizedKeyword);
        if (buf) {
            try {
                const rs = stream.Readable.from(buf);
                // preserve path/filename so downstream API can infer mime/type
                try {
                    rs.path = rule.media.path;
                } catch {}
                payload.attachment = rs;
            } catch (e) {
                payload.attachment = fs.createReadStream(rule.media.path);
            }
        } else {
            payload.attachment = fs.createReadStream(rule.media.path);
        }
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
            const payload = buildAutorepPayload(rule, threadID);

            if (payload.attachment) {
                attachmentStream = payload.attachment;
            }

            // log cache hit/miss and measure send time
            let cacheHit = false;
            let cacheSize = 0;
            try {
                const buf = getMediaBuffer(threadID, rule.normalizedKeyword);
                cacheHit = !!buf;
                cacheSize = buf ? buf.length : 0;
            } catch {}

            const t0 = Date.now();
            await api.sendMessage(payload, threadID, event.messageID);
            const dt = Date.now() - t0;
            try {
                console.log(`[autorep] sent="${rule.keyword}" thread=${threadID} cacheHit=${cacheHit} size=${cacheSize}B time=${dt}ms`);
            } catch {}
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