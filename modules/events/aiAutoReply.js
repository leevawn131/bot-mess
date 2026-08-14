const fs = require("fs");
const { getMediaBuffer, getPreuploadedAttachment, refillPreuploadedPool } = require("../utils/autorepSettings");
const stream = require("stream");
const { findMatchingRule, removeAutorepRule } = require("../utils/autorepSettings");

function buildAutorepPayload(rule, threadID) {
    const payload = {};

    if (String(rule?.responseText || "").trim()) {
        payload.body = rule.responseText;
    }

    if (rule?.media?.path && fs.existsSync(rule.media.path)) {
        // First try to get a pre-uploaded token from the pool
        const token = getPreuploadedAttachment(rule.media.path);
        if (token) {
            payload.attachment = [token];
            payload.isPreuploaded = true;
        } else {
            // Fallback: prefer in-memory buffer for small media to avoid disk I/O
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
    }

    return payload;
}

module.exports = {
    name: "autorep",
    eventType: ["message", "message_reply"],

    run: async function(Obj) { return this.execute(Obj); },
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

        if (rule.responseText) {
            const threadSetting = global.data?.threadData?.get(threadID) || {};
            const systemPrefix = global.config?.PREFIX || global.config?.prefix || prefix || "/";
            const threadPrefix = threadSetting.PREFIX || systemPrefix;
            const invalidPrefixes = [systemPrefix, threadPrefix];
            const uniquePrefixes = [...new Set(invalidPrefixes)].filter(p => typeof p === "string" && p.trim().length > 0);
            
            const hasPrefix = uniquePrefixes.some(pref => rule.responseText.trim().startsWith(pref));
            if (hasPrefix) {
                try {
                    removeAutorepRule(threadID, rule.keyword);
                } catch (e) {
                    console.error("[autorep] Không thể xóa tự động autorep không an toàn:", e);
                }
                return api.sendMessage(
                    `⚠️ Cảnh báo bảo mật: Từ khóa autorep "${rule.keyword}" chứa nội dung phản hồi bắt đầu bằng prefix của bot (${uniquePrefixes.map(p => `"${p}"`).join(", ")}). Hệ thống đã tự động xóa autorep này để đảm bảo an toàn.`,
                    threadID,
                    event.messageID
                );
            }
        }

        // Cooldown check to prevent users from spamming keywords and bot from spamming media
        const { checkCooldown } = require("../utils/cooldown");
        const cooldownKey = `${threadID}:${rule.normalizedKeyword}`;
        const durationMs = rule.media?.path ? 15000 : 5000;
        const cooldown = checkCooldown({
            command: "autorep_trigger",
            key: cooldownKey,
            durationMs
        });
        if (!cooldown.allowed) return;

        let attachmentStream = null;
        try {
            const payload = buildAutorepPayload(rule, threadID);
            const isPreuploaded = payload.isPreuploaded;
            delete payload.isPreuploaded;

            if (payload.attachment && !isPreuploaded) {
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
            console.log(`[autorep] sent="${rule.keyword}" thread=${threadID} preuploaded=${!!isPreuploaded} cacheHit=${cacheHit} size=${cacheSize}B time=${dt}ms`);

            // Refill the pool in the background
            if (rule.media?.path) {
                refillPreuploadedPool(rule.media.path);
            }
        } catch (error) {
            console.error(`❌ Lỗi autorep [${rule.keyword}]:`, error);
            if (attachmentStream) {
                try {
                    attachmentStream.destroy();
                } catch {}
            }

            // Fallback: retry by sending the raw file stream directly (avoiding preuploaded token error)
            try {
                const fallbackPayload = {};
                if (String(rule.responseText || "").trim()) {
                    fallbackPayload.body = rule.responseText;
                }
                if (rule.media?.path && fs.existsSync(rule.media.path)) {
                    fallbackPayload.attachment = fs.createReadStream(rule.media.path);
                }
                await api.sendMessage(fallbackPayload, threadID, event.messageID);
            } catch (fallbackError) {
                console.error(`❌ Lỗi autorep fallback [${rule.keyword}]:`, fallbackError);
            }

            // Trigger pool refill since the popped token might have expired/been invalid
            if (rule.media?.path) {
                refillPreuploadedPool(rule.media.path);
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