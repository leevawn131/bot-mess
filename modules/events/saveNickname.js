const fs = require("fs-extra");
const path = require("path");
const { saveNickname, getNickname } = require("../utils/nicknameStorage");
const { getThreadInfoCached } = require("../utils/threadInfo");
const { toAdminIdList } = require("../utils/checkPermission");

module.exports = {
    name: "saveNickname",
    eventType: ["log:user-nickname"],

    run: async function(Obj) { return this.execute(Obj); },
    execute: async ({ api, event, config }) => {
        try {
            const { threadID, author, logMessageData } = event;
            if (!threadID || !logMessageData) return;

            const botID = String(api.getCurrentUserID());
            const userID = String(logMessageData.participant_id);
            const authorID = String(author);

            // Bỏ qua nếu là nickname của bot (antiNicknameBot.js sẽ xử lý riêng)
            if (userID === botID) return;

            // Bỏ qua các biệt danh tạm thời dùng để bypass cache của Facebook
            const nicknameToCheck = logMessageData.nickname || "";
            if (nicknameToCheck.startsWith("🌸 Đang khôi phục")) return;

            // Đọc biệt danh cũ trước khi thực hiện bất kỳ thao tác nào khác (tránh race condition với getThreadInfoCached)
            const oldNickname = await getNickname(threadID, userID) || "";

            const fileAnti = path.join('./modules/data/anti', 'antiFile.json');
            let DataAnti = {};
            if (fs.existsSync(fileAnti)) {
                try {
                    DataAnti = fs.readJsonSync(fileAnti);
                } catch (e) {
                    DataAnti = {};
                }
            }

            const antiBietDanhEnabled = DataAnti[threadID]?.bietdanh;

            if (antiBietDanhEnabled) {
                // Kiểm tra người thay đổi có quyền hay không (Bot, Bot Admin, QTV nhóm)
                const isAllowed = async (uid) => {
                    if (String(uid) === String(botID)) return true;

                    const adminBotList = [
                        ...(Array.isArray(global.config?.ADMINBOT) ? global.config.ADMINBOT : []),
                        ...(Array.isArray(global.config?.adminIDs) ? global.config.adminIDs : []),
                        ...(Array.isArray(config?.adminIDs) ? config.adminIDs : [])
                    ].map(String);
                    if (adminBotList.includes(String(uid))) return true;

                    try {
                        const info = await getThreadInfoCached(api, threadID);
                        if (info && Array.isArray(info.adminIDs)) {
                            const adminIDs = toAdminIdList(info);
                            return adminIDs.includes(String(uid));
                        }
                    } catch (e) { return false; }
                    return false;
                };

                const allowed = await isAllowed(authorID);
                if (allowed) {
                    // Người thay đổi được phép -> Cập nhật biệt danh mới vào database
                    const nickname = logMessageData.nickname || "";
                    await saveNickname(threadID, userID, nickname);
                } else {
                    // Không được phép -> Khôi phục về biệt danh hiện tại
                    // Thực hiện đổi lại biệt danh cũ
                    api.changeNickname(oldNickname, threadID, userID, (err) => {
                        if (err) {
                            console.error(`[ANTI BIETDANH] Lỗi khi khôi phục biệt danh cho ${userID}:`, err);
                        }
                    });

                    // Cảnh báo người dùng tự ý đổi biệt danh
                    if (!DataAnti[threadID].warn || DataAnti[threadID].warn.bietdanh !== false) {
                        const { addWarning } = require('../utils/warningStorage');
                        try {
                            await addWarning(api, threadID, authorID, "Tự ý đổi biệt danh thành viên khi đang bật anti-bietdanh");
                        } catch (e) {
                            console.error('[ANTI BIETDANH] Lỗi ghi warning:', e);
                        }
                    }
                }
            } else {
                // Không bật anti bietdanh -> Cập nhật bình thường
                const nickname = logMessageData.nickname || "";
                await saveNickname(threadID, userID, nickname);
            }
        } catch (err) {
            console.error("❌ Lỗi khi tự động cập nhật biệt danh mới vào database:", err);
        }
    }
};
