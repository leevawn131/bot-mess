const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "../../cache/join_greetings.json");
const MEDIA_DIR = path.join(__dirname, "../../cache/join_greetings_media");

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function removeMediaFile(filePath) {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        console.error("❌ Lỗi xóa media file join_greetings:", e);
    }
}

function readSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
        }
    } catch (error) {
        console.error("❌ Lỗi đọc join_greetings.json:", error);
    }
    return {};
}

function writeSettings(settings) {
    try {
        const dir = path.dirname(SETTINGS_PATH);
        ensureDir(dir);
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error("❌ Lỗi ghi join_greetings.json:", error);
    }
}

function getJoinGreeting(threadID) {
    const settings = readSettings();
    const val = settings[String(threadID)];
    if (!val) return null;
    if (typeof val === "string") {
        if (val === "off") return { text: "off", media: null };
        return { text: val, media: null };
    }
    if (typeof val === "object") {
        return {
            text: val.text || "",
            media: val.media || null,
        };
    }
    return null;
}

function setJoinGreeting(threadID, greeting, media = null) {
    const settings = readSettings();
    const key = String(threadID);
    const existing = settings[key];

    let oldMediaPath = null;
    if (typeof existing === "object" && existing?.media?.path) {
        oldMediaPath = existing.media.path;
    }

    if (!greeting && !media) {
        delete settings[key];
        if (oldMediaPath) removeMediaFile(oldMediaPath);
    } else if (greeting === "off") {
        settings[key] = "off";
        if (oldMediaPath) removeMediaFile(oldMediaPath);
    } else {
        const newMediaPath = media?.path || null;
        if (oldMediaPath && oldMediaPath !== newMediaPath) {
            removeMediaFile(oldMediaPath);
        }

        const text = typeof greeting === "string" ? greeting : (greeting?.text || "");

        if (media) {
            settings[key] = {
                text: text,
                media: {
                    path: String(media.path || "").trim(),
                    type: String(media.type || "").trim(),
                    mimeType: String(media.mimeType || "").trim(),
                }
            };
        } else {
            settings[key] = text;
        }
    }
    writeSettings(settings);
    return settings[key] || null;
}

module.exports = {
    SETTINGS_PATH,
    MEDIA_DIR,
    readSettings,
    writeSettings,
    getJoinGreeting,
    setJoinGreeting,
};