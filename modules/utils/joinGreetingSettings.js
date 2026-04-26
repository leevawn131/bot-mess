const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "../../cache/join_greetings.json");

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
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error("❌ Lỗi ghi join_greetings.json:", error);
    }
}

function getJoinGreeting(threadID) {
    const settings = readSettings();
    return settings[String(threadID)] || "";
}

function setJoinGreeting(threadID, greeting) {
    const settings = readSettings();
    const key = String(threadID);
    if (!greeting) {
        delete settings[key];
    } else {
        settings[key] = String(greeting);
    }
    writeSettings(settings);
    return settings[key] || "";
}

module.exports = {
    SETTINGS_PATH,
    readSettings,
    writeSettings,
    getJoinGreeting,
    setJoinGreeting,
};