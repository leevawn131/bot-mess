#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3').verbose();

const configPath = path.resolve(__dirname, '../config.json');

function loadMySQLConfig() {
    try {
        require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
    } catch (e) {}

    if (process.env.DB_HOST) {
        return {
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT, 10) || 3306,
            user: process.env.DB_USER || 'bot',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'goatbot'
        };
    }

    if (!fs.existsSync(configPath)) {
        throw new Error('❌ Không tìm thấy config.json ở thư mục gốc');
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const db = config?.database;
    if (!db) {
        throw new Error('❌ Cấu hình database trong config.json bị thiếu');
    }
    return {
        host: db.host || 'localhost',
        port: db.port || 3306,
        user: db.user || 'bot',
        password: db.password || '',
        database: db.name || 'goatbot'
    };
}

async function main() {
    console.log('🔄 Bắt đầu tiến trình chuyển đổi MySQL sang SQLite...');
    let mysqlConfig;
    try {
        mysqlConfig = loadMySQLConfig();
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }

    const sqliteDbPath = path.resolve(__dirname, '../runtime/bot.db');
    const dir = path.dirname(sqliteDbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Nếu đã có file sqlite cũ, chúng ta sẽ backup lại
    if (fs.existsSync(sqliteDbPath)) {
        const backupPath = `${sqliteDbPath}.bak_${Date.now()}`;
        console.log(`📦 Đã phát hiện file bot.db cũ, đang sao lưu vào: ${backupPath}`);
        fs.copyFileSync(sqliteDbPath, backupPath);
        fs.unlinkSync(sqliteDbPath);
    }

    const sqliteDb = new sqlite3.Database(sqliteDbPath);
    let mysqlConn;

    try {
        console.log(`🔌 Kết nối tới MySQL: ${mysqlConfig.host}:${mysqlConfig.port} (${mysqlConfig.database})...`);
        mysqlConn = await mysql.createConnection(mysqlConfig);

        // Lấy danh sách toàn bộ các bảng trong MySQL
        const [tables] = await mysqlConn.execute('SHOW TABLES');
        const tableFieldName = `Tables_in_${mysqlConfig.database}`;
        const tableNames = tables.map(t => t[tableFieldName]);

        console.log(`📊 Tìm thấy ${tableNames.length} bảng cần di chuyển: ${tableNames.join(', ')}`);

        // Tối ưu hóa SQLite cho việc insert nhanh
        sqliteDb.serialize(() => {
            sqliteDb.run('PRAGMA journal_mode=WAL;');
            sqliteDb.run('PRAGMA synchronous=OFF;');
        });

        for (const tableName of tableNames) {
            console.log(`\n⏳ Đang di chuyển bảng: \`${tableName}\`...`);

            // 1. Lấy cấu trúc bảng từ MySQL
            const [columns] = await mysqlConn.execute(`DESCRIBE \`${tableName}\``);
            
            const pks = [];
            const colDefs = [];
            
            for (const col of columns) {
                const name = col.Field;
                const type = col.Type.toLowerCase();
                const isNull = col.Null === 'YES';
                const isPri = col.Key === 'PRI';
                const isAuto = col.Extra.includes('auto_increment');
                const defVal = col.Default;

                let sqliteType = 'TEXT';
                if (type.includes('int') || type.includes('bool') || type.includes('tinyint')) {
                    sqliteType = 'INTEGER';
                } else if (type.includes('double') || type.includes('float') || type.includes('decimal')) {
                    sqliteType = 'REAL';
                }

                let defClause = '';
                if (defVal !== null && defVal !== undefined) {
                    if (defVal === 'CURRENT_TIMESTAMP') {
                        defClause = ' DEFAULT CURRENT_TIMESTAMP';
                    } else {
                        defClause = ` DEFAULT '${defVal.replace(/'/g, "''")}'`;
                    }
                }

                let nullClause = isNull ? '' : ' NOT NULL';

                if (isPri) {
                    pks.push(`\`${name}\``);
                }

                if (isAuto) {
                    // SQLite autoincrement
                    colDefs.push(`\`${name}\` INTEGER PRIMARY KEY AUTOINCREMENT`);
                    pks.splice(pks.indexOf(`\`${name}\``), 1);
                } else {
                    colDefs.push(`\`${name}\` ${sqliteType}${nullClause}${defClause}`);
                }
            }

            if (pks.length > 0) {
                colDefs.push(`PRIMARY KEY (${pks.join(', ')})`);
            }

            const createQuery = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n  ${colDefs.join(',\n  ')}\n)`;
            
            // Tạo bảng bên SQLite
            await new Promise((resolve, reject) => {
                sqliteDb.run(createQuery, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            console.log(`   └─ ✅ Đã tạo cấu trúc bảng \`${tableName}\` bên SQLite`);

            // 2. Lấy toàn bộ dữ liệu từ MySQL để chèn vào SQLite
            const [rows] = await mysqlConn.execute(`SELECT * FROM \`${tableName}\``);
            
            if (rows.length === 0) {
                console.log('   └─ ℹ️ Bảng trống, không có dữ liệu cần sao chép.');
                continue;
            }

            const keys = Object.keys(rows[0]);
            const placeholders = keys.map(() => '?').join(', ');
            const insertQuery = `INSERT INTO \`${tableName}\` (${keys.map(k => `\`${k}\``).join(', ')}) VALUES (${placeholders})`;

            // Chạy trong 1 Transaction để đẩy tốc độ lên tối đa
            await new Promise((resolve, reject) => {
                sqliteDb.serialize(() => {
                    sqliteDb.run('BEGIN TRANSACTION');
                    
                    const stmt = sqliteDb.prepare(insertQuery, (err) => {
                        if (err) {
                            sqliteDb.run('ROLLBACK');
                            return reject(err);
                        }
                    });

                    let errOccurred = false;
                    for (const row of rows) {
                        const values = keys.map(k => {
                            // Chuyển đổi giá trị Boolean/DateTime nếu cần
                            const val = row[k];
                            if (val instanceof Date) {
                                return val.toISOString().slice(0, 19).replace('T', ' ');
                            }
                            return val;
                        });
                        
                        stmt.run(values, (err) => {
                            if (err) {
                                console.error(`❌ Lỗi insert dòng trong bảng ${tableName}:`, err.message);
                                errOccurred = true;
                            }
                        });
                    }

                    stmt.finalize((err) => {
                        if (err || errOccurred) {
                            sqliteDb.run('ROLLBACK');
                            reject(err || new Error('Có lỗi xảy ra khi ghi dữ liệu'));
                        } else {
                            sqliteDb.run('COMMIT');
                            resolve();
                        }
                    });
                });
            });

            console.log(`   └─ ✅ Đã sao chép thành công ${rows.length} dòng dữ liệu.`);
        }

        console.log('\n🎉 Hoàn thành chuyển đổi dữ liệu MySQL sang SQLite 100% thành công!');
        console.log(`📁 File database mới lưu tại: ${sqliteDbPath}`);

    } catch (err) {
        console.error('\n❌ LỖI TRONG QUÁ TRÌNH DI CHUYỂN DỮ LIỆU:', err);
    } finally {
        if (mysqlConn) {
            await mysqlConn.end();
        }
        sqliteDb.close();
    }
}

main();
