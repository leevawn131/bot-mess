#!/usr/bin/env node

/**
 * System Health Check Script
 * Tests all optimized systems
 */

const { healthCheck, getPoolStats, initializePool } = require('./modules/utils/database');
const { getCache } = require('./modules/utils/cacheManager');
const { getRateLimitStatus } = require('./modules/utils/rateLimiter');
const { getLogger, info, warn, error } = require('./modules/utils/logger');
const { getDatabaseConfig, getCacheConfig, getSecurityConfig } = require('./modules/utils/envConfig');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function colorize(color, text) {
  return `${colors[color]}${text}${colors.reset}`;
}

function printHeader(title) {
  console.log('\n' + colorize('cyan', '='.repeat(60)));
  console.log(colorize('cyan', `  ${title}`));
  console.log(colorize('cyan', '='.repeat(60)));
}

function printSuccess(message) {
  console.log(colorize('green', `✅ ${message}`));
}

function printError(message) {
  console.log(colorize('red', `❌ ${message}`));
}

function printWarning(message) {
  console.log(colorize('yellow', `⚠️  ${message}`));
}

function printInfo(message) {
  console.log(colorize('blue', `ℹ️  ${message}`));
}

async function testEnvironmentConfig() {
  printHeader('Environment Configuration');

  try {
    const dbConfig = getDatabaseConfig();
    printSuccess('Database config loaded');
    printInfo(`  Host: ${dbConfig.host}`);
    printInfo(`  Database: ${dbConfig.database}`);
    printInfo(`  User: ${dbConfig.user}`);

    const cacheConfig = getCacheConfig();
    printSuccess('Cache config loaded');
    printInfo(`  Enabled: ${cacheConfig.enabled}`);
    printInfo(`  TTL: ${cacheConfig.ttlMs}ms`);
    printInfo(`  Max Size: ${cacheConfig.maxSize}`);

    const securityConfig = getSecurityConfig();
    printSuccess('Security config loaded');
    printInfo(`  Rate Limiting: ${securityConfig.rateLimitEnabled}`);
    printInfo(`  Max Requests: ${securityConfig.rateLimitMaxRequests}`);

    return true;
  } catch (err) {
    printError(`Environment config test failed: ${err.message}`);
    return false;
  }
}

async function testDatabase() {
  printHeader('Database System');

  try {
    printInfo('Initializing connection pool...');
    initializePool();

    printInfo('Testing database health...');
    const health = await healthCheck();

    if (health.healthy) {
      printSuccess('Database health check passed');
      printInfo(`  Message: ${health.message}`);
    } else {
      printError(`Database health check failed: ${health.message}`);
      return false;
    }

    printInfo('Getting pool statistics...');
    const stats = getPoolStats();
    printSuccess('Pool statistics retrieved');
    printInfo(`  Total Connections: ${stats.totalConnections}`);
    printInfo(`  Active Connections: ${stats.activeConnections}`);
    printInfo(`  Idle Connections: ${stats.idleConnections}`);

    // Test simple query
    printInfo('Testing simple query...');
    const { execute } = require('./modules/utils/database');
    const [result] = await execute('SELECT 1 as test, NOW() as current_time');
    if (result && result.test === 1) {
      printSuccess('Simple query test passed');
      printInfo(`  Current time: ${result.current_time}`);
    } else {
      printError('Simple query test failed');
      return false;
    }

    return true;
  } catch (err) {
    printError(`Database test failed: ${err.message}`);
    return false;
  }
}

async function testCache() {
  printHeader('Cache System');

  try {
    printInfo('Getting cache instance...');
    const cache = getCache();
    printSuccess('Cache instance created');

    printInfo('Testing cache set/get...');
    cache.set('test:key', 'test-value', 5000);
    const value = cache.get('test:key');

    if (value === 'test-value') {
      printSuccess('Cache set/get test passed');
    } else {
      printError('Cache set/get test failed');
      return false;
    }

    printInfo('Testing cache expiration...');
    await new Promise(resolve => setTimeout(resolve, 100));
    const stillExists = cache.has('test:key');
    if (stillExists) {
      printSuccess('Cache expiration test passed (key still exists)');
    } else {
      printWarning('Cache key expired too quickly');
    }

    printInfo('Getting cache statistics...');
    const stats = cache.getStats();
    printSuccess('Cache statistics retrieved');
    printInfo(`  Size: ${stats.size}/${stats.maxSize}`);
    printInfo(`  Hits: ${stats.hits}`);
    printInfo(`  Misses: ${stats.misses}`);
    printInfo(`  Hit Rate: ${stats.hitRate}`);
    printInfo(`  Enabled: ${stats.enabled}`);

    // Test cache-aside pattern
    printInfo('Testing cache-aside pattern...');
    let callCount = 0;
    const expensiveOperation = async () => {
      callCount++;
      return `result-${callCount}`;
    };

    const result1 = await cache.getOrSet('test:aside', expensiveOperation, 10000);
    const result2 = await cache.getOrSet('test:aside', expensiveOperation, 10000);

    if (result1 === result2 && callCount === 1) {
      printSuccess('Cache-aside pattern test passed');
      printInfo(`  Expensive operation called only once: ${callCount} time(s)`);
    } else {
      printError('Cache-aside pattern test failed');
      printInfo(`  Expensive operation called: ${callCount} time(s)`);
      return false;
    }

    return true;
  } catch (err) {
    printError(`Cache test failed: ${err.message}`);
    return false;
  }
}

