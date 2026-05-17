const DEFAULT_DURATION_MS = 10000;

function checkCooldown({ command, key, durationMs = DEFAULT_DURATION_MS, now = Date.now() }) {
    if (!command || !key) {
        return { allowed: true, timeLeft: 0 };
    }

    global.commandCooldowns = global.commandCooldowns || new Map();

    const mapKey = `${command}:${String(key)}`;
    const lastUse = global.commandCooldowns.get(mapKey);

    if (lastUse && (now - lastUse) < durationMs) {
        const timeLeft = Math.ceil((durationMs - (now - lastUse)) / 1000);
        return { allowed: false, timeLeft };
    }

    global.commandCooldowns.set(mapKey, now);
    return { allowed: true, timeLeft: 0 };
}

module.exports = {
    checkCooldown
};
