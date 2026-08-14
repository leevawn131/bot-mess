const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const ENGINE_LOG_FILE = path.join(LOG_DIR, 'ai_social_engine.log');

class Logger {
    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        const sanitizeData = { ...data };
        // Mask confidential fields if present
        delete sanitizeData.prompt;
        delete sanitizeData.secret;
        delete sanitizeData.secrets;
        delete sanitizeData.diary;

        const line = `[${timestamp}] [${level.toUpperCase()}] ${message} ${Object.keys(sanitizeData).length ? JSON.stringify(sanitizeData) : ''}\n`;
        process.stdout.write(line);
        try {
            fs.appendFileSync(ENGINE_LOG_FILE, line);
        } catch (e) {
            // Ignore log file writing errors
        }
    }

    info(msg, data) {
        this.log('info', msg, data);
    }

    warn(msg, data) {
        this.log('warn', msg, data);
    }

    error(msg, data) {
        this.log('error', msg, data);
    }

    logAIPerformance({ provider, character, memoryCount, promptTokens, completionTokens, latencyMs, cost }) {
        this.info('AI Response Stats', {
            provider,
            character,
            memoryCount,
            promptTokens,
            completionTokens,
            latencyMs,
            cost: cost || 0
        });
    }
}

module.exports = new Logger();
