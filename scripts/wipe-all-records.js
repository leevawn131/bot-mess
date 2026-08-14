const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, '../runtime/bot.db');

async function wipeAllRecords() {
  console.log('🧹 Đang bắt đầu xóa sạch toàn bộ bản ghi dữ liệu (Wipe All Records)...');

  const db = new sqlite3.Database(DB_PATH);

  const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

  try {
    const tablesToWipe = [
      'messenger_users',
      'user_inventory',
      'user_caught_fish',
      'bank_accounts',
      'bank_loans',
      'user_jail',
      'quest_user_daily',
      'active_effects',
      'transactions'
    ];

    for (const table of tablesToWipe) {
      try {
        await runAsync(`DELETE FROM \`${table}\``);
        console.log(`✅ Đã xóa sạch dữ liệu bảng: ${table}`);
      } catch (err) {
        // Bảng không tồn tại thì bỏ qua
      }
    }

    // Reset autoincrement sequence
    try {
      await runAsync(`DELETE FROM sqlite_sequence`);
      console.log('✅ Đã reset các chuỗi ID tự động tăng (autoincrement).');
    } catch (_) {}

    console.log('🎉 XÓA SẠCH TOÀN BỘ BẢN GHI THÀNH CÔNG! Tất cả các thế giới sẽ khởi đầu lại từ đầu.');
  } catch (err) {
    console.error('❌ Lỗi khi xóa bản ghi:', err);
  } finally {
    db.close();
  }
}

wipeAllRecords();
