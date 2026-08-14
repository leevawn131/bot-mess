const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "../../cache/autorep_settings.json");
const MEDIA_DIR = path.join(__dirname, "../../cache/autorep_media");
const MEDIA_BUFFER_CACHE_SIZE = 10 * 1024 * 1024; // 10 MB

// LRU in-memory cache for small media files: key = `${threadID}|${normalizedKeyword}` => Buffer
const mediaBufferCache = new Map();
let mediaBufferTotalBytes = 0;

function setMediaBuffer(key, buf) {
    try {
        if (!key) return;
        if (!buf) {
            const old = mediaBufferCache.get(key);
            if (old) {
                mediaBufferTotalBytes -= old.length || 0;
                mediaBufferCache.delete(key);
            }
            return;
        }

        const existing = mediaBufferCache.get(key);
        if (existing) {
            mediaBufferTotalBytes -= existing.length || 0;
            mediaBufferCache.delete(key);
        }

        mediaBufferCache.set(key, buf);
        mediaBufferTotalBytes += buf.length || 0;

        // Evict least-recently-used until under limit
        while (mediaBufferTotalBytes > MEDIA_BUFFER_CACHE_SIZE) {
            const firstKey = mediaBufferCache.keys().next().value;
            if (!firstKey) break;
            const firstBuf = mediaBufferCache.get(firstKey);
            mediaBufferTotalBytes -= firstBuf?.length || 0;
            mediaBufferCache.delete(firstKey);
        }
    } catch {}
}

// Background pre-upload pools for media attachments (to make sending fast)
const attachmentIdPools = new Map();
const activeUploads = new Set();
const MAX_POOL_SIZE = 2;

async function uploadMediaToFb(mediaPath) {
    const api = global.api_instance;
    if (!api) return null;
    if (!fs.existsSync(mediaPath)) return null;

    try {
        const stream = fs.createReadStream(mediaPath);
        const res = await api.postFormData('https://upload.facebook.com/ajax/mercury/upload.php', {
            upload_1024: stream
        });
        const bodyText = res.body?.replace('for (;;);', '') || "{}";
        const json = JSON.parse(bodyText);
        const metadata = json.payload?.metadata?.[0];
        if (metadata) {
            return Object.entries(metadata)[0]; // e.g. ["video_id", 12345]
        }
    } catch (e) {
        console.error(`[autorep-pool] Failed to upload ${mediaPath}:`, e);
    }
    return null;
}

function refillPreuploadedPool(mediaPath) {
    const api = global.api_instance;
    if (!api) return;
    if (activeUploads.has(mediaPath)) return;

    const pool = attachmentIdPools.get(mediaPath) || [];
    if (pool.length >= MAX_POOL_SIZE) return;

    activeUploads.add(mediaPath);
    console.log(`[autorep-pool] Starting pre-upload for ${mediaPath}. Pool size: ${pool.length}`);

    uploadMediaToFb(mediaPath).then(entry => {
        activeUploads.delete(mediaPath);
        if (entry) {
            const p = attachmentIdPools.get(mediaPath) || [];
            p.push(entry);
            attachmentIdPools.set(mediaPath, p);
            console.log(`[autorep-pool] Pre-upload completed for ${mediaPath}. Pool size: ${p.length}`);

            if (p.length < MAX_POOL_SIZE) {
                refillPreuploadedPool(mediaPath);
            }
        }
    }).catch(err => {
        activeUploads.delete(mediaPath);
        console.error(`[autorep-pool] Pre-upload promise error for ${mediaPath}:`, err);
    });
}

function getPreuploadedAttachment(mediaPath) {
    const pool = attachmentIdPools.get(mediaPath) || [];
    if (pool.length > 0) {
        const entry = pool.shift();
        attachmentIdPools.set(mediaPath, pool);
        return entry;
    }
    return null;
}


