const fs = require("fs");
const path = require("path");
const { checkRentalStatus } = require("./rental");

const SETTINGS_PATH = path.join(__dirname, "../../cache/tiktok.json");

function readSettings() {
    try {
        if (!fs.existsSync(SETTINGS_PATH)) return {};
        const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
        return raw && typeof raw === "object" ? raw : {};
    } catch {
        return {};
    }
}

function writeSettings(settings) {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

async function isAutodownTiktokEnabled(threadID) {
    const settings = readSettings();
    const threadKey = String(threadID);
    
    // Nếu nhóm đã được cấu hình bật/tắt thủ công
    if (settings[threadKey] !== undefined && settings[threadKey] !== null) {
        return settings[threadKey].enabled === true;
    }
    
    // Nếu chưa cấu hình, mặc định tắt khi không thuê bot, mặc định bật khi thuê bot
    const isRented = await checkRentalStatus(threadID);
    return isRented;
}

function setAutodownTiktokEnabled(threadID, enabled) {
    const settings = readSettings();
    const threadKey = String(threadID);
    
    settings[threadKey] = {
        enabled: Boolean(enabled),
        updatedAt: Date.now()
    };
    
    writeSettings(settings);
    return settings[threadKey];
}

module.exports = {
    isAutodownTiktokEnabled,
    setAutodownTiktokEnabled
};
