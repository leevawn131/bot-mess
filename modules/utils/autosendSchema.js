const { execute } = require("./database");

let schemaReady = false;
let schemaPromise = null;

async function ensureAutosendSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    // Tạo bảng autosend_jobs
    await execute(`
      CREATE TABLE IF NOT EXISTS autosend_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id VARCHAR(50) NOT NULL,
        time VARCHAR(10) NOT NULL,
        schedule_type VARCHAR(50) DEFAULT 'daily',
        message TEXT NULL,
        media_path TEXT NULL,
        last_sent VARCHAR(20) NULL,
        status INTEGER DEFAULT 1,
        created_by VARCHAR(50) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Kiểm tra xem bảng có cần cập nhật cột không (đề phòng thay đổi trong tương lai)
    const columnExists = async (columnName) => {
      const rows = await execute(`PRAGMA table_info(autosend_jobs)`);
      return rows && rows.some(row => String(row.name).toLowerCase() === String(columnName).toLowerCase());
    };

    // Đề phòng trường hợp đã tồn tại db cũ nhưng đổi từ days sang schedule_type
    if (!(await columnExists("schedule_type"))) {
      try {
        await execute(`
          ALTER TABLE autosend_jobs
          ADD COLUMN schedule_type VARCHAR(50) DEFAULT 'daily'
        `);
      } catch (e) {
        console.error("Lỗi thêm cột schedule_type vào autosend_jobs:", e.message);
      }
    }

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

module.exports = { ensureAutosendSchema };