function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function normalizeText(input) {
    return String(input || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function sanitizeFileName(input) {
    return (
        String(input || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9._-]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 80) || "autorep"
    );
}

function escapeRegExp(input) {
    return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readAutorepSettings() {
    try {
        if (!fs.existsSync(SETTINGS_PATH)) return {};
        const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
        if (raw && typeof raw === "object") {
            let modified = false;
            for (const threadID of Object.keys(raw)) {
                const threadRules = raw[threadID];
                if (threadRules && typeof threadRules === "object") {
                    for (const key of Object.keys(threadRules)) {
                        const rule = threadRules[key];
                        if (rule?.media?.path) {
                            const filename = path.basename(rule.media.path);
                            const expectedPath = path.join(MEDIA_DIR, filename);
                            if (rule.media.path !== expectedPath) {
                                rule.media.path = expectedPath;
                                modified = true;
                            }
                        }
                    }
                }
            }
            if (modified) {
                fs.writeFileSync(SETTINGS_PATH, JSON.stringify(raw, null, 2));
            }
            return raw;
        }
        return {};
    } catch {
        return {};
    }
}

function writeAutorepSettings(settings) {
    ensureDir(path.dirname(SETTINGS_PATH));
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function getThreadRules(threadID) {
    const settings = readAutorepSettings();
    const threadRules = settings[String(threadID)];
    return threadRules && typeof threadRules === "object" ? threadRules : {};
}

function listAutorepRules(threadID) {
    return Object.values(getThreadRules(threadID));
}

function buildMediaPath(threadID, keyword, extension = ".bin") {
    ensureDir(MEDIA_DIR);
    const safeThreadID = sanitizeFileName(threadID);
    const safeKeyword = sanitizeFileName(keyword);
    const safeExt = String(extension || ".bin").startsWith(".")
        ? String(extension || ".bin")
        : `.${extension}`;
    return path.join(MEDIA_DIR, `${safeThreadID}_${safeKeyword}${safeExt}`);
}

function removeMediaFile(mediaPath) {
    const filePath = String(mediaPath || "").trim();
    if (!filePath) return;

    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch {}
}

function upsertAutorepRule(threadID, keyword, responseText, media = null, updatedBy = "") {
    const settings = readAutorepSettings();
    const threadKey = String(threadID);
    const normalizedKeyword = normalizeText(keyword);

    if (!normalizedKeyword) {
        throw new Error("Từ khóa autorep không hợp lệ.");
    }

    if (!settings[threadKey] || typeof settings[threadKey] !== "object") {
        settings[threadKey] = {};
    }

    const existing = settings[threadKey][normalizedKeyword];
    const nextMedia = media
        ? {
              path: String(media.path || "").trim(),
              type: String(media.type || "").trim(),
              mimeType: String(media.mimeType || "").trim(),
              originalName: String(media.originalName || "").trim(),
          }
        : null;

    if (existing?.media?.path && (!nextMedia || existing.media.path !== nextMedia.path)) {
        removeMediaFile(existing.media.path);
        attachmentIdPools.delete(existing.media.path);
    }

    settings[threadKey][normalizedKeyword] = {
        keyword: String(keyword || "").trim(),
        normalizedKeyword,
        responseText: String(responseText || "").trim(),
        media: nextMedia,
        updatedAt: Date.now(),
        updatedBy: String(updatedBy || ""),
    };

    writeAutorepSettings(settings);

    // preload small media into memory cache to speed up sends
    try {
        const key = `${threadKey}|${normalizedKeyword}`;
        if (nextMedia && nextMedia.path && fs.existsSync(nextMedia.path)) {
            const stat = fs.statSync(nextMedia.path);
            if (stat.size > 0 && stat.size <= MEDIA_BUFFER_CACHE_SIZE) {
                const buf = fs.readFileSync(nextMedia.path);
                setMediaBuffer(key, buf);
            } else {
                setMediaBuffer(key, null);
            }
            refillPreuploadedPool(nextMedia.path);
        } else {
            setMediaBuffer(key, null);
        }
    } catch {}
    return settings[threadKey][normalizedKeyword];
}

function removeAutorepRule(threadID, keyword) {
    const settings = readAutorepSettings();
    const threadKey = String(threadID);
    const normalizedKeyword = normalizeText(keyword);

    if (!normalizedKeyword) return null;

    if (!settings[threadKey] || typeof settings[threadKey] !== "object") {
        return null;
    }

    const existing = settings[threadKey][normalizedKeyword];
    if (!existing) return null;

    if (existing.media?.path) {
        removeMediaFile(existing.media.path);
        attachmentIdPools.delete(existing.media.path);
    }

    delete settings[threadKey][normalizedKeyword];
    if (Object.keys(settings[threadKey]).length === 0) {
        delete settings[threadKey];
    }

    writeAutorepSettings(settings);
    try {
        const key = `${threadKey}|${normalizeText(keyword)}`;
        setMediaBuffer(key, null);
    } catch {}
    return existing;
}

function getMediaBuffer(threadID, normalizedKeyword) {
    try {
        const key = `${String(threadID)}|${String(normalizedKeyword)}`;
        const buf = mediaBufferCache.get(key) || null;
        if (buf) {
            // mark as recently used by reinserting
            mediaBufferCache.delete(key);
            mediaBufferCache.set(key, buf);
        }
        return buf;
    } catch {
        return null;
    }
}

function preloadMediaCache() {
    try {
        const settings = readAutorepSettings();
        for (const threadID of Object.keys(settings || {})) {
            const threadRules = settings[threadID] || {};
            for (const nk of Object.keys(threadRules || {})) {
                try {
                    const rule = threadRules[nk];
                    const media = rule?.media;
                    if (media && media.path && fs.existsSync(media.path)) {
                        const stat = fs.statSync(media.path);
                        if (stat.size > 0 && stat.size <= MEDIA_BUFFER_CACHE_SIZE) {
                            const buf = fs.readFileSync(media.path);
                            const key = `${String(threadID)}|${String(nk)}`;
                            setMediaBuffer(key, buf);
                        }
                        refillPreuploadedPool(media.path);
                    }
                } catch {}
            }
        }
    } catch {}
}

function findMatchingRule(threadID, body) {
    const normalizedBody = normalizeText(body);
    if (!normalizedBody) return null;

    const rules = listAutorepRules(threadID)
        .filter((rule) => rule && rule.normalizedKeyword)
        .sort((a, b) => b.normalizedKeyword.length - a.normalizedKeyword.length);

    return rules.find((rule) => {
        const keyword = rule.normalizedKeyword;
        if (!keyword) return false;
        
        try {
            const escapedKeyword = escapeRegExp(keyword);
            const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapedKeyword})([^\\p{L}\\p{N}_]|$)`, 'iu');
            return regex.test(normalizedBody);
        } catch (e) {
            const escapedKeyword = escapeRegExp(keyword);
            const regex = new RegExp(`(^|\\W)(${escapedKeyword})(\\W|$)`, 'i');
            return regex.test(normalizedBody);
        }
    }) || null;
}

module.exports = {
    SETTINGS_PATH,
    MEDIA_DIR,
    buildMediaPath,
    findMatchingRule,
    listAutorepRules,
    normalizeText,
    readAutorepSettings,
    removeAutorepRule,
    removeMediaFile,
    sanitizeFileName,
    upsertAutorepRule,
    writeAutorepSettings,
    getMediaBuffer,
    preloadMediaCache,
    getPreuploadedAttachment,
    refillPreuploadedPool,
};