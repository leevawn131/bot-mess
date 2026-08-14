const CharacterService = require('./CharacterService');
const UserRepository = require('../repositories/UserRepository');
const RelationshipService = require('./RelationshipService');
const MoodService = require('./MoodService');
const MemoryService = require('./MemoryService');
const SecretService = require('./SecretService');
const SharedKnowledgeService = require('./SharedKnowledgeService');
const DiaryService = require('./DiaryService');
const ConversationRepository = require('../repositories/ConversationRepository');
const PromptBuilder = require('./PromptBuilder');
const AIService = require('./AIService');
const RuleEngine = require('./RuleEngine');
const db = require('../database/database');

class ConversationService {
    async handleMessage({ accountUid, userUid, messageText, fbName = 'Facebook User' }) {
        if (!messageText || !messageText.trim()) {
            return { reply: '' };
        }

        // 1. Ensure DB initialized
        if (!db.db) {
            await db.init();
        }

        // 2. Load Character
        const character = await CharacterService.getOrGenerate(accountUid, AIService, fbName);

        // 3. Load or create User Profile
        let userProfile = await UserRepository.findByUserUid(userUid);
        if (!userProfile) {
            userProfile = await UserRepository.create({
                user_uid: userUid,
                nickname: fbName || 'Bạn',
                language: 'vi'
            });
        }

        // 4. Load Relationship
        const relationship = await RelationshipService.load(accountUid, userUid);

        // 5. Load Mood
        const mood = await MoodService.load(accountUid);

        // 6. Search Relevant Memory
        const memories = await MemoryService.search(userUid, messageText, 5);

        // 7. Search Secrets (Only for current character)
        const secrets = await SecretService.getSecrets(accountUid, userUid, 5);

        // 8. Search Shared Knowledge
        const sharedEvents = await SharedKnowledgeService.getSharedEvents(userUid, 5);

        // 9. Load Character Diary (3 latest entries)
        const diaries = await DiaryService.getLatest(accountUid, userUid, 3);

        // 10. Load 30 recent messages
        const history = await ConversationRepository.getRecentHistory(accountUid, userUid, 30);

        // 11. World State
        const worldState = {
            current_character: character.display_name,
            status: 'online'
        };

        // 12. Build Prompt
        const prompt = PromptBuilder.buildPrompt({
            character,
            mood,
            worldState,
            userProfile,
            relationship,
            memories,
            secrets,
            sharedEvents,
            diaries,
            history,
            currentMessage: messageText
        });

        // 13. Call AI Service
        let aiResult;
        try {
            aiResult = await AIService.generateJSON(prompt, {
                characterName: character.display_name,
                memoryCount: memories.length
            });
        } catch (err) {
            return {
                reply: `Mình (${character.display_name}) đang gặp chút sự cố kết nối. Thử lại sau giúp mình nha!`,
                error: err.message
            };
        }

        // 14. Pass through Rule Engine & SQLite transaction
        const result = await RuleEngine.processProposal({
            characterUid: accountUid,
            userUid,
            userMessage: messageText,
            aiResult
        });

        return result;
    }
}

module.exports = new ConversationService();
