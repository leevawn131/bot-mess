const MAX_SUCCESS_STREAK = 50;
const RESET_INACTIVE_MS = 5 * 60 * 1000;
const LOCK_DURATION_MS = 10 * 60 * 1000;

function ensureStore() {
    global.minigameLimiter = global.minigameLimiter || new Map();
    return global.minigameLimiter;
}

function getState(userID) {
    const store = ensureStore();
    const key = String(userID);
    const current = store.get(key) || { count: 0, lastPlayedAt: 0, lockedUntil: 0 };
    return { store, key, current };
}

function formatTimeLeft(ms) {
    const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds}s`;
    if (seconds === 0) return `${minutes}p`;
    return `${minutes}p ${seconds}s`;
}

function checkMinigameLimit(userID, now = Date.now()) {
    const { store, key, current } = getState(userID);

    if (current.lastPlayedAt > 0 && (now - current.lastPlayedAt) >= RESET_INACTIVE_MS) {
        current.count = 0;
    }

    if (current.lockedUntil > 0 && now < current.lockedUntil) {
        const left = current.lockedUntil - now;
        return {
            allowed: false,
            message: `🤬 Nghiện à, nghỉ cho tao 10 phút!\n⏳ Còn lại: ${formatTimeLeft(left)}`
        };
    }

    if (current.lockedUntil > 0 && now >= current.lockedUntil) {
        current.lockedUntil = 0;
    }

    store.set(key, current);
    return { allowed: true };
}

function recordMinigameSuccess(userID, now = Date.now()) {
    const { store, key, current } = getState(userID);

    if (current.lastPlayedAt > 0 && (now - current.lastPlayedAt) >= RESET_INACTIVE_MS) {
        current.count = 0;
    }

    current.count += 1;
    current.lastPlayedAt = now;

    if (current.count >= MAX_SUCCESS_STREAK) {
        current.count = 0;
        current.lockedUntil = now + LOCK_DURATION_MS;
        store.set(key, current);
        return {
            locked: true,
            message: "🤬 Nạy bố, chơi ít thôi, nghỉ 10 phút cho tỉnh!"
        };
    }

    store.set(key, current);
    return { locked: false };
}

module.exports = {
    checkMinigameLimit,
    recordMinigameSuccess
};
