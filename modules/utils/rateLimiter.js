const { RateLimiterMemory, RateLimiterRedis } = require('rate-limiter-flexible');
const { getSecurityConfig } = require('./envConfig');

// Rate limiters storage
const rateLimiters = new Map();

/**
 * Get or create rate limiter
 */
function getRateLimiter(options = {}) {
    const config = getSecurityConfig();
    const key = options.key || 'global';

    if (rateLimiters.has(key)) {
        return rateLimiters.get(key);
    }

    const limiterOptions = {
        points: options.points || config.rateLimitMaxRequests,
        duration: options.duration || config.rateLimitWindowMs, // in seconds
        blockDuration: options.blockDuration || 0, // Do not block by default
    };

    let limiter;

    // Use Redis if available (for distributed systems)
    if (options.redisClient) {
        limiter = new RateLimiterRedis({
            ...limiterOptions,
            storeClient: options.redisClient,
        });
    } else {
        // Use in-memory rate limiter
        limiter = new RateLimiterMemory(limiterOptions);
    }

    rateLimiters.set(key, limiter);
    return limiter;
}

/**
 * Check rate limit for a user
 */
async function checkRateLimit(identifier, options = {}) {
    if (!getSecurityConfig().rateLimitEnabled) {
        return { allowed: true, remainingPoints: Infinity };
    }

    try {
        const limiter = getRateLimiter(options);
        const result = await limiter.consume(identifier);

        return {
            allowed: true,
            remainingPoints: result.remainingPoints,
            msBeforeNext: result.msBeforeNext
        };
    } catch (rej) {
        // Rate limit exceeded
        return {
            allowed: false,
            remainingPoints: 0,
            msBeforeNext: rej.msBeforeNext || 0
        };
    }
}

/**
 * Check rate limit for a specific command
 */
async function checkCommandRateLimit(userId, commandName, options = {}) {
    const identifier = `${userId}:${commandName}`;
    return checkRateLimit(identifier, options);
}

/**
 * Check global rate limit for a user
 */
async function checkGlobalRateLimit(userId, options = {}) {
    return checkRateLimit(userId, options);
}

/**
 * Reset rate limit for a specific identifier
 */
async function resetRateLimit(identifier) {
    const limiter = rateLimiters.get(identifier);
    if (limiter) {
        await limiter.delete(identifier);
    }
}

/**
 * Get rate limit status
 */
function getRateLimitStatus() {
    const status = {};
    rateLimiters.forEach((limiter, key) => {
        status[key] = {
            type: limiter.constructor.name,
            // Add more stats if needed
        };
    });
    return status;
}

/**
 * Clear all rate limiters (useful for testing)
 */
function clearAllRateLimiters() {
    rateLimiters.clear();
}

/**
 * Middleware for rate limiting
 */
function rateLimitMiddleware(options = {}) {
    return async (req, res, next) => {
        const identifier = options.getKey ? options.getKey(req) : req.ip;

        try {
            const result = await checkRateLimit(identifier, options);

            if (!result.allowed) {
                return res.status(429).json({
                    error: 'Too many requests',
                    retryAfter: Math.ceil(result.msBeforeNext / 1000)
                });
            }

            // Add rate limit headers
            res.setHeader('X-RateLimit-Limit', options.points || getSecurityConfig().rateLimitMaxRequests);
            res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
            res.setHeader('X-RateLimit-Reset', new Date(Date.now() + result.msBeforeNext).toISOString());

            next();
        } catch (error) {
            console.error('Rate limiting error:', error);
            next(); // Continue on error
        }
    };
}

module.exports = {
    getRateLimiter,
    checkRateLimit,
    checkCommandRateLimit,
    checkGlobalRateLimit,
    resetRateLimit,
    getRateLimitStatus,
    clearAllRateLimiters,
    rateLimitMiddleware
};