async function syncBankPool(connection) {
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

module.exports = { syncBankPool };
