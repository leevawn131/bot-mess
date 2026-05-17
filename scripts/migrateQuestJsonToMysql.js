const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const configPath = path.resolve(__dirname, "../config.json");
const questJsonPath = path.resolve(__dirname, "../cache/quest_data.json");

function loadConfig() {
    if (!fs.existsSync(configPath)) throw new Error("Không tìm thấy config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const db = config?.database;
    if (!db) throw new Error("Thiếu cấu hình database trong config.json");
    return {
        host: db.host,
        port: db.port,
        user: db.user,
        password: db.password,
        database: db.name
    };
}

function parseQuestJson() {
    if (!fs.existsSync(questJsonPath)) {
        console.log("Không có file cache/quest_data.json, bỏ qua migrate.");
        return {};
    }

    try {
        const raw = fs.readFileSync(questJsonPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        return parsed;
    } catch (error) {
        throw new Error(`Không đọc được quest_data.json: ${error.message}`);
    }
}

async function ensureTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS quest_user_daily (
            psid VARCHAR(50) NOT NULL,
            quest_date DATE NOT NULL,
            quest_id VARCHAR(64) NOT NULL,
            progress BIGINT NOT NULL DEFAULT 0,
            accepted TINYINT(1) NOT NULL DEFAULT 0,
            claimed TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (psid, quest_date, quest_id),
            KEY idx_quest_user_date (psid, quest_date),
            KEY idx_quest_date (quest_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
}

function normalizeDate(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

async function migrate() {
    const dbConfig = loadConfig();
    const data = parseQuestJson();

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await ensureTable(connection);

        await connection.beginTransaction();

        let userCount = 0;
        let rowCount = 0;

        for (const [psid, userState] of Object.entries(data)) {
            const questDate = normalizeDate(userState?.date);
            const quests = Array.isArray(userState?.quests) ? userState.quests : [];
            if (!questDate || quests.length === 0) continue;

            userCount += 1;

            for (const quest of quests) {
                const questID = String(quest?.id || "").trim();
                if (!questID) continue;

                const progress = Math.max(0, Number(quest?.progress) || 0);
                const accepted = quest?.accepted ? 1 : 0;
                const claimed = quest?.claimed ? 1 : 0;

                await connection.execute(
                    `INSERT INTO quest_user_daily (psid, quest_date, quest_id, progress, accepted, claimed)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        progress = GREATEST(progress, VALUES(progress)),
                        accepted = GREATEST(accepted, VALUES(accepted)),
                        claimed = GREATEST(claimed, VALUES(claimed))`,
                    [String(psid), questDate, questID, progress, accepted, claimed]
                );
                rowCount += 1;
            }
        }

        await connection.commit();
        console.log(`Migrate hoàn tất: ${userCount} user, ${rowCount} quest rows.`);
    } catch (error) {
        if (connection) {
            try { await connection.rollback(); } catch (_) {}
        }
        throw error;
    } finally {
        if (connection) await connection.end();
    }
}

migrate().catch((error) => {
    console.error("Migrate thất bại:", error.message);
    process.exit(1);
});
