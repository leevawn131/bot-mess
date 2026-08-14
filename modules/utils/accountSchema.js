const { execute } = require("./database");

let schemaReady = false;
let schemaPromise = null;

async function ensureAccountClusterSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    // Bảng lưu mapping giữa Profile trình duyệt, UID tài khoản Facebook và Cụm
    await execute(`
      CREATE TABLE IF NOT EXISTS profile_accounts (
        profile_name VARCHAR(50) PRIMARY KEY,
        uid VARCHAR(50) NULL,
        account_name TEXT NULL,
        cluster_id INT DEFAULT 1,
        status VARCHAR(20) DEFAULT 'active',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Bảng lưu gắn kết cố định giữa Nhóm (thread_id), Cụm (cluster_id) và danh sách Profile được phép chạy
    await execute(`
      CREATE TABLE IF NOT EXISTS group_profile_bindings (
        thread_id VARCHAR(50) PRIMARY KEY,
        cluster_id INT DEFAULT 1,
        is_admin_rental TINYINT DEFAULT 0,
        assigned_profiles TEXT NOT NULL,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Bảng theo dõi các nhóm từng account hiện đang ở (Slot Tracker)
    await execute(`
      CREATE TABLE IF NOT EXISTS account_joined_groups (
        profile_name VARCHAR(50) NOT NULL DEFAULT 'Default',
        uid VARCHAR(50) NOT NULL,
        thread_id VARCHAR(50) NOT NULL,
        thread_name TEXT,
        is_admin_rental TINYINT DEFAULT 0,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (profile_name, thread_id)
      )
    `);

    const columnExists = async (tableName, columnName) => {
      try {
        const rows = await execute(`PRAGMA table_info(${tableName})`);
        return rows && rows.some(row => String(row.name).toLowerCase() === String(columnName).toLowerCase());
      } catch (e) {
        return false;
      }
    };

    if (!(await columnExists("account_joined_groups", "profile_name"))) {
      try {
        await execute(`ALTER TABLE account_joined_groups ADD COLUMN profile_name VARCHAR(50) DEFAULT 'Default'`);
      } catch (e) {}
    }

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

module.exports = { ensureAccountClusterSchema };
