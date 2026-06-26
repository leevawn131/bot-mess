const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "../../cache/antitheme_settings.json");

function readAntithemeSettings() {
    try {
        if (!fs.existsSync(SETTINGS_PATH)) return {};
        const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
        return raw && typeof raw === "object" ? raw : {};
    } catch {
        return {};
    }
}

function writeAntithemeSettings(settings) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function normalizeSetting(raw) {
    if (raw === true) {
        return {
            enabled: true,
            updatedAt: Date.now(),
            updatedBy: "",
            lockedThemeID: "",
            lockedThemeName: "",
            lockedEmoji: ""
        };
    }

    if (!raw || typeof raw !== "object") {
        return {
            enabled: false,
            updatedAt: 0,
            updatedBy: "",
            lockedThemeID: "",
            lockedThemeName: "",
            lockedEmoji: ""
        };
    }

    return {
        enabled: raw.enabled === true,
        updatedAt: Number(raw.updatedAt) || 0,
        updatedBy: String(raw.updatedBy || ""),
        lockedThemeID: String(raw.lockedThemeID || ""),
        lockedThemeName: String(raw.lockedThemeName || ""),
        lockedEmoji: String(raw.lockedEmoji || "")
    };
}

function getAntithemeSetting(threadID) {
    const settings = readAntithemeSettings();
    return normalizeSetting(settings[String(threadID)]);
}

function isAntithemeEnabled(threadID) {
    return getAntithemeSetting(threadID).enabled;
}

function setAntithemeEnabled(threadID, enabled, updatedBy = "", lockInfo = {}) {
    const settings = readAntithemeSettings();
    const threadKey = String(threadID);

    const current = normalizeSetting(settings[threadKey]);

    settings[threadKey] = {
        enabled: Boolean(enabled),
        updatedAt: Date.now(),
        updatedBy: String(updatedBy || ""),
        lockedThemeID: String(lockInfo.lockedThemeID ?? current.lockedThemeID ?? ""),
        lockedThemeName: String(lockInfo.lockedThemeName ?? current.lockedThemeName ?? ""),
        lockedEmoji: String(lockInfo.lockedEmoji ?? current.lockedEmoji ?? "")
    };

    writeAntithemeSettings(settings);
    return settings[threadKey];
}

module.exports = {
    SETTINGS_PATH,
    getAntithemeSetting,
    isAntithemeEnabled,
    readAntithemeSettings,
    setAntithemeEnabled,
    writeAntithemeSettings
};
