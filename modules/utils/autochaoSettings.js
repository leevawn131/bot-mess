const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "../../cache/autochao_settings.json");

function readAutochaoSettings() {
    try {
        if (!fs.existsSync(SETTINGS_PATH)) return {};
        const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
        return raw && typeof raw === "object" ? raw : {};
    } catch {
        return {};
    }
}

function writeAutochaoSettings(settings) {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
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

    if (raw === false) {
        return {
            enabled: false,
            updatedAt: Date.now(),
            updatedBy: ""
        };
    }

    if (!raw || typeof raw !== "object") {
        return {
            enabled: true,
            updatedAt: 0,
            updatedBy: ""
        };
    }

    return {
        enabled: raw.enabled !== false,
        updatedAt: Number(raw.updatedAt) || 0,
        updatedBy: String(raw.updatedBy || "")
    };
}

function getAutochaoSetting(threadID) {
    const settings = readAutochaoSettings();
    const threadKey = String(threadID);

    if (!Object.prototype.hasOwnProperty.call(settings, threadKey)) {
        return {
            enabled: true,
            updatedAt: 0,
            updatedBy: ""
        };
    }

    return normalizeSetting(settings[threadKey]);
}

function isAutochaoEnabled(threadID) {
    return getAutochaoSetting(threadID).enabled;
}

function setAutochaoEnabled(threadID, enabled, updatedBy = "") {
    const settings = readAutochaoSettings();
    const threadKey = String(threadID);

    settings[threadKey] = {
        enabled: Boolean(enabled),
        updatedAt: Date.now(),
        updatedBy: String(updatedBy || "")
    };

    writeAutochaoSettings(settings);
    return settings[threadKey];
}

module.exports = {
    SETTINGS_PATH,
    getAutochaoSetting,
    isAutochaoEnabled,
    readAutochaoSettings,
    setAutochaoEnabled,
    writeAutochaoSettings
};