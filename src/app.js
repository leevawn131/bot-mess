const db = require('./database/database');
const CharacterService = require('./services/CharacterService');
const ConversationService = require('./services/ConversationService');
const MemoryService = require('./services/MemoryService');
const RelationshipService = require('./services/RelationshipService');
const MoodService = require('./services/MoodService');
const DiaryService = require('./services/DiaryService');
const SecretService = require('./services/SecretService');
const SharedKnowledgeService = require('./services/SharedKnowledgeService');
const BackgroundJobs = require('./jobs/BackgroundJobs');
const logger = require('./utils/logger');

class AISocialEngine {
    async init() {
        logger.info('Initializing AI Social Engine v1.0...');
        await db.init();
        BackgroundJobs.startAll();
        logger.info('AI Social Engine initialized successfully.');
    }

    async handleMessage({ accountUid, userUid, messageText, fbName }) {
        return await ConversationService.handleMessage({
            accountUid,
            userUid,
            messageText,
            fbName
        });
    }

    async shutdown() {
        BackgroundJobs.stop();
        await db.close();
        logger.info('AI Social Engine shutdown complete.');
    }
}

const engine = new AISocialEngine();

module.exports = {
    engine,
    db,
    CharacterService,
    ConversationService,
    MemoryService,
    RelationshipService,
    MoodService,
    DiaryService,
    SecretService,
    SharedKnowledgeService
};
