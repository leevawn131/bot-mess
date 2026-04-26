# Hệ Thống Messenger Bot - Tài Liệu Tối Ưu Hóa

## 📋 Tổng Quan
Hệ thống đã được tối ưu hóa với các cải tiến về bảo mật, hiệu suất và chất lượng code.

## 🚀 Tính Năng Mới

### 1. Environment Variables
- **File**: `.env.example`
- **Mô đun**: `modules/utils/envConfig.js`
- **Tính năng**:
  - Quản lý cấu hình qua environment variables
  - Hỗ trợ các kiểu dữ liệu: string, number, boolean, array
  - Tăng cường bảo mật bằng cách không hardcode credentials

**Cách sử dụng**:
```bash
# Copy file example
cp .env.example .env

# Edit file .env với cấu hình của bạn
nano .env

# Các biến môi trường quan trọng:
DB_PASSWORD=your_secure_password
ADMIN_IDS=100037351338722,61578017290778
AI_ENABLED=true
RATE_LIMIT_ENABLED=true
```

### 2. Database Connection Pooling
- **File**: `modules/utils/database.js`
- **Tính năng**:
  - Connection pool thay vì individual connections
  - Tự động quản lý connections
  - Health check cho database
  - Statistics tracking

**Cách sử dụng**:
```javascript
const { getConnection, execute, executeTransaction } = require('./modules/utils/database');

// Simple query
const results = await execute('SELECT * FROM users WHERE id = ?', [userId]);

// Transaction
const results = await executeTransaction([
  { query: 'UPDATE accounts SET balance = balance - ? WHERE id = ?', params: [amount, fromId] },
  { query: 'UPDATE accounts SET balance = balance + ? WHERE id = ?', params: [amount, toId] }
]);

// Health check
const health = await healthCheck();
console.log(health); // { healthy: true, message: 'Database connection is healthy' }
```

### 3. Rate Limiting
- **File**: `modules/utils/rateLimiter.js`
- **Tính năng**:
  - Global rate limiting per user
  - Per-command rate limiting
  - Hỗ trợ Redis (optional)
  - Flexible configuration

**Cách sử dụng**:
```javascript
const { checkRateLimit, checkCommandRateLimit } = require('./modules/utils/rateLimiter');

// Check global rate limit
const result = await checkRateLimit(userId);
if (!result.allowed) {
  console.log(`Rate limited. Try again in ${result.msBeforeNext}ms`);
}

// Check command rate limit
const cmdResult = await checkCommandRateLimit(userId, 'transfer');
if (!cmdResult.allowed) {
  console.log(`Command rate limited. Try again in ${cmdResult.msBeforeNext}ms`);
}
```

### 4. Secure File Operations
- **File**: `modules/utils/secureFileOps.js`
- **Tính năng**:
  - Tự động set file permissions (0600 cho files, 0700 cho directories)
  - Async file operations
  - Atomic writes
  - Path validation

**Cách sử dụng**:
```javascript
const { readJsonFile, writeJsonFile, secureFileOps } = require('./modules/utils/secureFileOps');

// Read JSON file
const config = await readJsonFile('config.json', {});

// Write JSON file with secure permissions
await writeJsonFile('config.json', config);

// Use secure file operations
await secureFileOps.write('secret.txt', 'sensitive data', 0o600);
```

### 5. Logging System
- **File**: `modules/utils/logger.js`
- **Tính năng**:
  - Multi-level logging (info, warn, error, debug, verbose)
  - File rotation
  - Structured logging
  - Performance tracking

**Cách sử dụng**:
```javascript
const { info, warn, error, debug, logCommand, logError } = require('./modules/utils/logger');

// Basic logging
info('User logged in', { userId, username });
warn('High memory usage', { usage: '90%' });
error('Database connection failed', { error: err.message });

// Specialized logging
logCommand('transfer', userId, threadId, { amount, recipient });
logError(err, { context: 'payment processing' });
```

### 6. Cache Management
- **File**: `modules/utils/cacheManager.js`
- **Tính năng**:
  - TTL-based cache expiration
  - Size limits
  - Automatic cleanup
  - Cache statistics

**Cách sử dụng**:
```javascript
const { getCache } = require('./modules/utils/cacheManager');

const cache = getCache();

// Set value
cache.set('user:123', userData, 60000); // 60 seconds TTL

// Get value
const user = cache.get('user:123');

// Get or set (cache-aside pattern)
const data = await cache.getOrSet('expensive:operation', async () => {
  return await performExpensiveOperation();
}, 300000); // 5 minutes TTL

// Get statistics
const stats = cache.getStats();
console.log(stats); // { hits: 100, misses: 10, hitRate: '90.91%', size: 50 }
```

## 📁 Cấu Trúc Mới

```
my-messenger-bot/
├── .env.example                    # Environment variables template
├── .env                            # Your actual environment variables (create this)
├── config.json                     # Fallback configuration
├── modules/
│   ├── utils/
│   │   ├── envConfig.js           # Environment configuration loader
│   │   ├── database.js            # Database connection pool
│   │   ├── rateLimiter.js         # Rate limiting system
│   │   ├── secureFileOps.js       # Secure file operations
│   │   ├── logger.js              # Logging system
│   │   ├── cacheManager.js        # Cache management
│   │   ├── checkPermission.js     # Updated with async operations
│   │   └── ... (other utilities)
│   ├── commands/
│   │   ├── economy/
│   │   │   ├── bank.js            # Updated with connection pool
│   │   │   ├── tien.js            # Updated with connection pool
│   │   │   └── ...
│   │   ├── system/
│   │   │   ├── mode.js            # Updated with async operations
│   │   │   └── ...
│   │   └── ...
│   └── ...
├── logs/                          # Log files (auto-created)
│   ├── bot.log                    # Main log file
│   └── error.log                  # Error-only log file
└── ...
```

