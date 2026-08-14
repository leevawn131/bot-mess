const fs = require("fs");
const path = require("path");
const { getNickname, hasInteraction } = require("./nicknameStorage");

const RESTORE_STATE_PATH = path.resolve(__dirname, "../../cache/nickname_restore_state.json");
const activeRestores = new Set();

function readRestoreState() {
    try {
        if (fs.existsSync(RESTORE_STATE_PATH)) {
            return JSON.parse(fs.readFileSync(RESTORE_STATE_PATH, "utf8"));
        }
    } catch (e) {}
    return {};
}

function writeRestoreState(state) {
    try {
        const dir = path.dirname(RESTORE_STATE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(RESTORE_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
    } catch (e) {}
}

/**
 * Kiểm tra và thực hiện bù khôi phục biệt danh cho thành viên cũ nếu chưa thành công.
 * @param {object} api - FCA API
 * @param {string} threadID - ID nhóm
 * @param {string} userID - ID người dùng
 * @param {string} [userName] - Tên hiển thị người dùng (optional)
 */
async function checkAndRestoreOldMemberNickname(api, threadID, userID, userName = null) {
    if (!threadID || !userID || !api) return false;
    const botID = String(api.getCurrentUserID());
    if (String(userID) === botID) return false;

    const restoreKey = `${threadID}_${userID}`;
    if (activeRestores.has(restoreKey)) return false;

    // Lấy biệt danh đã lưu
    const savedNickname = await getNickname(threadID, userID);
    if (!savedNickname || savedNickname.trim() === "") return false;

    activeRestores.add(restoreKey);

    const attemptRestore = (retriesLeft) => {
        console.log(`[JOIN RESTORE] Đang khôi phục biệt danh cho ${userID} tại thread ${threadID}: ${savedNickname}. Lượt thử còn lại: ${retriesLeft}`);

        api.changeNickname(savedNickname, threadID, userID, (err) => {
            if (err) {
                console.error(`[JOIN RESTORE] Lỗi đặt biệt danh cho ${userID}:`, err?.message || err);
                if (retriesLeft > 0) {
                    setTimeout(() => attemptRestore(retriesLeft - 1), 8000);
                } else {
                    activeRestores.delete(restoreKey);
                }
            } else {
                console.log(`[JOIN RESTORE] Khôi phục thành công biệt danh của ${userID}: ${savedNickname}`);
                const restoreState = readRestoreState();
                restoreState[restoreKey] = {
                    status: "success",
                    nickname: savedNickname,
                    restoredAt: new Date().toISOString()
                };
                writeRestoreState(restoreState);
                activeRestores.delete(restoreKey);

                const nameToShow = userName || `User ${userID.slice(-6)}`;
                api.sendMessage(`[ THÀNH VIÊN CŨ ]\n🔎 Phát hiện thành viên cũ quay lại: ${nameToShow}\n🌸 Đã tự động khôi phục biệt danh cũ cho bạn: ${savedNickname}`, threadID);
            }
        });
    };

    // Đợi 2 giây để Facebook hoàn tất thêm user vào nhóm trước khi đổi biệt danh
    setTimeout(() => {
        attemptRestore(3);
    }, 2000);

    return true;
}

module.exports = {
    readRestoreState,
    writeRestoreState,
    checkAndRestoreOldMemberNickname
};
