const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "../../mode_settings.json");
const SCHEDULE_PATH = path.join(__dirname, "../../mode_schedule.json");
const VALID_MODES = new Set(["user", "qtv", "adminbot"]);
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

let intervalHandle = null;
const lastRunSet = new Set();
const lastWarnSet = new Set();

function safeSendMessage(api, threadID, body, contextTag) {
    try {
        if (!api || typeof api.sendMessage !== "function") return;

        const result = api.sendMessage(body, threadID);
        if (result && typeof result.then === "function") {
            result.catch((err) => {
                console.error(`❌ Không gửi được ${contextTag} cho nhóm ${threadID}:`, err);
            });
        }
    } catch (err) {
        console.error(`❌ Không gửi được ${contextTag} cho nhóm ${threadID}:`, err);
    }
}

function readJsonFile(filePath, fallback = {}) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, "utf8");
        if (!raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch (e) {
        console.error(`❌ Lỗi đọc file ${path.basename(filePath)}:`, e);
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`❌ Lỗi ghi file ${path.basename(filePath)}:`, e);
    }
}

function getLocalTimeHHMM(date) {
    const vnTime = new Date(date.getTime() + (7 * 60 * 60 * 1000));
    const hh = String(vnTime.getUTCHours()).padStart(2, "0");
    const mm = String(vnTime.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

function getDateStamp(date) {
    const vnTime = new Date(date.getTime() + (7 * 60 * 60 * 1000));
    const y = vnTime.getUTCFullYear();
    const m = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
    const d = String(vnTime.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parseHHMMToMinutes(timeText) {
    const match = String(timeText).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;

    const hh = Number(match[1]);
    const mm = Number(match[2]);
    return (hh * 60) + mm;
}

function minutesToHHMM(totalMinutes) {
    const safe = ((totalMinutes % 1440) + 1440) % 1440;
    const hh = String(Math.floor(safe / 60)).padStart(2, "0");
    const mm = String(safe % 60).padStart(2, "0");
    return `${hh}:${mm}`;
}

function normalizeThreadSchedules(threadScheduleValue) {
    let list = [];

    if (Array.isArray(threadScheduleValue)) {
        list = threadScheduleValue;
    } else if (threadScheduleValue && typeof threadScheduleValue === "object") {
        if (Array.isArray(threadScheduleValue.daily)) {
            list = threadScheduleValue.daily;
        } else if (Array.isArray(threadScheduleValue.schedules)) {
            list = threadScheduleValue.schedules;
        } else if (threadScheduleValue.time && threadScheduleValue.mode) {
            list = [threadScheduleValue];
        }
    }

    return list
        .filter(item => item && typeof item === "object")
        .map(item => ({
            time: String(item.time || "").trim(),
            mode: String(item.mode || "").toLowerCase(),
            enabled: item.enabled !== false
        }))
        .filter(item => item.enabled && VALID_MODES.has(item.mode) && parseHHMMToMinutes(item.time) !== null)
        .sort((a, b) => a.time.localeCompare(b.time));
}

function normalizeThreadInTask(threadScheduleValue) {
    let source = null;

    if (threadScheduleValue && typeof threadScheduleValue === "object") {
        if (threadScheduleValue.in && typeof threadScheduleValue.in === "object") {
            source = threadScheduleValue.in;
        } else if (threadScheduleValue.executeAt && threadScheduleValue.mode) {
            source = threadScheduleValue;
        }
    }

    if (!source) return null;

    const restoreAt = Number(source.restoreAt);
    const temporaryMode = String(source.temporaryMode || "").toLowerCase();
    const restoreMode = String(source.restoreMode || "").toLowerCase();

    if (Number.isFinite(restoreAt) && restoreAt > 0 && VALID_MODES.has(temporaryMode) && VALID_MODES.has(restoreMode)) {
        return {
            type: "temporary",
            restoreAt,
            temporaryMode,
            restoreMode,
            duration: String(source.duration || "")
        };
    }

    // Tương thích dữ liệu cũ: mode/executeAt (đổi mode sau khoảng thời gian)
    const executeAt = Number(source.executeAt);
    const mode = String(source.mode || "").toLowerCase();

    if (!Number.isFinite(executeAt) || executeAt <= 0) return null;
    if (!VALID_MODES.has(mode)) return null;

    return {
        type: "legacy-delay",
        executeAt,
        mode,
        duration: String(source.duration || "")
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

function saveThreadScheduleValue(schedules, threadID, dailyList, inTask) {
    const nextValue = buildThreadScheduleValue(dailyList, inTask);
    if (!nextValue) {
        delete schedules[threadID];
        return;
    }
    schedules[threadID] = nextValue;
}

function formatDateTimeVN(timestamp) {
    const d = new Date(timestamp);
    const vnTime = new Date(d.getTime() + (7 * 60 * 60 * 1000));
    const dd = String(vnTime.getUTCDate()).padStart(2, "0");
    const mm = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = vnTime.getUTCFullYear();
    const hh = String(vnTime.getUTCHours()).padStart(2, "0");
    const mi = String(vnTime.getUTCMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function formatCountdown(msLeft) {
    const safe = Math.max(0, Number(msLeft) || 0);
    const totalMinutes = Math.ceil(safe / 60000);
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function runModeSchedulerTick(api) {
    const schedules = readJsonFile(SCHEDULE_PATH, {});
    if (!schedules || typeof schedules !== "object") return;

    const now = new Date();
    const nowMs = now.getTime();
    const currentTime = getLocalTimeHHMM(now);
    const dateStamp = getDateStamp(now);

    const settings = readJsonFile(SETTINGS_PATH, {});
    let changed = false;
    let schedulesChanged = false;

    Object.entries(schedules).forEach(([threadIDRaw, item]) => {
        const threadID = String(threadIDRaw);
        const threadSchedules = normalizeThreadSchedules(item);
        const inTask = normalizeThreadInTask(item);

        threadSchedules.forEach((scheduleItem) => {
            const targetMode = scheduleItem.mode;
            const targetTime = scheduleItem.time;
            const targetMinutes = parseHHMMToMinutes(targetTime);

            if (targetMinutes === null) return;

            // Cảnh báo trước 15 phút cho lần chuyển sắp tới.
            const warningMinutes = (targetMinutes - 15 + 1440) % 1440;
            const warningTime = minutesToHHMM(warningMinutes);
            const warningBelongsToNextDay = warningMinutes > targetMinutes;
            const triggerDate = new Date(now);
            if (warningBelongsToNextDay) {
                triggerDate.setDate(triggerDate.getDate() + 1);
            }
            const triggerDateStamp = getDateStamp(triggerDate);
            const warnKey = `${threadID}:${triggerDateStamp}:${targetTime}:${targetMode}:warn`;

            if (currentTime === warningTime) {
                if (!lastWarnSet.has(warnKey)) {
                    lastWarnSet.add(warnKey);

                    safeSendMessage(
                        api,
                        threadID,
                        `⏰ Nhắc lịch mode\n━{13}\n🕒 Còn 15 phút nữa sẽ tự đổi mode\n🎛️ Mode đích: ${targetMode.toUpperCase()}\n🕓 Giờ chuyển: ${targetTime}`,
                        "cảnh báo trước 15 phút"
                    );
                }
            }

            if (targetTime !== currentTime) return;

            const runKey = `${threadID}:${dateStamp}:${targetTime}:${targetMode}`;
            if (lastRunSet.has(runKey)) return;
            lastRunSet.add(runKey);

            const currentMode = settings[threadID] || "adminbot";
            if (currentMode === targetMode) {
                return;
            }

            settings[threadID] = targetMode;
            changed = true;

            console.log(`⏰ [AUTO MODE] Thread ${threadID} -> ${targetMode} tại ${targetTime}`);

            safeSendMessage(
                api,
                threadID,
                `⏰ Tự động đổi mode theo lịch\n━{13}\n🕒 Thời gian: ${targetTime}\n🎛️ Mode mới: ${targetMode.toUpperCase()}`,
                "thông báo đổi mode"
            );
        });

        if (!inTask) return;

        if (inTask.type === "temporary") {
            const inRunKey = `${threadID}:${inTask.restoreAt}:${inTask.restoreMode}:${inTask.temporaryMode}:in:run`;
            const inWarnKey = `${threadID}:${inTask.restoreAt}:${inTask.restoreMode}:${inTask.temporaryMode}:in:warn`;
            const inMsLeft = inTask.restoreAt - nowMs;

            if (inMsLeft > 0 && inMsLeft <= FIFTEEN_MINUTES_MS && !lastWarnSet.has(inWarnKey)) {
                lastWarnSet.add(inWarnKey);

                safeSendMessage(
                    api,
                    threadID,
                    `⏰ Nhắc lịch mode tạm thời\n━{13}\n🕒 Còn khoảng ${formatCountdown(inMsLeft)} nữa sẽ quay về mode cũ\n🔄 Từ ${inTask.temporaryMode.toUpperCase()} về ${inTask.restoreMode.toUpperCase()}\n🕓 Dự kiến: ${formatDateTimeVN(inTask.restoreAt)}`,
                    "cảnh báo lịch in"
                );
            }

            if (inMsLeft > 0) return;
            if (lastRunSet.has(inRunKey)) return;
            lastRunSet.add(inRunKey);

            const currentMode = settings[threadID] || "adminbot";
            if (currentMode !== inTask.restoreMode) {
                settings[threadID] = inTask.restoreMode;
                changed = true;
            }

            console.log(`⏰ [AUTO MODE][IN] Thread ${threadID} -> ${inTask.restoreMode} (restore) tại ${new Date(inTask.restoreAt).toISOString()}`);

            safeSendMessage(
                api,
                threadID,
                `⏰ Hết thời gian mode tạm thời\n━{13}\n🔄 Đã quay về mode cũ: ${inTask.restoreMode.toUpperCase()}\n🕓 Thời điểm: ${formatDateTimeVN(inTask.restoreAt)}`,
                "thông báo hoàn tác mode in"
            );

            saveThreadScheduleValue(schedules, threadID, threadSchedules, null);
            schedulesChanged = true;
            return;
        }

        // Tương thích dữ liệu cũ: đổi mode sau khoảng thời gian
        const inRunKey = `${threadID}:${inTask.executeAt}:${inTask.mode}:in:run`;
        const inWarnKey = `${threadID}:${inTask.executeAt}:${inTask.mode}:in:warn`;
        const inMsLeft = inTask.executeAt - nowMs;

        if (inMsLeft > 0 && inMsLeft <= FIFTEEN_MINUTES_MS && !lastWarnSet.has(inWarnKey)) {
            lastWarnSet.add(inWarnKey);

            safeSendMessage(
                api,
                threadID,
                `⏰ Nhắc lịch mode\n━{13}\n🕒 Còn khoảng ${formatCountdown(inMsLeft)} nữa sẽ tự đổi mode\n🎛️ Mode đích: ${inTask.mode.toUpperCase()}\n🕓 Dự kiến: ${formatDateTimeVN(inTask.executeAt)}`,
                "cảnh báo lịch in cũ"
            );
        }

        if (inMsLeft > 0) return;
        if (lastRunSet.has(inRunKey)) return;
        lastRunSet.add(inRunKey);

        const currentMode = settings[threadID] || "adminbot";
        if (currentMode !== inTask.mode) {
            settings[threadID] = inTask.mode;
            changed = true;

            console.log(`⏰ [AUTO MODE][IN-LEGACY] Thread ${threadID} -> ${inTask.mode} tại ${new Date(inTask.executeAt).toISOString()}`);

            safeSendMessage(
                api,
                threadID,
                `⏰ Đã đổi mode theo lịch 'in' (kiểu cũ)\n━{13}\n🎛️ Mode mới: ${inTask.mode.toUpperCase()}\n🕓 Thời điểm: ${formatDateTimeVN(inTask.executeAt)}`,
                "thông báo đổi mode in kiểu cũ"
            );
        }

        saveThreadScheduleValue(schedules, threadID, threadSchedules, null);
        schedulesChanged = true;
    });

    if (changed) {
        writeJsonFile(SETTINGS_PATH, settings);
    }

    if (schedulesChanged) {
        writeJsonFile(SCHEDULE_PATH, schedules);
    }
}

function startModeScheduler(api, options = {}) {
    const tickMs = Number(options.tickMs) > 0 ? Number(options.tickMs) : 30000;

    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }

    runModeSchedulerTick(api);
    intervalHandle = setInterval(() => runModeSchedulerTick(api), tickMs);

    if (typeof intervalHandle.unref === "function") {
        intervalHandle.unref();
    }

    console.log(`⏰ Mode scheduler đang chạy (tick ${tickMs}ms)`);
}

function stopModeScheduler() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}

module.exports = {
    startModeScheduler,
    stopModeScheduler
};
