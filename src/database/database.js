const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '../../runtime/social_engine.sqlite');

class Database {
    constructor() {
        this.db = null;
    }

    init() {
        return new Promise((resolve, reject) => {
            const dir = path.dirname(DB_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            this.db = new sqlite3.Database(DB_PATH, (err) => {
                if (err) {
                    return reject(err);
                }
                // Enable Foreign Keys & WAL mode for speed
                this.db.run('PRAGMA foreign_keys = ON;');
                this.db.run('PRAGMA journal_mode = WAL;', () => {
                    this.loadSchema()
                        .then(resolve)
                        .catch(reject);
                });
            });
        });
    }

    loadSchema() {
        return new Promise((resolve, reject) => {
            const schemaPath = path.join(__dirname, 'schema/schema.sql');
            if (!fs.existsSync(schemaPath)) {
                return resolve();
            }
            const sql = fs.readFileSync(schemaPath, 'utf8');
            this.db.exec(sql, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err) return reject(err);
                resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    }

    exec(sql) {
        return new Promise((resolve, reject) => {
            this.db.exec(sql, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    async beginTransaction() {
        await this.exec('BEGIN TRANSACTION;');
    }

    async commitTransaction() {
        await this.exec('COMMIT;');
    }

    async rollbackTransaction() {
        await this.exec('ROLLBACK;');
    }

    close() {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve();
            this.db.close((err) => {
                if (err) return reject(err);
                this.db = null;
                resolve();
            });
        });
    }
}

const dbInstance = new Database();
module.exports = dbInstance;
