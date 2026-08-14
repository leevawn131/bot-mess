const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, '../runtime/bot.db');

async function runMigration() {
  console.log('🚀 Đang bắt đầu quá trình nâng cấp CSDL lên mô hình Thế Giới Cô Lập (Thread-Isolated World)...');

  const db = new sqlite3.Database(DB_PATH);

  const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

  const allAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

  try {
    // 2. Nâng cấp messenger_users
    console.log('🔄 Đang chuyển đổi bảng messenger_users...');
    const usersCols = await allAsync("PRAGMA table_info(messenger_users)");
    const hasUsersThreadId = usersCols.some(c => c.name === 'thread_id');

    if (!hasUsersThreadId) {
      await runAsync(`
        CREATE TABLE IF NOT EXISTS messenger_users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT NOT NULL DEFAULT 'global',
          psid TEXT NOT NULL,
          name TEXT,
          credits INTEGER DEFAULT 10000,
          last_checkin TEXT,
          vip_until TEXT,
          games_played INTEGER DEFAULT 0,
          energy INTEGER DEFAULT 100,
          max_energy INTEGER DEFAULT 100,
          last_energy_update TEXT DEFAULT CURRENT_TIMESTAMP,
          last_energy_update_unix INTEGER,
          UNIQUE(thread_id, psid)
        )
      `);

      await runAsync(`
        INSERT OR IGNORE INTO messenger_users_new (psid, name, credits, last_checkin, vip_until, games_played, energy, max_energy, last_energy_update, last_energy_update_unix, thread_id)
        SELECT psid, name, credits, last_checkin, vip_until, games_played, energy, max_energy, last_energy_update, last_energy_update_unix, 'global'
        FROM messenger_users
      `);

      await runAsync(`DROP TABLE messenger_users`);
      await runAsync(`ALTER TABLE messenger_users_new RENAME TO messenger_users`);
    }

    // 3. Nâng cấp user_inventory
    console.log('🔄 Đang chuyển đổi bảng user_inventory...');
    const invCols = await allAsync("PRAGMA table_info(user_inventory)");
    const hasInvThreadId = invCols.some(c => c.name === 'thread_id');

    if (!hasInvThreadId) {
      await runAsync(`
        CREATE TABLE IF NOT EXISTS user_inventory_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT NOT NULL DEFAULT 'global',
          psid TEXT NOT NULL,
          item_key TEXT NOT NULL,
          uses_left INTEGER DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(thread_id, psid, item_key)
        )
      `);

      await runAsync(`
        INSERT OR IGNORE INTO user_inventory_new (psid, item_key, uses_left, created_at, thread_id)
        SELECT psid, item_key, uses_left, created_at, 'global'
        FROM user_inventory
      `);

      await runAsync(`DROP TABLE user_inventory`);
      await runAsync(`ALTER TABLE user_inventory_new RENAME TO user_inventory`);
    }

    // 4. Nâng cấp bank_accounts
    console.log('🔄 Đang chuyển đổi bảng bank_accounts...');
    const bankCols = await allAsync("PRAGMA table_info(bank_accounts)");
    const hasBankThreadId = bankCols.some(c => c.name === 'thread_id');

    if (!hasBankThreadId) {
      await runAsync(`
        CREATE TABLE IF NOT EXISTS bank_accounts_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT NOT NULL DEFAULT 'global',
          psid TEXT NOT NULL,
          balance INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(thread_id, psid)
        )
      `);

      await runAsync(`
        INSERT OR IGNORE INTO bank_accounts_new (psid, balance, thread_id)
        SELECT psid, balance, 'global'
        FROM bank_accounts
      `);

      await runAsync(`DROP TABLE bank_accounts`);
      await runAsync(`ALTER TABLE bank_accounts_new RENAME TO bank_accounts`);
    }

    // 5. Nâng cấp bank_loans
    console.log('🔄 Đang chuyển đổi bảng bank_loans...');
    const loanCols = await allAsync("PRAGMA table_info(bank_loans)");
    const hasLoanThreadId = loanCols.some(c => c.name === 'thread_id');
    if (!hasLoanThreadId) {
      await runAsync(`ALTER TABLE bank_loans ADD COLUMN thread_id TEXT DEFAULT 'global'`);
    }

    // 6. Nâng cấp user_jail
    console.log('🔄 Đang chuyển đổi bảng user_jail...');
    const jailCols = await allAsync("PRAGMA table_info(user_jail)");
    const hasJailThreadId = jailCols.some(c => c.name === 'thread_id');

    if (!hasJailThreadId) {
      await runAsync(`
        CREATE TABLE IF NOT EXISTS user_jail_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT NOT NULL DEFAULT 'global',
          psid TEXT NOT NULL,
          jail_until TEXT,
          reason TEXT,
          jailed_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(thread_id, psid)
        )
      `);

      await runAsync(`
        INSERT OR IGNORE INTO user_jail_new (psid, jail_until, reason, thread_id)
        SELECT psid, jail_until, reason, 'global'
        FROM user_jail
      `);

      await runAsync(`DROP TABLE user_jail`);
      await runAsync(`ALTER TABLE user_jail_new RENAME TO user_jail`);
    }

    // 7. Nâng cấp quest_user_daily
    console.log('🔄 Đang chuyển đổi bảng quest_user_daily...');
    const questCols = await allAsync("PRAGMA table_info(quest_user_daily)");
    const hasQuestThreadId = questCols.some(c => c.name === 'thread_id');
    if (!hasQuestThreadId) {
      await runAsync(`ALTER TABLE quest_user_daily ADD COLUMN thread_id TEXT DEFAULT 'global'`);
    }

    console.log('✅ Nâng cấp CSDL lên mô hình Thế Giới Cô Lập (Thread-Isolated World) THÀNH CÔNG!');
  } catch (err) {
    console.error('❌ Lỗi khi nâng cấp CSDL:', err);
  } finally {
    db.close();
  }
}

runMigration();
