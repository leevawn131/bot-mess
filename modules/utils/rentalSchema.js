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

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

module.exports = { ensureRentedGroupsSchema };