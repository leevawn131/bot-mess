const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_ENERGY = 100;
const VIP_MAX_ENERGY = 150;
const NORMAL_REGEN_PER_SEC = 1 / 60;
const VIP_REGEN_PER_SEC = 1.5 / 60;

const ENERGY_POTION_ITEM = {
    item_key: "energy_potion",
    name: "Bình hồi thể lực",
    price: 75000,
    type: "energy_restore",
    effect_value: 50,
    uses: 1,
    stackable: 1,
    description: "Hồi ngay 50 thể lực"
};

function getDBConfigFromRuntime(config) {
    const db = config?.database;
    if (db?.host && db?.user && db?.name) {
        return {
            host: db.host,
            port: db.port,
            user: db.user,
            password: db.password,
            database: db.name
        };
    }

    try {
        let configPath = path.resolve(process.cwd(), "config.json");
        if (!fs.existsSync(configPath)) {
            configPath = path.resolve(__dirname, "../../config.json");
        }
        if (!fs.existsSync(configPath)) return { type: "sqlite" };
        const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
        const fileDb = fileConfig?.database || {};
        return {
            host: fileDb.host || "localhost",
            port: fileDb.port || 3306,
            user: fileDb.user || "root",
            password: fileDb.password || "",
            database: fileDb.name || "bot"
        };
    } catch {
        return { type: "sqlite" };
    }
}

async function ensureEnergyColumns(connection) {
    const [columns] = await connection.execute("PRAGMA table_info(messenger_users)");
    const existing = new Set(columns.map((row) => String(row.name)));

    if (!existing.has("energy")) {
        await connection.execute(
            "ALTER TABLE messenger_users ADD COLUMN energy INTEGER NOT NULL DEFAULT 100"
        );
    }

    if (!existing.has("max_energy")) {
        await connection.execute(
            "ALTER TABLE messenger_users ADD COLUMN max_energy INTEGER NOT NULL DEFAULT 100"
        );
    }

    if (!existing.has("last_energy_update")) {
        await connection.execute(
            "ALTER TABLE messenger_users ADD COLUMN last_energy_update TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP"
        );
    }

    if (!existing.has("last_energy_update_unix")) {
        await connection.execute(
            "ALTER TABLE messenger_users ADD COLUMN last_energy_update_unix BIGINT NULL"
        );
        await connection.execute(
            "UPDATE messenger_users SET last_energy_update_unix = strftime('%s', last_energy_update) WHERE last_energy_update IS NOT NULL"
        );
    }
}

function normalizeTimestampMs(dateValue, nowMs) {
    const parsedMs = dateValue ? new Date(dateValue).getTime() : nowMs;
    if (!Number.isFinite(parsedMs)) return nowMs;
    if (parsedMs > nowMs) return nowMs;
    return parsedMs;
}

function getRowLastUpdateMs(row, nowMs) {
    const unixSeconds = Number(row?.last_energy_update_unix);
    if (Number.isFinite(unixSeconds) && unixSeconds > 0) {
        const parsedMs = Math.floor(unixSeconds * 1000);
        if (parsedMs > nowMs) return nowMs;
        return parsedMs;
    }
    const fallbackUnixSeconds = Number(row?.last_energy_update_unix_fallback);
    if (Number.isFinite(fallbackUnixSeconds) && fallbackUnixSeconds > 0) {
        const fallbackMs = Math.floor(fallbackUnixSeconds * 1000);
        if (fallbackMs > nowMs) return nowMs;
        return fallbackMs;
    }
    return normalizeTimestampMs(row?.last_energy_update, nowMs);
}

function toSecondPrecisionMs(ms) {
    return Math.floor(Math.max(0, Number(ms) || 0) / 1000) * 1000;
}

function isStateChanged(row, state, nowMs) {
    const rowEnergy = Number(row.energy);
    const rowMax = Number(row.max_energy);
    const rowLastMs = getRowLastUpdateMs(row, nowMs);

    return (
        !Number.isFinite(rowEnergy) || rowEnergy !== state.energy ||
        !Number.isFinite(rowMax) || rowMax !== state.maxEnergy ||
        rowLastMs !== state.lastUpdateMs
    );
}

async function persistEnergyState(connection, threadID, userID, state) {
    const unixSeconds = Math.floor(state.lastUpdateMs / 1000);
    const thread = String(threadID || 'global');
    await connection.execute(
        `UPDATE messenger_users
         SET energy = ?, max_energy = ?, last_energy_update_unix = ?, last_energy_update = datetime(?, 'unixepoch')
         WHERE thread_id = ? AND psid = ?`,
        [state.energy, state.maxEnergy, unixSeconds, unixSeconds, thread, String(userID)]
    );
}

