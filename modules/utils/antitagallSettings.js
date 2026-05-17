const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "../../cache/antitagall_settings.json");

function readAntitagallSettings() {
    try {
        if (!fs.existsSync(SETTINGS_PATH)) return {};
        const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
        return raw && typeof raw === "object" ? raw : {};
    } catch {
        return {};
    }
}

function writeAntitagallSettings(settings) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function normalizeSetting(raw) {
    if (raw === true) {
        return {
            enabled: true,
            updatedAt: Date.now(),
            updatedBy: ""
        };
    }

    if (!raw || typeof raw !== "object") {
        return {
            enabled: false,
            updatedAt: 0,
            updatedBy: ""
        };
    }

    return {
        enabled: raw.enabled === true,
        updatedAt: Number(raw.updatedAt) || 0,
        updatedBy: String(raw.updatedBy || "")
    };
}

function getAntitagallSetting(threadID) {
    const settings = readAntitagallSettings();
    return normalizeSetting(settings[String(threadID)]);
}

function isAntitagallEnabled(threadID) {
    return getAntitagallSetting(threadID).enabled;
}

function setAntitagallEnabled(threadID, enabled, updatedBy = "") {
    const settings = readAntitagallSettings();
    const threadKey = String(threadID);

    settings[threadKey] = {
        enabled: Boolean(enabled),
        updatedAt: Date.now(),
        updatedBy: String(updatedBy || "")
    };

    writeAntitagallSettings(settings);
    return settings[threadKey];
}

module.exports = {
    SETTINGS_PATH,
    getAntitagallSetting,
    isAntitagallEnabled,
    readAntitagallSettings,
    setAntitagallEnabled,
    writeAntitagallSettings
};
