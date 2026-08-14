const { execute } = require("./database");

let schemaReady = false;
let schemaPromise = null;

async function ensureRentedGroupsSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await execute(`
      CREATE TABLE IF NOT EXISTS rented_groups (
        thread_id VARCHAR(50) PRIMARY KEY,
        expire_date TIMESTAMP NOT NULL,
        renter_id VARCHAR(50) NULL,
        rented_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const columnExists = async (columnName) => {
      const rows = await execute(`PRAGMA table_info(rented_groups)`);
      return rows && rows.some(row => String(row.name).toLowerCase() === String(columnName).toLowerCase());
    };

    if (!(await columnExists("renter_id"))) {
      await execute(`
        ALTER TABLE rented_groups
        ADD COLUMN renter_id VARCHAR(50) NULL
      `);
    }

    if (!(await columnExists("rented_at"))) {
      await execute(`
        ALTER TABLE rented_groups
        ADD COLUMN rented_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      `);
    }

    if (!(await columnExists("is_admin_rental"))) {
      await execute(`
        ALTER TABLE rented_groups
        ADD COLUMN is_admin_rental TINYINT DEFAULT 0
      `);
    }

    if (!(await columnExists("is_stopped"))) {
      await execute(`
        ALTER TABLE rented_groups
        ADD COLUMN is_stopped TINYINT DEFAULT 0
      `);
    }

    if (!(await columnExists("paused_remaining_ms"))) {
      await execute(`
        ALTER TABLE rented_groups
        ADD COLUMN paused_remaining_ms BIGINT DEFAULT 0
      `);
    }

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

let txSchemaReady = false;
let txSchemaPromise = null;

async function ensureTransactionsSchema() {
  if (txSchemaReady) return;
  if (txSchemaPromise) return txSchemaPromise;

  txSchemaPromise = (async () => {
    await execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_code TEXT NOT NULL,
        amount INTEGER NOT NULL,
        thread_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const columnExists = async (columnName) => {
      const rows = await execute(`PRAGMA table_info(transactions)`);
      return rows && rows.some(row => String(row.name).toLowerCase() === String(columnName).toLowerCase());
    };

    if (!(await columnExists("group_name"))) {
      await execute(`ALTER TABLE transactions ADD COLUMN group_name TEXT DEFAULT ''`);
    }

    if (!(await columnExists("plan_name"))) {
      await execute(`ALTER TABLE transactions ADD COLUMN plan_name TEXT DEFAULT ''`);
    }

    if (!(await columnExists("months"))) {
      await execute(`ALTER TABLE transactions ADD COLUMN months INTEGER DEFAULT 0`);
    }

    if (!(await columnExists("updated_at"))) {
      await execute(`ALTER TABLE transactions ADD COLUMN updated_at TEXT DEFAULT NULL`);
    }

    await execute(`
      UPDATE transactions
      SET status = 'cancelled', updated_at = datetime('now')
      WHERE status = 'pending' AND created_at <= datetime('now', '-15 minutes')
    `);

    txSchemaReady = true;
  })();

  try {
    await txSchemaPromise;
  } finally {
    txSchemaPromise = null;
  }
}

module.exports = { ensureRentedGroupsSchema, ensureTransactionsSchema };