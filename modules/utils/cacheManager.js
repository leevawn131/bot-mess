const { getCacheConfig } = require('./envConfig');
const { debug, warn } = require('./logger');

/**
 * Cache entry with metadata
 */
class CacheEntry {
    constructor(value, ttlMs) {
        this.value = value;
        this.createdAt = Date.now();
        this.expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null;
        this.hits = 0;
        this.misses = 0;
    }

    isExpired() {
        return this.expiresAt !== null && Date.now() > this.expiresAt;
    }

    hit() {
        this.hits++;
    }

    miss() {
        this.misses++;
    }

    getAge() {
        return Date.now() - this.createdAt;
    }

    getTTL() {
        if (this.expiresAt === null) return null;
        return Math.max(0, this.expiresAt - Date.now());
    }
}

/**
 * Cache manager with TTL and size limits
 */
class CacheManager {
    constructor(options = {}) {
        const config = getCacheConfig();

        this.enabled = options.enabled !== undefined ? options.enabled : config.enabled;
        this.defaultTTL = options.ttlMs || config.ttlMs;
        this.maxSize = options.maxSize || config.maxSize;
        this.cache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            evictions: 0
        };
    }

    /**
     * Generate cache key
     */
    generateKey(...parts) {
        return parts.filter(Boolean).join(':');
    }

    /**
     * Set value in cache
     */
    set(key, value, ttlMs = this.defaultTTL) {
        if (!this.enabled) return false;

        try {
            // Check if we need to evict entries
            if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
                this.evictOldest();
            }

            const entry = new CacheEntry(value, ttlMs);
            this.cache.set(key, entry);
            this.stats.sets++;

            debug('Cache set', { key, ttlMs, size: this.cache.size });
            return true;
        } catch (error) {
            warn('Cache set error', { key, error: error.message });
            return false;
        }
    }

    /**
     * Get value from cache
     */
    get(key) {
        if (!this.enabled) return null;

        try {
            const entry = this.cache.get(key);

            if (!entry) {
                this.stats.misses++;
                if (entry) entry.miss();
                return null;
            }

            // Check if expired
            if (entry.isExpired()) {
                this.delete(key);
                this.stats.misses++;
                return null;
            }

            entry.hit();
            this.stats.hits++;
            debug('Cache hit', { key, age: entry.getAge(), ttl: entry.getTTL() });
            return entry.value;
        } catch (error) {
            warn('Cache get error', { key, error: error.message });
            return null;
        }
    }

    /**
     * Check if key exists and is not expired
     */
    has(key) {
        if (!this.enabled) return false;

        const entry = this.cache.get(key);
        if (!entry) return false;

        if (entry.isExpired()) {
            this.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Delete value from cache
     */
    delete(key) {
        if (!this.enabled) return false;

        const deleted = this.cache.delete(key);
        if (deleted) {
            this.stats.deletes++;
            debug('Cache delete', { key });
        }
        return deleted;
    }

    /**
     * Clear all cache entries
     */
    clear() {
        if (!this.enabled) return;

        const size = this.cache.size;
        this.cache.clear();
        debug('Cache cleared', { size });
    }

    /**
     * Evict oldest entry
     */
    evictOldest() {
        let oldestKey = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.createdAt < oldestTime) {
                oldestTime = entry.createdAt;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.delete(oldestKey);
            this.stats.evictions++;
            debug('Cache eviction', { key: oldestKey });
        }
    }

    /**
     * Evict expired entries
     */
    evictExpired() {
        let evicted = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.isExpired()) {
                this.delete(key);
                evicted++;
            }
        }

        if (evicted > 0) {
            debug('Cache expired entries evicted', { count: evicted });
        }

        return evicted;
    }

    /**
     * Get or set value (cache-aside pattern)
     */
    async getOrSet(key, factory, ttlMs = this.defaultTTL) {
        const cached = this.get(key);
        if (cached !== null) {
            return cached;
        }

        const value = await factory();
        this.set(key, value, ttlMs);
        return value;
    }

    /**
     * Get multiple values
     */
    getMultiple(keys) {
        const results = {};
        for (const key of keys) {
            results[key] = this.get(key);
        }
        return results;
    }

    /**
     * Set multiple values
     */
    setMultiple(entries, ttlMs = this.defaultTTL) {
        let success = 0;
        for (const [key, value] of Object.entries(entries)) {
            if (this.set(key, value, ttlMs)) {
                success++;
            }
        }
        return success;
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0
            ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
            : 0;

        return {
            ...this.stats,
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: hitRate.toFixed(2) + '%',
            enabled: this.enabled
        };
    }

    /**
     * Get cache entry information
     */
    getEntryInfo(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;

        return {
            key,
            hasValue: true,
            isExpired: entry.isExpired(),
            age: entry.getAge(),
            ttl: entry.getTTL(),
            hits: entry.hits,
            misses: entry.misses
        };
    }

    /**
     * Get all cache keys
     */
    keys() {
        return Array.from(this.cache.keys());
    }

    /**
     * Get cache size
     */
    size() {
        return this.cache.size;
    }

    /**
     * Cleanup expired entries periodically
     */
    startCleanup(intervalMs = 60000) {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.cleanupInterval = setInterval(() => {
            this.evictExpired();
        }, intervalMs);

        debug('Cache cleanup started', { intervalMs });
    }

    /**
     * Stop cleanup interval
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            debug('Cache cleanup stopped');
        }
    }

    /**
     * Destroy cache manager
     */
    destroy() {
        this.stopCleanup();
        this.clear();
    }
}

// Global cache instance
let globalCache = null;

/**
 * Get global cache instance
 */
function getCache(options = {}) {
    if (!globalCache) {
        globalCache = new CacheManager(options);
        globalCache.startCleanup();
    }
    return globalCache;
}

/**
 * Reset global cache
 */
function resetCache() {
    if (globalCache) {
        globalCache.destroy();
        globalCache = null;
    }
}

module.exports = {
    CacheManager,
    CacheEntry,
    getCache,
    resetCache
};