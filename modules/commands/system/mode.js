const fs = require('fs');
const path = require('path');
const { getAdminBotUIDs, readSettings } = require('../../utils/checkPermission');
const { readJsonFile, writeJsonFile } = require('../../utils/secureFileOps');
const { info, warn } = require('../../utils/logger');
const { getThreadInfoCached } = require('../../utils/threadInfo');
const prefix = process.env.BOT_PREFIX;

// Đường dẫn file lưu mode settings
const SETTINGS_PATH = path.join(__dirname, '../../../mode_settings.json');
const SCHEDULE_PATH = path.join(__dirname, '../../../mode_schedule.json');
const VALID_MODES = ["user", "qtv", "adminbot"];
const MAX_SCHEDULES_PER_THREAD = 2;

const modeEmoji = { user: "👥", qtv: "🔐", adminbot: "🔒" };
const modeDesc = {
    user: "Ai cũng dùng được",
    qtv: "chỉ QTV nhóm dùng được",
    adminbot: "Chỉ chủ bot dùng được"
};

function normalizeMode(rawMode) {
    const mode = String(rawMode || "").toLowerCase();
    if (mode === "admingr") return "qtv";
    return mode;
}

function toAdminIdList(threadInfo) {
    const list = Array.isArray(threadInfo?.adminIDs) ? threadInfo.adminIDs : [];
    return list
        .map(item => String(item?.id || item?.userID || item?.adminID || "").trim())
        .filter(Boolean);
}

// Hàm đọc settings
async function readModeSettings() {
  try {
    return await readJsonFile(SETTINGS_PATH, {});
  } catch (e) {
    warn("Error reading mode_settings.json", { error: e.message });
    return {};
  }
}

// Hàm đọc timer mode
async function readSchedules() {
  try {
    return await readJsonFile(SCHEDULE_PATH, {});
  } catch (e) {
    warn("Error reading mode_schedule.json", { error: e.message });
    return {};
  }
}

// Hàm lưu settings
async function writeSettings(settings) {
  try {
    await writeJsonFile(SETTINGS_PATH, settings);
    info("Mode settings saved", { threadCount: Object.keys(settings).length });
  } catch (e) {
    warn("Error writing mode_settings.json", { error: e.message });
  }
}

// Hàm lưu timer mode
async function writeSchedules(schedules) {
  try {
    await writeJsonFile(SCHEDULE_PATH, schedules);
    info("Mode schedules saved", { threadCount: Object.keys(schedules).length });
  } catch (e) {
    warn("Error writing mode_schedule.json", { error: e.message });
  }
}

function isValidTimeHHMM(timeText) {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeText);
}

function durationHHMMToMs(durationText) {
    if (!isValidTimeHHMM(durationText)) return null;
    const [hhText, mmText] = durationText.split(":");
    const hh = Number(hhText);
    const mm = Number(mmText);
    const totalMs = ((hh * 60) + mm) * 60 * 1000;
    return totalMs > 0 ? totalMs : null;
}

function formatDateTimeVN(timestamp) {
    try {
        const d = new Date(timestamp);
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        const hh = String(d.getHours()).padStart(2, "0");
        const mi = String(d.getMinutes()).padStart(2, "0");
        return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
    } catch {
        return "không xác định";
    }
}

