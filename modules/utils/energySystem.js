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
        const configPath = path.resolve(process.cwd(), "config.json");
        if (!fs.existsSync(configPath)) return null;
        const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
        const fileDb = fileConfig?.database;
        if (!fileDb) return null;
        return {
            host: fileDb.host,
            port: fileDb.port,
            user: fileDb.user,
            password: fileDb.password,
            database: fileDb.name
        };
    } catch {
        return null;
    }
}

async function ensureEnergyColumns(connection) {
    const [columns] = await connection.execute(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messenger_users'
                     AND COLUMN_NAME IN ('energy', 'max_energy', 'last_energy_update', 'last_energy_update_unix')`
    );

    const existing = new Set(columns.map((row) => String(row.COLUMN_NAME)));

    if (!existing.has("energy")) {
        await connection.execute(
            "ALTER TABLE messenger_users ADD COLUMN energy INT NOT NULL DEFAULT 100"
        );
    }

    if (!existing.has("max_energy")) {
        await connection.execute(
            "ALTER TABLE messenger_users ADD COLUMN max_energy INT NOT NULL DEFAULT 100"
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
            "UPDATE messenger_users SET last_energy_update_unix = UNIX_TIMESTAMP(last_energy_update) WHERE last_energy_update IS NOT NULL"
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

async function persistEnergyState(connection, userID, state) {
    const unixSeconds = Math.floor(state.lastUpdateMs / 1000);
    await connection.execute(
        `UPDATE messenger_users
         SET energy = ?, max_energy = ?, last_energy_update_unix = ?, last_energy_update = FROM_UNIXTIME(?)
         WHERE psid = ?`,
        [state.energy, state.maxEnergy, unixSeconds, unixSeconds, String(userID)]
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

async function readAndSyncEnergy(connection, userID, nowMs = Date.now()) {
    await ensureEnergyColumns(connection);
    const safeNowMs = toSecondPrecisionMs(nowMs);

    const [rows] = await connection.execute(
        `SELECT psid, vip_until, energy, max_energy, last_energy_update, last_energy_update_unix,
            UNIX_TIMESTAMP(last_energy_update) AS last_energy_update_unix_fallback
         FROM messenger_users WHERE psid = ?`,
        [String(userID)]
    );

    if (rows.length === 0) {
        return { ok: false, reason: "no_account" };
    }

    const current = rows[0];
    const state = computeRegeneratedState(current, safeNowMs);
    const changed = isStateChanged(current, state, safeNowMs);

    if (changed) {
        await persistEnergyState(connection, userID, state);
    }

    return { ok: true, ...state };
}

async function consumeEnergy(connection, userID, cost, nowMs = Date.now()) {
    const required = Math.max(0, Math.floor(Number(cost) || 0));
    const safeNowMs = toSecondPrecisionMs(nowMs);
    await ensureEnergyColumns(connection);

    await connection.beginTransaction();
    try {
        const [rows] = await connection.execute(
            `SELECT psid, vip_until, energy, max_energy, last_energy_update, last_energy_update_unix,
                    UNIX_TIMESTAMP(last_energy_update) AS last_energy_update_unix_fallback
             FROM messenger_users WHERE psid = ? FOR UPDATE`,
            [String(userID)]
        );

        if (rows.length === 0) {
            await connection.rollback();
            return { ok: false, reason: "no_account" };
        }

        const current = rows[0];
        const state = computeRegeneratedState(current, safeNowMs);

        if (isStateChanged(current, state, safeNowMs)) {
            await persistEnergyState(connection, userID, state);
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

        await persistEnergyState(connection, userID, nextState);
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

async function restoreEnergy(connection, userID, amount, nowMs = Date.now()) {
    const restoreAmount = Math.max(0, Math.floor(Number(amount) || 0));
    const safeNowMs = toSecondPrecisionMs(nowMs);
    await ensureEnergyColumns(connection);

    await connection.beginTransaction();
    try {
        const [rows] = await connection.execute(
            `SELECT psid, vip_until, energy, max_energy, last_energy_update, last_energy_update_unix,
                    UNIX_TIMESTAMP(last_energy_update) AS last_energy_update_unix_fallback
             FROM messenger_users WHERE psid = ? FOR UPDATE`,
            [String(userID)]
        );

        if (rows.length === 0) {
            await connection.rollback();
            return { ok: false, reason: "no_account" };
        }

        const current = rows[0];
        const state = computeRegeneratedState(current, safeNowMs);
        const before = state.energy;
        const after = Math.min(state.maxEnergy, before + restoreAmount);

        const nextState = {
            energy: after,
            maxEnergy: state.maxEnergy,
            lastUpdateMs: state.lastUpdateMs
        };

        await persistEnergyState(connection, userID, nextState);
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
         ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            price = VALUES(price),
            type = VALUES(type),
            effect_value = VALUES(effect_value),
            uses = VALUES(uses),
            stackable = VALUES(stackable),
            description = VALUES(description)`,
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
