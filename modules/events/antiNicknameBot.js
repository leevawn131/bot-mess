const fs = require("fs-extra");
const path = require("path");

module.exports = {
    name: "antiNicknameBot",
    eventType: ["log:user-nickname"],

    run: async function(Obj) { return this.execute(Obj); },
    execute: async ({ api, event }) => {
        const { threadID, author, logMessageData } = event;
        const botID = String(api.getCurrentUserID());
        const targetID = String(logMessageData.participant_id);
        const authorID = String(author);

        // Chỉ xử lý khi biệt danh của chính bot bị thay đổi
        if (targetID !== botID) return;

        const allowedTime = global.allowBotNicknameChange?.[threadID];
        const isFromCommand = allowedTime && (Date.now() - allowedTime < 10000);

        if (isFromCommand || authorID === botID) {
            // Sự kiện thay đổi hợp lệ (từ lệnh setnamebot hoặc chính bot đổi)
            if (global.allowBotNicknameChange) {
                global.allowBotNicknameChange[threadID] = 0; // reset flag
            }
            try {
                const nickFile = path.join(__dirname, "../data/botNicknames.json");
                let nickData = {};
                if (fs.existsSync(nickFile)) {
                    nickData = await fs.readJson(nickFile);
                }
                nickData[threadID] = logMessageData.nickname || "";
                await fs.writeJson(nickFile, nickData, { spaces: 4 });
            } catch (e) {
                console.error("Lỗi lưu biệt danh bot:", e);
            }
        } else {
            // Đổi trái phép -> Khôi phục và cảnh báo
            let restoreNickname = null;
            try {
                const nickFile = path.join(__dirname, "../data/botNicknames.json");
                if (fs.existsSync(nickFile)) {
                    const nickData = await fs.readJson(nickFile);
                    restoreNickname = nickData[threadID];
                }
            } catch (e) {}

            if (!restoreNickname) {
                let prefix = "!";
                try {
                    const config = require("../../config.json");
                    if (config && config.prefix) prefix = config.prefix;
                } catch (e) {}
                restoreNickname = `『 ${prefix} 』• Bot láo loz`;
            }

            api.sendMessage("⚠️ Bạn không được tự ý đổi biệt danh của Bot! Vui lòng sử dụng lệnh setnamebot để thay đổi.", threadID);
            
            // Đổi lại biệt danh cũ
            api.changeNickname(restoreNickname, threadID, botID, (err) => {
                if (err) console.error("Lỗi khi khôi phục biệt danh bot:", err);
            });
        }
    }
};
