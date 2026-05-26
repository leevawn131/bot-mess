const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "../../cache/autorep_settings.json");
const MEDIA_DIR = path.join(__dirname, "../../cache/autorep_media");

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function normalizeText(input) {
    return String(input || "")
        .toLowerCase()
        .replace(/đ/g, "d")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s@._-]+/g, " ")
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
        return raw && typeof raw === "object" ? raw : {};
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
    }

    delete settings[threadKey][normalizedKeyword];
    if (Object.keys(settings[threadKey]).length === 0) {
        delete settings[threadKey];
    }

    writeAutorepSettings(settings);
    return existing;
}

function findMatchingRule(threadID, body) {
    const normalizedBody = normalizeText(body);
    if (!normalizedBody) return null;

    const rules = listAutorepRules(threadID)
        .filter((rule) => rule && rule.normalizedKeyword)
        .sort((a, b) => b.normalizedKeyword.length - a.normalizedKeyword.length);

    return (
        rules.find((rule) => {
            if (rule.normalizedKeyword.includes(" ")) {
                return normalizedBody.includes(rule.normalizedKeyword);
            }

            const pattern = new RegExp(`(^|\\s)${escapeRegExp(rule.normalizedKeyword)}(\\s|$)`);
            return pattern.test(normalizedBody);
        }) || null
    );
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
};