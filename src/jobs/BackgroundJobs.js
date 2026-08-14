const MoodService = require('../services/MoodService');
const MemoryRepository = require('../repositories/MemoryRepository');
const SharedKnowledgeRepository = require('../repositories/SharedKnowledgeRepository');
const logger = require('../utils/logger');

class BackgroundJobs {
    startAll(intervalMs = 60000) {
        logger.info('Starting AI Social Engine Background Maintenance Jobs...');
        this.timer = setInterval(async () => {
            try {
                // 1. Mood Decay
                await MoodService.tickDecay();

                // 2. Memory Maintenance (Delete memories with importance < 0.2 older than 30 days)
                // Handled lazily or per run
            } catch (e) {
                logger.error(`Error in BackgroundJobs: ${e.message}`);
            }
        }, intervalMs);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

module.exports = new BackgroundJobs();
