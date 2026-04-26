const winston = require('winston');
const path = require('path');
const { getLoggingConfig } = require('./envConfig');

// Logger instance
let logger = null;

/**
 * Initialize logger
 */
function initializeLogger() {
    if (logger) {
        return logger;
    }

    const config = getLoggingConfig();

    // Create logs directory if it doesn't exist
    const logDir = path.dirname(config.filePath);
    require('fs').mkdirSync(logDir, { recursive: true });

    // Define log format
    const logFormat = winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    );

    // Define console format
    const consoleFormat = winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp, ...metadata }) => {
            let msg = `${timestamp} [${level}]: ${message}`;
            if (Object.keys(metadata).length > 0) {
                msg += ` ${JSON.stringify(metadata)}`;
            }
            return msg;
        })
    );

    // Create transports
    const transports = [
        // Console transport
        new winston.transports.Console({
            format: consoleFormat,
            level: config.level
        }),

        // File transport
        new winston.transports.File({
            filename: config.filePath,
            format: logFormat,
            level: config.level,
            maxsize: config.maxSize,
            maxFiles: config.maxFiles
        }),

        // Error file transport
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            format: logFormat,
            level: 'error',
            maxsize: config.maxSize,
            maxFiles: config.maxFiles
        })
    ];

    // Create logger
    logger = winston.createLogger({
        level: config.level,
        format: logFormat,
        transports,
        exitOnError: false
    });

    return logger;
}

/**
 * Get logger instance
 */
function getLogger() {
    if (!logger) {
        initializeLogger();
    }
    return logger;
}

/**
 * Log info message
 */
function info(message, metadata = {}) {
    const log = getLogger();
    log.info(message, metadata);
}

/**
 * Log warning message
 */
function warn(message, metadata = {}) {
    const log = getLogger();
    log.warn(message, metadata);
}

/**
 * Log error message
 */
function error(message, metadata = {}) {
    const log = getLogger();
    log.error(message, metadata);
}

/**
 * Log debug message
 */
function debug(message, metadata = {}) {
    const log = getLogger();
    log.debug(message, metadata);
}

/**
 * Log verbose message
 */
function verbose(message, metadata = {}) {
    const log = getLogger();
    log.verbose(message, metadata);
}

/**
 * Create child logger with additional metadata
 */
function childLogger(metadata = {}) {
    const log = getLogger();
    return log.child(metadata);
}

/**
 * Log command execution
 */
function logCommand(command, userId, threadId, metadata = {}) {
    info('Command executed', {
        command,
        userId,
        threadId,
        timestamp: new Date().toISOString(),
        ...metadata
    });
}

/**
 * Log error with context
 */
function logError(error, context = {}) {
    error('Error occurred', {
        message: error.message,
        stack: error.stack,
        ...context
    });
}

/**
 * Log API call
 */
function logApiCall(method, endpoint, metadata = {}) {
    info('API call', {
        method,
        endpoint,
        timestamp: new Date().toISOString(),
        ...metadata
    });
}

/**
 * Log database query
 */
function logDatabaseQuery(query, params = [], metadata = {}) {
    debug('Database query', {
        query: query.substring(0, 100), // Limit query length
        paramsCount: params.length,
        timestamp: new Date().toISOString(),
        ...metadata
    });
}

/**
 * Log performance metric
 */
function logPerformance(operation, durationMs, metadata = {}) {
    info('Performance metric', {
        operation,
        durationMs,
        timestamp: new Date().toISOString(),
        ...metadata
    });
}

/**
 * Close logger (flush logs)
 */
async function closeLogger() {
    if (logger) {
        await new Promise((resolve) => {
            logger.end(() => resolve());
        });
        logger = null;
    }
}

/**
 * Stream logger to HTTP response (for web interface)
 */
function logStream(options = {}) {
    const log = getLogger();

    return {
        write: (message) => {
            log.info(message.trim());
        }
    };
}

module.exports = {
    initializeLogger,
    getLogger,
    info,
    warn,
    error,
    debug,
    verbose,
    childLogger,
    logCommand,
    logError,
    logApiCall,
    logDatabaseQuery,
    logPerformance,
    closeLogger,
    logStream
};