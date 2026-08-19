let bankSchemaReady = false;

async function ensureBankSchema(connection) {
    if (bankSchemaReady) return;
    try {
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS bank_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id TEXT NOT NULL DEFAULT 'global',
                psid TEXT NOT NULL,
                balance INTEGER DEFAULT 0,
                last_bank_check TEXT,
                last_deposit TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS bank_pool (
                id INTEGER PRIMARY KEY DEFAULT 1,
                total_balance INTEGER NOT NULL DEFAULT 0
            )
        `);

        const [cols] = await connection.execute('PRAGMA table_info(bank_accounts)');
        const colNames = Array.isArray(cols) ? cols.map(c => String(c.name).toLowerCase()) : [];
        if (!colNames.includes('last_bank_check')) {
            await connection.execute('ALTER TABLE bank_accounts ADD COLUMN last_bank_check TEXT');
        }
        if (!colNames.includes('last_deposit')) {
            await connection.execute('ALTER TABLE bank_accounts ADD COLUMN last_deposit TEXT');
        }

        bankSchemaReady = true;
    } catch (e) {
        // Ignored if already existing
    }
}

async function syncBankPool(connection) {
    await ensureBankSchema(connection);

    const [sumRows] = await connection.execute(
        'SELECT COALESCE(SUM(balance), 0) AS total FROM bank_accounts'
    );

    const totalBalance = parseInt(sumRows[0]?.total, 10) || 0;

    await connection.execute(
        'INSERT INTO bank_pool (id, total_balance) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET total_balance = excluded.total_balance',
        [totalBalance]
    );

    return totalBalance;
}

module.exports = { syncBankPool, ensureBankSchema };
