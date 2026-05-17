const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "../../cache/group_rules.json");

function readSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
            return raw && typeof raw === "object" ? raw : {};
        }
    } catch (error) {
        console.error("❌ Lỗi đọc group_rules.json:", error);
    }
    return {};
}

function writeSettings(settings) {
    try {
        const dir = path.dirname(SETTINGS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error("❌ Lỗi ghi group_rules.json:", error);
    }
}

function getGroupRule(threadID) {
    const settings = readSettings();
    return String(settings[String(threadID)] || "").trim();
}

function setGroupRule(threadID, ruleText) {
    const settings = readSettings();
    const key = String(threadID);

    if (!ruleText) {
        delete settings[key];
    } else {
        settings[key] = String(ruleText);
    }

    writeSettings(settings);
    return settings[key] || "";
}

module.exports = {
    SETTINGS_PATH,
    readSettings,
    writeSettings,
    getGroupRule,
    setGroupRule,
};