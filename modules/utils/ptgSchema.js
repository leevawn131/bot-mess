const { execute } = require("./database");

let schemaReady = false;
let schemaPromise = null;

/**
 * Đảm bảo các bảng SQLite của Play Together được tạo trong /runtime/bot.db
 */
async function ensurePTGSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    // 1. Bảng quản lý ID tài khoản Play Together
    await execute(`
      CREATE TABLE IF NOT EXISTS ptg_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id VARCHAR(50) NOT NULL,
        ptg_id VARCHAR(100) NOT NULL,
        nickname VARCHAR(100) NULL,
        server VARCHAR(20) DEFAULT 'vng',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, ptg_id)
      )
    `);

    // 2. Bảng lưu trữ Giftcode Play Together
    await execute(`
      CREATE TABLE IF NOT EXISTS ptg_giftcodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code VARCHAR(100) UNIQUE NOT NULL,
        description TEXT NULL,
        status VARCHAR(20) DEFAULT 'active',
        expires_at VARCHAR(50) NULL,
        source VARCHAR(100) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Bảng cấu hình thông báo tự động theo từng Thread / Box Chat
    await execute(`
      CREATE TABLE IF NOT EXISTS ptg_settings (
        thread_id VARCHAR(50) PRIMARY KEY,
        notify_weather INTEGER DEFAULT 0,
        notify_seeds INTEGER DEFAULT 0,
        notify_nongcu INTEGER DEFAULT 0,
        notify_code INTEGER DEFAULT 1,
        auto_redeem INTEGER DEFAULT 1,
        last_weather_sent VARCHAR(50) NULL,
        last_seeds_sent VARCHAR(50) NULL,
        last_nongcu_sent VARCHAR(50) NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Bảng lịch sử nhập code cho từng tài khoản
    await execute(`
      CREATE TABLE IF NOT EXISTS ptg_redeem_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ptg_id VARCHAR(100) NOT NULL,
        code VARCHAR(100) NOT NULL,
        status VARCHAR(50) DEFAULT 'success',
        redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ptg_id, code)
      )
    `);

    // 5. Bảng lưu trữ dữ liệu Shop Hạt Giống & Nông Cụ thật theo thời gian thực
    await execute(`
      CREATE TABLE IF NOT EXISTS ptg_shop_cache (
        shop_type VARCHAR(50) PRIMARY KEY,
        content TEXT NOT NULL,
        items_json TEXT NULL,
        reporter VARCHAR(100) DEFAULT 'System',
        source VARCHAR(100) DEFAULT 'manual',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Kiểm tra và bổ sung cột nếu bảng đã tồn tại từ trước
    const checkAndAddColumn = async (table, column, typeDef) => {
      try {
        const rows = await execute(`PRAGMA table_info(${table})`);
        const exists = Array.isArray(rows) && rows.some(r => String(r.name).toLowerCase() === String(column).toLowerCase());
        if (!exists) {
          await execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
        }
      } catch (e) {
        console.error(`[PTG Schema] Lỗi thêm cột ${column} vào ${table}:`, e.message);
      }
    };

    await checkAndAddColumn("ptg_settings", "notify_weather", "INTEGER DEFAULT 0");
    await checkAndAddColumn("ptg_settings", "notify_seeds", "INTEGER DEFAULT 0");
    await checkAndAddColumn("ptg_settings", "notify_nongcu", "INTEGER DEFAULT 0");
    await checkAndAddColumn("ptg_settings", "notify_code", "INTEGER DEFAULT 1");
    await checkAndAddColumn("ptg_settings", "auto_redeem", "INTEGER DEFAULT 1");
    await checkAndAddColumn("ptg_settings", "last_weather_sent", "VARCHAR(50) NULL");
    await checkAndAddColumn("ptg_settings", "last_seeds_sent", "VARCHAR(50) NULL");
    await checkAndAddColumn("ptg_settings", "last_nongcu_sent", "VARCHAR(50) NULL");



    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

module.exports = { ensurePTGSchema };
