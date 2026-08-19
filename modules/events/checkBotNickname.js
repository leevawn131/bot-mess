const fs = require("fs-extra");
const path = require("path");
const { getThreadInfoCached } = require("../utils/threadInfo");
const { getCustomPrefix } = require("../utils/customPrefix");

module.exports = {
    name: "checkBotNickname",
    eventType: ["message", "message_reply", "log:subscribe"],

    run: async function(Obj) { return this.execute(Obj); },
    execute: async ({ api, event, config }) => {
        try {
            const { threadID, senderID } = event;
            if (!threadID || !senderID || threadID === senderID) return;

            const botID = String(api.getCurrentUserID());

            // Tránh kiểm tra quá thường xuyên để bảo vệ hiệu năng
            global.lastCheckBotNickname = global.lastCheckBotNickname || {};
            const lastCheck = global.lastCheckBotNickname[threadID];
            // Chỉ kiểm tra lại sau mỗi 4 tiếng (4 * 60 * 60 * 1000 ms)
            if (lastCheck && Date.now() - lastCheck < 4 * 60 * 60 * 1000) return;

            // Đánh dấu thời gian kiểm tra ngay để tránh các tin nhắn đồng thời kích hoạt cùng lúc (race condition)
            global.lastCheckBotNickname[threadID] = Date.now();

            const threadInfo = await getThreadInfoCached(api, threadID);
            if (!threadInfo || !threadInfo.nicknames || typeof threadInfo.nicknames !== "object") return;

            const botNickname = threadInfo.nicknames[botID] || "";

            // Xác định biệt danh đúng (expectedNickname) của bot tại nhóm này
            const nickFile = path.join(__dirname, "../data/botNicknames.json");
            let baseName = "";

            if (fs.existsSync(nickFile)) {
                try {
                    const nickData = fs.readJsonSync(nickFile);
                    const savedNickname = nickData[threadID] || "";
                    if (savedNickname) {
                        // Tách bỏ phần ngày cũ nếu có (bất kỳ chuỗi nào dạng " | [còn lại/còn] [số] ngày" ở cuối)
                        baseName = savedNickname.replace(/\s*\|\s*(?:còn\s*(?:lại\s*)?)?\d+\s*ngày\s*$/i, "").trim();
                    }
                } catch (e) {
                    console.error("[checkBotNickname] Lỗi đọc file botNicknames.json:", e);
                }
            }

            // Nếu trong data chưa lưu biệt danh của bot cho nhóm này, tạo biệt danh mặc định
            if (!baseName) {
                let prefix = "";
                try {
                    const customPrefix = await getCustomPrefix(threadID);
                    if (customPrefix) {
                        prefix = customPrefix;
                    }
                } catch (e) {}

                if (!prefix) {
                    prefix = process.env.BOT_PREFIX || config?.prefix || global.config?.prefix || "!";
                }

                const botName = process.env.BOT_NAME || config?.botName || global.config?.botName || "Bot láo loz";
                baseName = `『 ${prefix} 』• ${botName}`;
            }

            // Tính số ngày thuê còn lại
            let daysLeft = 0;
            try {
                const { getRentalExpiry } = require("../utils/rental");
                const expireDate = await getRentalExpiry(threadID);
                if (expireDate && !isNaN(expireDate.getTime())) {
                    const diffTime = expireDate.getTime() - Date.now();
                    daysLeft = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
                }
            } catch (e) {
                console.error("[checkBotNickname] Lỗi tính ngày hết hạn thuê:", e);
            }

            // Tạo biệt danh mong muốn đầy đủ
            const suffix = ` | còn ${daysLeft} ngày`;
            let expectedNickname = `${baseName}${suffix}`;

            if (expectedNickname.length > 32) {
                const maxBaseLen = 32 - suffix.length;
                if (maxBaseLen > 0) {
                    expectedNickname = `${baseName.slice(0, maxBaseLen).trim()}${suffix}`;
                } else {
                    expectedNickname = expectedNickname.slice(0, 32);
                }
            }

            // So sánh biệt danh hiện tại với biệt danh dự kiến
            if (botNickname !== expectedNickname) {
                // Đánh dấu cho phép đổi biệt danh bot trong thread này để tránh bị antiNicknameBot.js chặn
                global.allowBotNicknameChange = global.allowBotNicknameChange || {};
                global.allowBotNicknameChange[threadID] = Date.now();

                api.changeNickname(expectedNickname, threadID, botID, (err) => {
                    if (err) {
                        console.error(`[checkBotNickname] Lỗi tự động set biệt danh cho bot tại thread ${threadID}:`, err);
                        // Reset cờ cho phép đổi nếu bị lỗi
                        if (global.allowBotNicknameChange) {
                            global.allowBotNicknameChange[threadID] = 0;
                        }
                    } else {
                        // Đổi thành công, lưu lại vào file botNicknames.json nếu chưa khớp
                        try {
                            let nickData = {};
                            if (fs.existsSync(nickFile)) {
                                nickData = fs.readJsonSync(nickFile);
                            }
                            if (nickData[threadID] !== expectedNickname) {
                                nickData[threadID] = expectedNickname;
                                fs.writeJsonSync(nickFile, nickData, { spaces: 4 });
                            }
                        } catch (e) {
                            console.error("[checkBotNickname] Lỗi ghi botNicknames.json:", e);
                        }

                        // Cập nhật lại cache của threadInfo
                        threadInfo.nicknames[botID] = expectedNickname;
                        console.log(`[checkBotNickname] Đã tự động cập nhật biệt danh bot tại thread ${threadID}: "${expectedNickname}"`);
                    }
                });
            }
        } catch (error) {
            console.error("[checkBotNickname] Lỗi xử lý kiểm tra biệt danh bot:", error);
        }
    }
};
