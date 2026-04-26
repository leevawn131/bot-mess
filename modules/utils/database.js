const mysql = require('mysql2/promise');
const { getConnectionPoolConfig } = require('./envConfig');

// Connection pool instance
let pool = null;

/**
 * Initialize database connection pool
 */
function initializePool() {
    if (pool) {
        return pool;
    }

    const config = getConnectionPoolConfig();

    pool = mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: config.max,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
    });

    // Handle pool errors
    pool.on('connection', (connection) => {
        console.log('New database connection established');
    });

    pool.on('error', (err) => {
        console.error('Database pool error:', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            console.error('Database connection was closed.');
        }
    });

    return pool;
}

/**
 * Get connection from pool
 */
async function getConnection() {
    if (!pool) {
        initializePool();
    }

    try {
        const connection = await pool.getConnection();
        return connection;
    } catch (error) {
        console.error('Error getting database connection:', error);
        throw error;
    }
}

/**
 * Execute query with automatic connection management
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
        await connection.beginTransaction();

        const results = [];
        for (const { query, params } of queries) {
            const [result] = await connection.execute(query, params);
            results.push(result);
        }

        await connection.commit();
        return results;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Close connection pool
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('Database connection pool closed');
    }
}

/**
 * Get pool statistics
 */
function getPoolStats() {
    if (!pool) {
        return {
            activeConnections: 0,
            idleConnections: 0,
            totalConnections: 0
        };
    }

    return {
        activeConnections: pool.pool._allConnections.length - pool.pool._freeConnections.length,
        idleConnections: pool.pool._freeConnections.length,
        totalConnections: pool.pool._allConnections.length
    };
}

/**
 * Health check for database
 */
async function healthCheck() {
    try {
        const connection = await getConnection();
        await connection.ping();
        connection.release();
        return { healthy: true, message: 'Database connection is healthy' };
    } catch (error) {
        return { healthy: false, message: `Database health check failed: ${error.message}` };
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