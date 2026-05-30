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
      const rows = await execute(
        `
          SELECT COUNT(*) AS count
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'rented_groups'
            AND COLUMN_NAME = ?
        `,
        [columnName],
      );

      return rows && rows.length > 0 && Number(rows[0].count) > 0;
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

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

module.exports = { ensureRentedGroupsSchema };