async function testRateLimiter() {
  printHeader('Rate Limiting System');

  try {
    printInfo('Getting rate limiter status...');
    const status = getRateLimitStatus();
    printSuccess('Rate limiter status retrieved');
    printInfo(`  Active limiters: ${Object.keys(status).length}`);

    printInfo('Testing rate limiting...');
    const { checkRateLimit } = require('./modules/utils/rateLimiter');

    const testUserId = 'test-user-' + Date.now();

    // First request should succeed
    const result1 = await checkRateLimit(testUserId);
    if (result1.allowed) {
      printSuccess('First request allowed');
    } else {
      printError('First request blocked unexpectedly');
      return false;
    }

    // Second request should also succeed (within limits)
    const result2 = await checkRateLimit(testUserId);
    if (result2.allowed) {
      printSuccess('Second request allowed');
    } else {
      printWarning('Second request blocked (rate limit may be too strict)');
    }

    printInfo('Rate limiting test completed');
    return true;
  } catch (err) {
    printError(`Rate limiter test failed: ${err.message}`);
    return false;
  }
}

async function testLogger() {
  printHeader('Logging System');

  try {
    printInfo('Testing logger functions...');

    info('Test info message', { test: true });
    printSuccess('Info logging works');

    warn('Test warning message', { test: true });
    printSuccess('Warning logging works');

    error('Test error message', { test: true });
    printSuccess('Error logging works');

    printInfo('Testing specialized logging functions...');
    const { logCommand, logPerformance } = require('./modules/utils/logger');

    logCommand('test', 'user123', 'thread456', { param: 'value' });
    printSuccess('Command logging works');

    logPerformance('testOperation', 123, { context: 'test' });
    printSuccess('Performance logging works');

    printInfo('Check logs/ directory for log files');
    return true;
  } catch (err) {
    printError(`Logger test failed: ${err.message}`);
    return false;
  }
}

async function testSecureFileOps() {
  printHeader('Secure File Operations');

  try {
    printInfo('Testing secure file operations...');
    const { writeJsonFile, readJsonFile, fileExists } = require('./modules/utils/secureFileOps');

    const testFile = 'cache/test-secure-file.json';
    const testData = { test: true, timestamp: Date.now() };

    // Test write
    await writeJsonFile(testFile, testData);
    printSuccess('Secure file write works');

    // Test read
    const readData = await readJsonFile(testFile);
    if (readData && readData.test === true) {
      printSuccess('Secure file read works');
    } else {
      printError('Secure file read failed');
      return false;
    }

    // Test exists
    const exists = await fileExists(testFile);
    if (exists) {
      printSuccess('File existence check works');
    } else {
      printError('File existence check failed');
      return false;
    }

    // Cleanup
    const { deleteFile } = require('./modules/utils/secureFileOps');
    await deleteFile(testFile);
    printInfo('Test file cleaned up');

    return true;
  } catch (err) {
    printError(`Secure file ops test failed: ${err.message}`);
    return false;
  }
}

async function runAllTests() {
  console.log(colorize('cyan', '\n🚀 Messenger Bot - System Health Check\n'));

  const results = {
    environmentConfig: false,
    database: false,
    cache: false,
    rateLimiter: false,
    logger: false,
    secureFileOps: false
  };

  // Run all tests
  results.environmentConfig = await testEnvironmentConfig();
  results.database = await testDatabase();
  results.cache = await testCache();
  results.rateLimiter = await testRateLimiter();
  results.logger = await testLogger();
  results.secureFileOps = await testSecureFileOps();

  // Print summary
  printHeader('Test Summary');

  let passed = 0;
  let failed = 0;

  for (const [test, result] of Object.entries(results)) {
    if (result) {
      printSuccess(`${test}`);
      passed++;
    } else {
      printError(`${test}`);
      failed++;
    }
  }

  console.log('\n' + colorize('cyan', '='.repeat(60)));
  console.log(colorize('cyan', `  Total: ${passed + failed} tests`));
  console.log(colorize('green', `  Passed: ${passed} tests`));
  console.log(colorize('red', `  Failed: ${failed} tests`));
  console.log(colorize('cyan', '='.repeat(60)));

  if (failed === 0) {
    console.log('\n' + colorize('green', '🎉 All tests passed! System is ready for production.\n'));
    process.exit(0);
  } else {
    console.log('\n' + colorize('red', '⚠️  Some tests failed. Please check the errors above.\n'));
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(err => {
  printError(`Test suite failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});