## 🔧 Cấu Hình

### Environment Variables

```bash
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=bot
DB_PASSWORD=your_secure_password
DB_NAME=goatbot

# Bot
BOT_PREFIX=!
BOT_NAME=DarkWin
BOT_LANGUAGE=vi
ADMIN_IDS=100037351338722,61578017290778

# AI
AI_ENABLED=true
AI_AUTO_REPLY_ENABLED=true
AI_OLLAMA_HOST=http://127.0.0.1:11434
AI_OLLAMA_MODEL=llama3:latest

# Security
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_FILE_PATH=logs/bot.log

# Cache
CACHE_ENABLED=true
CACHE_TTL_MS=120000
CACHE_MAX_SIZE=1000

# Connection Pool
DB_POOL_MIN=2
DB_POOL_MAX=10
```

## 📊 Monitoring

### Health Check
```javascript
const { healthCheck } = require('./modules/utils/database');
const { getCache } = require('./modules/utils/cacheManager');

// Database health
const dbHealth = await healthCheck();
console.log('Database:', dbHealth);

// Cache statistics
const cache = getCache();
const cacheStats = cache.getStats();
console.log('Cache:', cacheStats);
```

### Performance Tracking
```javascript
const { logPerformance } = require('./modules/utils/logger');

const startTime = Date.now();
await someOperation();
const duration = Date.now() - startTime;

logPerformance('someOperation', duration, { additionalContext: 'value' });
```

## 🚨 Security Improvements

1. **Credentials**: Không còn hardcoded trong code
2. **File Permissions**: Tự động set permissions an toàn
3. **Rate Limiting**: Ngăn chặn abuse và spam
4. **Input Validation**: Path validation để ngăn directory traversal
5. **SQL Injection**: Đã sử dụng parameterized queries

## 📈 Performance Improvements

1. **Connection Pooling**: Giảm latency database
2. **Caching**: Giảm load cho database và API calls
3. **Async Operations**: Non-blocking file operations
4. **Rate Limiting**: Ngăn chặn overload hệ thống

## 🧪 Testing

### Test Database Connection
```javascript
const { getConnection, healthCheck } = require('./modules/utils/database');

async function testDatabase() {
  try {
    const health = await healthCheck();
    console.log('Database health:', health);

    const connection = await getConnection();
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('Test query result:', rows);

    connection.release();
    console.log('Database test passed!');
  } catch (error) {
    console.error('Database test failed:', error);
  }
}

testDatabase();
```

### Test Cache
```javascript
const { getCache } = require('./modules/utils/cacheManager');

async function testCache() {
  const cache = getCache();

  // Test set/get
  cache.set('test:key', 'test-value', 5000);
  const value = cache.get('test:key');
  console.log('Cache value:', value);

  // Test statistics
  const stats = cache.getStats();
  console.log('Cache stats:', stats);

  console.log('Cache test passed!');
}

testCache();
```

## 🔄 Migration Guide

### Từ Config cũ sang Environment Variables

1. **Backup config cũ**:
```bash
cp config.json config.json.backup
```

2. **Tạo .env file**:
```bash
cp .env.example .env
```

3. **Chuyển values từ config.json sang .env**:
```bash
# Database
DB_HOST=$(jq -r '.database.host' config.json.backup)
DB_PORT=$(jq -r '.database.port' config.json.backup)
DB_USER=$(jq -r '.database.user' config.json.backup)
DB_PASSWORD=$(jq -r '.database.password' config.json.backup)
DB_NAME=$(jq -r '.database.name' config.json.backup)

# Admin IDs
ADMIN_IDS=$(jq -r '.adminIDs[]' config.json.backup | paste -sd,)
```

4. **Update .env file với values đã chuyển**

5. **Test system**:
```bash
node index.js
```

## 🐛 Troubleshooting

### Database Connection Issues
```bash
# Check database connection
mysql -h localhost -u bot -p goatbot

# Check environment variables
echo $DB_PASSWORD
```

### Permission Issues
```bash
# Check file permissions
ls -la config.json
ls -la .env

# Set proper permissions
chmod 600 config.json
chmod 600 .env
```

### Logging Issues
```bash
# Check log directory
ls -la logs/

# Create log directory if needed
mkdir -p logs
chmod 700 logs
```

## 📝 Best Practices

1. **Luôn sử dụng environment variables** cho sensitive data
2. **Sử dụng connection pool** cho database operations
3. **Implement rate limiting** cho tất cả public endpoints
4. **Sử dụng logging** thay vì console.log
5. **Cache expensive operations**
6. **Sử dụng async/await** cho I/O operations
7. **Validate input** từ users
8. **Handle errors gracefully**

## 🎯 Next Steps

1. **Setup environment**: Copy `.env.example` sang `.env` và cấu hình
2. **Install dependencies**: `npm install`
3. **Test database connection**: Chạy test script
4. **Monitor logs**: Check `logs/bot.log` và `logs/error.log`
5. **Monitor performance**: Sử dụng health check và statistics

## 📞 Support

Nếu gặp vấn đề:
1. Check logs trong `logs/` directory
2. Verify environment variables trong `.env`
3. Test database connection
4. Check file permissions

---

**Version**: 2.0.0
**Last Updated**: 2026-04-26
**Status**: Production Ready