function formatCountdown(msLeft) {
    const safe = Math.max(0, Number(msLeft) || 0);
    const totalMinutes = Math.ceil(safe / 60000);
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeThreadSchedules(threadScheduleValue) {
    let list = [];

    if (Array.isArray(threadScheduleValue)) {
        list = threadScheduleValue;
    } else if (threadScheduleValue && typeof threadScheduleValue === 'object') {
        if (Array.isArray(threadScheduleValue.daily)) {
            list = threadScheduleValue.daily;
        } else if (Array.isArray(threadScheduleValue.schedules)) {
            list = threadScheduleValue.schedules;
        } else if (threadScheduleValue.time && threadScheduleValue.mode) {
            list = [threadScheduleValue];
        }
    }

    return list
        .filter(item => item && typeof item === 'object')
        .map(item => ({
            time: String(item.time || "").trim(),
            mode: String(item.mode || "").toLowerCase(),
            enabled: item.enabled !== false,
            updatedAt: Number(item.updatedAt) || Date.now(),
            updatedBy: String(item.updatedBy || "")
        }))
        .filter(item => isValidTimeHHMM(item.time) && VALID_MODES.includes(item.mode))
        .sort((a, b) => a.time.localeCompare(b.time));
}

function normalizeThreadInTask(threadScheduleValue) {
    let source = null;

    if (threadScheduleValue && typeof threadScheduleValue === 'object') {
        if (threadScheduleValue.in && typeof threadScheduleValue.in === 'object') {
            source = threadScheduleValue.in;
        } else if (threadScheduleValue.executeAt && threadScheduleValue.mode) {
            source = threadScheduleValue;
        }
    }

    if (!source) return null;

    const restoreAt = Number(source.restoreAt);
    const temporaryMode = String(source.temporaryMode || '').toLowerCase();
    const restoreMode = String(source.restoreMode || '').toLowerCase();

    if (Number.isFinite(restoreAt) && restoreAt > 0 && VALID_MODES.includes(temporaryMode) && VALID_MODES.includes(restoreMode)) {
        return {
            type: "temporary",
            restoreAt,
            temporaryMode,
            restoreMode,
            updatedAt: Number(source.updatedAt) || Date.now(),
            updatedBy: String(source.updatedBy || ''),
            duration: String(source.duration || '')
        };
    }

    // Tương thích dữ liệu cũ: mode/executeAt (đổi mode sau khoảng thời gian)
    const executeAt = Number(source.executeAt);
    const mode = String(source.mode || '').toLowerCase();
    if (!Number.isFinite(executeAt) || executeAt <= 0) return null;
    if (!VALID_MODES.includes(mode)) return null;

    return {
        type: "legacy-delay",
        executeAt,
        mode,
        updatedAt: Number(source.updatedAt) || Date.now(),
        updatedBy: String(source.updatedBy || ''),
        duration: String(source.duration || '')
    };
}

function buildThreadScheduleValue(dailyList, inTask) {
    const daily = Array.isArray(dailyList) ? dailyList : [];
    const countdown = inTask || null;

    if (daily.length === 0 && !countdown) return null;
    if (daily.length > 0 && !countdown) return daily;

    return {
        daily,
        in: countdown
    };
}

function getThreadSchedules(schedules, threadID) {
    return normalizeThreadSchedules(schedules[threadID]);
}

function getThreadInTask(schedules, threadID) {
    return normalizeThreadInTask(schedules[threadID]);
}

function saveThreadSchedules(schedules, threadID, list, inTask) {
    const dailyList = (Array.isArray(list) ? list : [])
        .slice(0, MAX_SCHEDULES_PER_THREAD)
        .sort((a, b) => a.time.localeCompare(b.time));

    const normalizedInTask = inTask || null;
    const merged = buildThreadScheduleValue(dailyList, normalizedInTask);

    if (!merged) {
        delete schedules[threadID];
        return;
    }

    schedules[threadID] = merged;
}

module.exports = {
    name: "mode",
    description: "Quản lý mode quyền của nhóm và hẹn giờ đổi mode",
    usage: `\n${prefix}mode - Xem mode hiện tại\n${prefix}mode <user|qtv|adminbot> - Đổi mode ngay\n${prefix}mode <user|qtv|adminbot> <HH:MM> - Lịch hằng ngày\n${prefix}mode in <HH:MM> <user|qtv|adminbot> - Đổi mode ngay, hết thời gian sẽ quay về mode cũ\n${prefix}mode off - Tắt toàn bộ lịch\n${prefix}mode off <mode|HH:MM|in> - Xóa 1 lịch`,

    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID } = event;
        const senderID = String(event.senderID);
        const threadIDStr = String(threadID);
        const prefix = config?.prefix || "!";

        const settings = await readModeSettings();
        const schedules = await readSchedules();
        const currentMode = normalizeMode(settings[threadIDStr] || "adminbot");

        const newMode = normalizeMode(args[0]?.toLowerCase());
        const secondArg = args[1]?.toLowerCase();

        // === KIỂM TRA QUYỀN ===
        const adminBotUIDs = getAdminBotUIDs();
        let isBotAdmin = adminBotUIDs.includes(senderID);
        
        let isAdmin = false;
        try {
            const threadInfo = await getThreadInfoCached(api, threadIDStr);
            const adminIDs = toAdminIdList(threadInfo);
            isAdmin = adminIDs.includes(senderID);
        } catch (e) {
            warn("Error getting thread info", { error: e.message, threadID });
        }

        // Kiểm tra xem nhóm có đang thuê gói admin không
        const { checkIsAdminRental } = require('../../utils/rental');
        const isAdminRental = await checkIsAdminRental(threadIDStr);

        // Nếu nhóm thuê gói admin, QTV nhóm có quyền đổi mode như Bot Admin
        if (isAdminRental && isAdmin) {
            isBotAdmin = true;
        }

        if (!newMode) {
            if (!isAdmin && !isBotAdmin) {
                return api.sendMessage(
                    "❌ chỉ QTV nhóm hoặc chủ bot mới được xem mode!",
                    threadID,
                    messageID
                );
            }
        } else {
            // Changing mode: chỉ CHỦ BOT (hoặc QTV nhóm nếu thuê gói admin) mới được thực hiện
            if (!isBotAdmin) {
                return api.sendMessage(
                    "❌ Chỉ chủ bot mới được dùng lệnh mode để đổi mode!",
                    threadID,
                    messageID
                );
            }
        }

        // === KHÔNG CÓ ARG: XEM MODE HIỆN TẠI ===
        if (!newMode) {
            const timerList = getThreadSchedules(schedules, threadIDStr);
            const inTask = getThreadInTask(schedules, threadIDStr);
            const timerLine = timerList.length === 0
                ? "\n⏰ Hẹn giờ: Chưa bật"
                : `\n⏰ Lịch hẹn:\n${timerList.map((item, index) => `   ${index + 1}. ${item.time} -> ${item.mode.toUpperCase()}`).join("\n")}`;
            const inLine = !inTask
                ? "\n⌛ Chuyển sau khoảng thời gian: Chưa bật"
                : inTask.type === "temporary"
                    ? `\n⌛ Mode tạm thời:\n   Đang/từng chuyển sang ${inTask.temporaryMode.toUpperCase()}\n   Sẽ quay về ${inTask.restoreMode.toUpperCase()} lúc ${formatDateTimeVN(inTask.restoreAt)}\n   Còn lại khoảng: ${formatCountdown(inTask.restoreAt - Date.now())}`
                    : `\n⌛ Chuyển sau khoảng thời gian (dữ liệu cũ):\n   ${inTask.mode.toUpperCase()} sau ${inTask.duration || "--:--"} (dự kiến ${formatDateTimeVN(inTask.executeAt)})\n   Còn lại khoảng: ${formatCountdown(inTask.executeAt - Date.now())}`;

            return api.sendMessage(
                `🎛️ MODE HIỆN TẠI\n━━━━━━━━━━━━━\n${modeEmoji[currentMode]} Mode: ${currentMode.toUpperCase()}\n📝 ${modeDesc[currentMode]}${timerLine}${inLine}\n━━━━━━━━━━━━━\n💡 ${prefix}mode user - Đổi mode ngay\n💡 ${prefix}mode qtv 23:00 - Lịch hằng ngày\n💡 ${prefix}mode in 00:30 user - Đổi ngay, 30 phút sau quay về mode cũ\n💡 ${prefix}mode off hoặc ${prefix}mode off qtv hoặc ${prefix}mode off in`,
                threadID,
                messageID
            );
        }

        // !mode in HH:MM <mode> -> đổi mode ngay, hết thời gian quay về mode cũ
        if (newMode === "in") {
            const durationArg = args[1]?.toLowerCase();
            const targetMode = normalizeMode(args[2]?.toLowerCase());

            if (currentMode === "adminbot" && !isBotAdmin) {
                return api.sendMessage(
                    "❌ Nhóm đang ở ADMINBOT: chỉ chủ bot mới được hẹn giờ đổi mode.",
                    threadID,
                    messageID
                );
            }

            if (!durationArg || !targetMode) {
                return api.sendMessage(
                    `⚠️ Thiếu tham số!\n💡 Dùng: ${prefix}mode in <HH:MM> <user|qtv|adminbot>`,
                    threadID,
                    messageID
                );
            }

            const delayMs = durationHHMMToMs(durationArg);
            if (!delayMs) {
                return api.sendMessage(
                    `⚠️ Thời gian không hợp lệ!\n💡 Định dạng: HH:MM và phải lớn hơn 00:00\n💡 Ví dụ: ${prefix}mode in 00:30 user`,
                    threadID,
                    messageID
                );
            }

            if (!VALID_MODES.includes(targetMode)) {
                return api.sendMessage(
                    "⚠️ Mode không hợp lệ!\n💡 Hợp lệ: user, qtv, adminbot",
                    threadID,
                    messageID
                );
            }

            if (targetMode === currentMode) {
                return api.sendMessage(
                    `ℹ️ Mode hiện tại đã là ${targetMode.toUpperCase()}.\n💡 Hãy chọn mode tạm khác mode hiện tại.`,
                    threadID,
                    messageID
                );
            }

            const restoreAt = Date.now() + delayMs;
            const existingDaily = getThreadSchedules(schedules, threadIDStr);
            const inTask = {
                type: "temporary",
                temporaryMode: targetMode,
                restoreMode: currentMode,
                restoreAt,
                duration: durationArg,
                updatedAt: Date.now(),
                updatedBy: senderID
            };

            // Đổi mode ngay lập tức
            settings[threadIDStr] = targetMode;
            await writeSettings(settings);

            saveThreadSchedules(schedules, threadIDStr, existingDaily, inTask);
            await writeSchedules(schedules);

            return api.sendMessage(
                `✅ ĐÃ ĐỔI MODE TẠM THỜI!\n━━━━━━━━━━━━━\n🎛️ Mode hiện tại: ${targetMode.toUpperCase()}\n⌛ Sau ${durationArg} sẽ tự quay về: ${currentMode.toUpperCase()}\n🕒 Dự kiến quay về: ${formatDateTimeVN(restoreAt)}\n━━━━━━━━━━━━━\n💡 Hủy lịch quay về: ${prefix}mode off in`,
                threadID,
                messageID
            );
        }

        // !mode off -> tắt lịch đổi mode
        if (["off", "clear", "xoa"].includes(newMode)) {
            const timerList = getThreadSchedules(schedules, threadIDStr);
            const inTask = getThreadInTask(schedules, threadIDStr);

            if (timerList.length === 0 && !inTask) {
                return api.sendMessage(
                    "ℹ️ Nhóm chưa có lịch mode để tắt.",
                    threadID,
                    messageID
                );
            }

            if (currentMode === "adminbot" && !isBotAdmin) {
                return api.sendMessage(
                    "❌ Nhóm đang ở ADMINBOT: chỉ chủ bot mới được tắt lịch mode.",
                    threadID,
                    messageID
                );
            }

            if (!secondArg) {
                delete schedules[threadIDStr];
                await writeSchedules(schedules);

                return api.sendMessage(
                    "✅ Đã tắt toàn bộ hẹn giờ mode cho nhóm này.",
                    threadID,
                    messageID
                );
            }

            let filtered = timerList;
            let nextInTask = inTask;

            if (VALID_MODES.includes(secondArg)) {
                filtered = timerList.filter(item => item.mode !== secondArg);
            } else if (isValidTimeHHMM(secondArg)) {
                filtered = timerList.filter(item => item.time !== secondArg);
            } else if (secondArg === "in") {
                nextInTask = null;
            } else {
                return api.sendMessage(
                    `⚠️ Cú pháp xóa lịch không hợp lệ!\n💡 Dùng: ${prefix}mode off <user|qtv|adminbot|HH:MM|in>`,
                    threadID,
                    messageID
                );
            }

            if (filtered.length === timerList.length && nextInTask === inTask) {
                return api.sendMessage(
                    "ℹ️ Không tìm thấy lịch cần xóa.",
                    threadID,
                    messageID
                );
            }

            saveThreadSchedules(schedules, threadIDStr, filtered, nextInTask);
            await writeSchedules(schedules);

            const remainLine = [];
            if (filtered.length > 0) {
                remainLine.push(`⏰ Lịch hằng ngày còn lại:\n${filtered.map((item, index) => `${index + 1}. ${item.time} -> ${item.mode.toUpperCase()}`).join("\n")}`);
            }
            if (nextInTask) {
                if (nextInTask.type === "temporary") {
                    remainLine.push(`⌛ Lịch 'in' còn lại: ${nextInTask.temporaryMode.toUpperCase()} -> ${nextInTask.restoreMode.toUpperCase()} lúc ${formatDateTimeVN(nextInTask.restoreAt)}`);
                } else {
                    remainLine.push(`⌛ Lịch 'in' còn lại (dữ liệu cũ): ${nextInTask.mode.toUpperCase()} lúc ${formatDateTimeVN(nextInTask.executeAt)}`);
                }
            }

            return api.sendMessage(
                remainLine.length === 0
                    ? "✅ Đã xóa lịch, hiện nhóm không còn hẹn giờ mode."
                    : `✅ Đã xóa lịch thành công.\n${remainLine.join("\n")}`,
                threadID,
                messageID
            );
        }

        // === ĐỔI MODE ===
        if (currentMode === "adminbot" && !isBotAdmin) {
            return api.sendMessage(
                "❌ Nhóm đang ở ADMINBOT: chỉ chủ bot mới được đổi mode.",
                threadID,
                messageID
            );
        }

        // Kiểm tra quyền
        if (!isAdmin && !isBotAdmin) {
            return api.sendMessage(
                "❌ chỉ QTV nhóm hoặc chủ bot mới được đổi mode!",
                threadID,
                messageID
            );
        }

        // Kiểm tra mode hợp lệ
        if (!VALID_MODES.includes(newMode)) {
            return api.sendMessage(
                `⚠️ Mode không hợp lệ!\n━━━━━━━━━━━━━\n💡 Hợp lệ: user, qtv, adminbot\n💡 Ví dụ: ${prefix}mode qtv`,
                threadID,
                messageID
            );
        }

        // Nếu có HH:MM -> đặt lịch đổi mode hằng ngày
        if (secondArg) {
            if (!isValidTimeHHMM(secondArg)) {
                return api.sendMessage(
                    "⚠️ Thời gian không hợp lệ!\n💡 Đúng định dạng: HH:MM (24h), ví dụ: 23:30",
                    threadID,
                    messageID
                );
            }

            const timerList = getThreadSchedules(schedules, threadIDStr);
            const sameModeIndex = timerList.findIndex(item => item.mode === newMode);
            const timeConflict = timerList.find(item => item.time === secondArg && item.mode !== newMode);

            if (timeConflict) {
                return api.sendMessage(
                    `⚠️ Đã có lịch ở ${secondArg} cho mode ${timeConflict.mode.toUpperCase()}.\n💡 Hãy chọn giờ khác.`,
                    threadID,
                    messageID
                );
            }

            if (sameModeIndex >= 0) {
                timerList[sameModeIndex] = {
                    ...timerList[sameModeIndex],
                    time: secondArg,
                    mode: newMode,
                    enabled: true,
                    updatedAt: Date.now(),
                    updatedBy: senderID
                };
            } else {
                if (timerList.length >= MAX_SCHEDULES_PER_THREAD) {
                    return api.sendMessage(
                        `⚠️ Nhóm chỉ lưu tối đa 2 lịch mode.\n💡 Xóa bớt bằng: ${prefix}mode off <mode|HH:MM>`,
                        threadID,
                        messageID
                    );
                }

                timerList.push({
                    time: secondArg,
                    mode: newMode,
                    enabled: true,
                    updatedAt: Date.now(),
                    updatedBy: senderID
                });
            }

            const keepInTask = getThreadInTask(schedules, threadIDStr);
            saveThreadSchedules(schedules, threadIDStr, timerList, keepInTask);
            await writeSchedules(schedules);

            const finalList = getThreadSchedules(schedules, threadIDStr);

            return api.sendMessage(
                `✅ LƯU LỊCH MODE THÀNH CÔNG!\n━━━━━━━━━━━━━\n${finalList.map((item, index) => `⏰ ${index + 1}. ${item.time} -> ${item.mode.toUpperCase()}`).join("\n")}\n━━━━━━━━━━━━━\n💡 Tối đa 2 lịch\n💡 Xóa lịch: ${prefix}mode off <mode|HH:MM>`,
                threadID,
                messageID
            );
        }

        // Mode trùng với hiện tại
        if (newMode === currentMode) {
            return api.sendMessage(
                `ℹ️ Mode đã là ${newMode.toUpperCase()} rồi!`,
                threadID,
                messageID
            );
        }

        // Lưu mode mới
        settings[threadIDStr] = newMode;
        await writeSettings(settings);

        return api.sendMessage(
            `✅ ĐỔI MODE THÀNH CÔNG!\n━━━━━━━━━━━━━\n${modeEmoji[newMode]} Mode: ${newMode.toUpperCase()}\n📝 ${modeDesc[newMode]}\n━━━━━━━━━━━━━\n💡 Mode này áp dụng ngay cho tất cả lệnh!`,
            threadID,
            messageID
        );
    }
};
