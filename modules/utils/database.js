const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'runtime', 'bot.db');

// Ensure parent directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

let db = null;

/**
 * Initialize SQLite database connection
 */
function initializePool() {
    if (db) {
        return db;
    }

    db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            console.error('❌ Failed to open SQLite database:', err.message);
        } else {
            console.log('✅ SQLite database connected at:', DB_PATH);
            // Optimization for SQLite performance
            db.run('PRAGMA journal_mode=WAL;');
            db.run('PRAGMA foreign_keys=ON;');
        }
    });

    return db;
}

/**
 * Get mock connection from pool to maintain compatibility with mysql2 structure
 */
async function getConnection() {
    if (!db) {
        initializePool();
    }

    return {
        execute: async (query, params = []) => {
            return new Promise((resolve, reject) => {
                const isReadQuery = /^\s*(SELECT|PRAGMA|SHOW|EXPLAIN|WITH)\b/i.test(query);
                if (isReadQuery) {
                    db.all(query, params, (err, rows) => {
                        if (err) return reject(err);
                        resolve([rows]);
                    });
                } else {
                    db.run(query, params, function (err) {
                        if (err) return reject(err);
                        resolve([{
                            affectedRows: this.changes,
                            insertId: this.lastID,
                            lastID: this.lastID,
                            changes: this.changes
                        }]);
                    });
                }
            });
        },
        beginTransaction: async () => {
            return new Promise((resolve, reject) => {
                db.run('BEGIN TRANSACTION', (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        },
        commit: async () => {
            return new Promise((resolve, reject) => {
                db.run('COMMIT', (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        },
        rollback: async () => {
            return new Promise((resolve, reject) => {
                db.run('ROLLBACK', (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        },
        ping: async () => {
            return new Promise((resolve, reject) => {
                db.get('SELECT 1', (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        },
        release: () => {} // No-op for SQLite
    };
}

/**
 * Execute query with automatic connection simulation
 */
async function execute(query, params = []) {
    const connection = await getConnection();
    try {
        const [results] = await connection.execute(query, params);
        return results;
    } finally {
        connection.release();
    }
}

/**
 * Execute multiple queries in a transaction
 */
async function executeTransaction(queries) {
    const connection = await getConnection();
    try {
        await connection.execute('BEGIN TRANSACTION');

        const results = [];
        for (const { query, params } of queries) {
            const [result] = await connection.execute(query, params);
            results.push(result);
        }

        await connection.execute('COMMIT');
        return results;
    } catch (error) {
        await connection.execute('ROLLBACK');
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Close connection pool
 */
async function closePool() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    console.error('Error closing SQLite database:', err);
                    return reject(err);
                }
                db = null;
                console.log('SQLite database connection closed');
                resolve();
            });
        } else {
            resolve();
        }
    });
}

/**
 * Get pool statistics (mocked for compatibility)
 */
function getPoolStats() {
    return {
        activeConnections: db ? 1 : 0,
        idleConnections: 0,
        totalConnections: db ? 1 : 0
    };
}

/**
 * Health check for database
 */
async function healthCheck() {
    try {
        const connection = await getConnection();
        await connection.ping();
        return { healthy: true, message: 'SQLite database connection is healthy' };
    } catch (error) {
        return { healthy: false, message: `SQLite health check failed: ${error.message}` };
    }
}

module.exports = {
    initializePool,
    getConnection,
    execute,
    executeTransaction,
    closePool,
    getPoolStats,
    healthCheck
};