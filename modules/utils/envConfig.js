require('dotenv').config();

/**
 * Load environment variable with fallback
 */
function getEnv(key, fallback = null) {
    return process.env[key] || fallback;
}

/**
 * Parse boolean environment variable
 */
function getBoolEnv(key, fallback = false) {
    const value = process.env[key];
    if (value === undefined || value === null) return fallback;
    return value === 'true' || value === '1' || value === 'yes';
}

/**
 * Parse number environment variable
 */
function getNumberEnv(key, fallback = 0) {
    const value = process.env[key];
    if (value === undefined || value === null) return fallback;
    const num = parseInt(value, 10);
    return isNaN(num) ? fallback : num;
}

/**
 * Parse array environment variable (comma separated)
 */
function getArrayEnv(key, fallback = []) {
    const value = process.env[key];
    if (!value) return fallback;
    return value.split(',').map(item => item.trim()).filter(Boolean);
}

/**
 * Load database configuration
 */
function getDatabaseConfig() {
    return {
        host: getEnv('DB_HOST', 'localhost'),
        port: getNumberEnv('DB_PORT', 3306),
        user: getEnv('DB_USER', 'bot'),
        password: getEnv('DB_PASSWORD', '123456'),
        database: getEnv('DB_NAME', 'goatbot')
    };
}

/**
 * Load bot configuration
 */
function getBotConfig() {
    return {
        prefix: getEnv('BOT_PREFIX', '!'),
        botName: getEnv('BOT_NAME', 'DarkWin'),
        language: getEnv('BOT_LANGUAGE', 'vi'),
        adminIDs: getArrayEnv('ADMIN_IDS', ['100037351338722', '61578017290778'])
    };
}

/**
 * Load AI configuration
 */
function getAIConfig() {
    return {
        enabled: getBoolEnv('AI_ENABLED', true),
        autoReplyEnabled: getBoolEnv('AI_AUTO_REPLY_ENABLED', true),
        autoReplyOnlyGroups: getBoolEnv('AI_AUTO_REPLY_ONLY_GROUPS', false),
        ollamaHost: getEnv('AI_OLLAMA_HOST', 'http://127.0.0.1:11434'),
        model: getEnv('AI_OLLAMA_MODEL', 'llama3:latest'),
        replyLimit: getNumberEnv('AI_REPLY_LIMIT', 10),
        cooldownMs: getNumberEnv('AI_COOLDOWN_MS', 60000),
        historyTurns: getNumberEnv('AI_HISTORY_TURNS', 8),
        maxMemberHints: getNumberEnv('AI_MAX_MEMBER_HINTS', 5)
    };
}

/**
 * Load security configuration
 */
function getSecurityConfig() {
    return {
        rateLimitEnabled: getBoolEnv('RATE_LIMIT_ENABLED', true),
        rateLimitWindowMs: getNumberEnv('RATE_LIMIT_WINDOW_MS', 60000),
        rateLimitMaxRequests: getNumberEnv('RATE_LIMIT_MAX_REQUESTS', 100)
    };
}

/**
 * Load logging configuration
 */
function getLoggingConfig() {
    return {
        level: getEnv('LOG_LEVEL', 'info'),
        filePath: getEnv('LOG_FILE_PATH', 'logs/bot.log'),
        maxSize: getNumberEnv('LOG_MAX_SIZE', 10485760), // 10MB
        maxFiles: getNumberEnv('LOG_MAX_FILES', 5)
    };
}

/**
 * Load cache configuration
 */
function getCacheConfig() {
    return {
        enabled: getBoolEnv('CACHE_ENABLED', true),
        ttlMs: getNumberEnv('CACHE_TTL_MS', 120000), // 2 minutes
        maxSize: getNumberEnv('CACHE_MAX_SIZE', 1000)
    };
}

/**
 * Load connection pool configuration
 */
function getConnectionPoolConfig() {
    return {
        min: getNumberEnv('DB_POOL_MIN', 2),
        max: getNumberEnv('DB_POOL_MAX', 10),
        acquireTimeout: getNumberEnv('DB_POOL_ACQUIRE_TIMEOUT', 30000),
        idleTimeout: getNumberEnv('DB_POOL_IDLE_TIMEOUT', 60000)
    };
}

/**
 * Load all configuration
 */
function getAllConfig() {
    return {
        database: getDatabaseConfig(),
        bot: getBotConfig(),
        ai: getAIConfig(),
        security: getSecurityConfig(),
        logging: getLoggingConfig(),
        cache: getCacheConfig(),
        connectionPool: getConnectionPoolConfig()
    };
}

module.exports = {
    getEnv,
    getBoolEnv,
    getNumberEnv,
    getArrayEnv,
    getDatabaseConfig,
    getBotConfig,
    getAIConfig,
    getSecurityConfig,
    getLoggingConfig,
    getCacheConfig,
    getConnectionPoolConfig,
    getAllConfig
};