function computeRegeneratedState(row, nowMs = Date.now()) {
    const safeNowMs = toSecondPrecisionMs(nowMs);
    const nowDate = new Date(safeNowMs);
    const hasVip = !!(row.vip_until && new Date(row.vip_until) > nowDate);
    const maxEnergy = hasVip ? VIP_MAX_ENERGY : DEFAULT_MAX_ENERGY;
    const regenPerSec = hasVip ? VIP_REGEN_PER_SEC : NORMAL_REGEN_PER_SEC;

    let energy = Number(row.energy);
    if (!Number.isFinite(energy)) energy = maxEnergy;
    energy = Math.max(0, Math.min(Math.floor(energy), maxEnergy));

    let lastUpdateMs = getRowLastUpdateMs(row, safeNowMs);

    if (energy >= maxEnergy) {
        return {
            hasVip,
            maxEnergy,
            regenPerSec,
            energy: maxEnergy,
            lastUpdateMs: safeNowMs
        };
    }

    const elapsedMs = Math.max(0, safeNowMs - lastUpdateMs);
    const recovered = Math.floor((elapsedMs / 1000) * regenPerSec);

    if (recovered > 0) {
        energy = Math.min(maxEnergy, energy + recovered);
        const consumedMs = Math.floor((recovered / regenPerSec) * 1000);
        lastUpdateMs += consumedMs;
    }

    if (energy >= maxEnergy) {
        lastUpdateMs = safeNowMs;
    }

    return {
        hasVip,
        maxEnergy,
        regenPerSec,
        energy,
        lastUpdateMs
    };
}

function formatWaitSeconds(totalSeconds) {
    const sec = Math.max(1, Math.ceil(totalSeconds));
    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;
    if (minutes <= 0) return `${seconds} giây`;
    if (seconds === 0) return `${minutes} phút`;
    return `${minutes} phút ${seconds} giây`;
}

function buildNotEnoughEnergyMessage(cost, state) {
    const deficit = Math.max(0, cost - state.energy);
    const waitSeconds = deficit <= 0 ? 0 : deficit / state.regenPerSec;
    return {
        waitSeconds,
        message:
            `😵 Không đủ thể lực, nghỉ ngơi đi!\n` +
            `⚡ Hiện tại: ${state.energy}/${state.maxEnergy}\n` +
            `🔋 Cần: ${cost} thể lực\n` +
            `⏳ Ước tính hồi đủ: ${formatWaitSeconds(waitSeconds)}`
    };
}

function parseUserArgs(arg2, arg3, arg4) {
    let threadID, userID, cost;
    if (arg4 !== undefined) {
        threadID = String(arg2);
        userID = String(arg3);
        cost = arg4;
    } else if (typeof arg3 === 'number' || (!isNaN(Number(arg3)) && typeof arg2 === 'string' && String(arg2).length > 10)) {
        // (connection, userID, cost)
        threadID = null;
        userID = String(arg2);
        cost = arg3;
    } else {
        threadID = String(arg2);
        userID = String(arg3);
        cost = 0;
    }
    return { threadID, userID, cost };
}

async function fetchEnergyUserRow(connection, threadID, userID) {
    let rows = [];
    const uid = String(userID);
    const tid = threadID && threadID !== 'global' ? String(threadID) : null;

    if (tid) {
        [rows] = await connection.execute(
            `SELECT psid, thread_id, vip_until, energy, max_energy, last_energy_update, last_energy_update_unix,
                    strftime('%s', last_energy_update) AS last_energy_update_unix_fallback
             FROM messenger_users WHERE thread_id = ? AND psid = ?`,
            [tid, uid]
        );
    }

    if (!rows || rows.length === 0) {
        [rows] = await connection.execute(
            `SELECT psid, thread_id, vip_until, energy, max_energy, last_energy_update, last_energy_update_unix,
                    strftime('%s', last_energy_update) AS last_energy_update_unix_fallback
             FROM messenger_users WHERE psid = ? ORDER BY last_energy_update_unix DESC LIMIT 1`,
            [uid]
        );
    }

    if (!rows || rows.length === 0) {
        const createTid = tid || 'global';
        await connection.execute(
            `INSERT OR IGNORE INTO messenger_users (thread_id, psid, credits, energy, max_energy) VALUES (?, ?, 10000, 100, 100)`,
            [createTid, uid]
        );
        [rows] = await connection.execute(
            `SELECT psid, thread_id, vip_until, energy, max_energy, last_energy_update, last_energy_update_unix,
                    strftime('%s', last_energy_update) AS last_energy_update_unix_fallback
             FROM messenger_users WHERE psid = ? ORDER BY last_energy_update_unix DESC LIMIT 1`,
            [uid]
        );
    }

    return rows;
}

