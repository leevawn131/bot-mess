const fs = require("fs");
const path = require("path");

const DATA_PATH = path.resolve(__dirname, "../../cache/no_unsend_messages.json");

function readNoUnsendData() {
    try {
        if (fs.existsSync(DATA_PATH)) {
            const data = fs.readFileSync(DATA_PATH, "utf8");
            return JSON.parse(data);
        }
    } catch (e) {}
    return {};
}

function writeNoUnsendData(data) {
    try {
        const dir = path.dirname(DATA_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {}
}

function markMessageNoUnsend(messageID) {
    if (!messageID) return;
    const data = readNoUnsendData();
    data[String(messageID)] = {
        noUnsend: true,
        createdAt: new Date().toISOString()
    };
    writeNoUnsendData(data);
}

function isNoUnsend(messageID) {
    if (!messageID) return false;
    const data = readNoUnsendData();
    return !!data[String(messageID)]?.noUnsend;
}

module.exports = {
    markMessageNoUnsend,
    isNoUnsend
};