async function readAndSyncEnergy(connection, arg2, arg3, nowMs = Date.now()) {
    await ensureEnergyColumns(connection);
    const safeNowMs = toSecondPrecisionMs(nowMs);
    let threadID = null;
    let userID = String(arg2);
    if (arg3 && typeof arg3 !== 'number') {
        threadID = String(arg2);
        userID = String(arg3);
    }

    const rows = await fetchEnergyUserRow(connection, threadID, userID);
    if (!rows || rows.length === 0) {
        return { ok: false, reason: "no_account" };
    }

    const current = rows[0];
    const actualThreadID = current.thread_id || threadID;
    const state = computeRegeneratedState(current, safeNowMs);
    const changed = isStateChanged(current, state, safeNowMs);

    if (changed) {
        await persistEnergyState(connection, actualThreadID, userID, state);
    }

    return { ok: true, ...state };
}

async function consumeEnergy(connection, arg2, arg3, arg4, nowMs = Date.now()) {
    const { threadID, userID, cost } = parseUserArgs(arg2, arg3, arg4);
    const required = Math.max(0, Math.floor(Number(cost) || 0));
    const safeNowMs = toSecondPrecisionMs(nowMs);
    await ensureEnergyColumns(connection);

    await connection.beginTransaction();
    try {
        const rows = await fetchEnergyUserRow(connection, threadID, userID);
        const current = rows[0];
        const actualThreadID = current.thread_id || threadID;
        const state = computeRegeneratedState(current, safeNowMs);

        if (isStateChanged(current, state, safeNowMs)) {
            await persistEnergyState(connection, actualThreadID, userID, state);
        }

        if (state.energy < required) {
            await connection.commit();
            const notEnough = buildNotEnoughEnergyMessage(required, state);
            return {
                ok: false,
                reason: "not_enough",
                ...state,
                waitSeconds: notEnough.waitSeconds,
                message: notEnough.message
            };
        }

        const nextState = {
            energy: Math.max(0, state.energy - required),
            maxEnergy: state.maxEnergy,
            lastUpdateMs: state.lastUpdateMs
        };

        await persistEnergyState(connection, actualThreadID, userID, nextState);
        await connection.commit();

        return {
            ok: true,
            energy: nextState.energy,
            maxEnergy: state.maxEnergy,
            hasVip: state.hasVip,
            regenPerSec: state.regenPerSec
        };
    } catch (error) {
        try { await connection.rollback(); } catch (_) {}
        throw error;
    }
}

async function restoreEnergy(connection, arg2, arg3, arg4, nowMs = Date.now()) {
    const { threadID, userID, cost: amount } = parseUserArgs(arg2, arg3, arg4);
    const restoreAmount = Math.max(0, Math.floor(Number(amount) || 0));
    const safeNowMs = toSecondPrecisionMs(nowMs);
    await ensureEnergyColumns(connection);

    await connection.beginTransaction();
    try {
        const rows = await fetchEnergyUserRow(connection, threadID, userID);
        const current = rows[0];
        const actualThreadID = current.thread_id || threadID;
        const state = computeRegeneratedState(current, safeNowMs);
        const before = state.energy;
        const after = Math.min(state.maxEnergy, before + restoreAmount);

        const nextState = {
            energy: after,
            maxEnergy: state.maxEnergy,
            lastUpdateMs: state.lastUpdateMs
        };

        await persistEnergyState(connection, actualThreadID, userID, nextState);
        await connection.commit();

        return {
            ok: true,
            before,
            after,
            maxEnergy: state.maxEnergy,
            restored: Math.max(0, after - before),
            hasVip: state.hasVip
        };
    } catch (error) {
        try { await connection.rollback(); } catch (_) {}
        throw error;
    }
}

async function ensureEnergyPotionItem(connection) {
    const item = ENERGY_POTION_ITEM;
    await connection.execute(
        `INSERT INTO shop_items (item_key, name, price, type, effect_value, uses, stackable, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_key) DO UPDATE SET
            name = excluded.name,
            price = excluded.price,
            type = excluded.type,
            effect_value = excluded.effect_value,
            uses = excluded.uses,
            stackable = excluded.stackable,
            description = excluded.description`,
        [
            item.item_key,
            item.name,
            item.price,
            item.type,
            item.effect_value,
            item.uses,
            item.stackable,
            item.description
        ]
    );
}

module.exports = {
    DEFAULT_MAX_ENERGY,
    VIP_MAX_ENERGY,
    NORMAL_REGEN_PER_SEC,
    VIP_REGEN_PER_SEC,
    ENERGY_POTION_ITEM,
    getDBConfigFromRuntime,
    ensureEnergyColumns,
    readAndSyncEnergy,
    consumeEnergy,
    restoreEnergy,
    ensureEnergyPotionItem
};
