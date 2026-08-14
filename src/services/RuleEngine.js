const db = require('../database/database');
const MemoryService = require('./MemoryService');
const RelationshipService = require('./RelationshipService');
const MoodService = require('./MoodService');
const DiaryService = require('./DiaryService');
const SecretService = require('./SecretService');
const SharedKnowledgeService = require('./SharedKnowledgeService');
const ConversationRepository = require('../repositories/ConversationRepository');
const logger = require('../utils/logger');

class RuleEngine {
    async processProposal({ characterUid, userUid, userMessage, aiResult }) {
        if (!aiResult || typeof aiResult !== 'object') {
            return { reply: 'Xin lỗi nha, hệ thống đang gặp chút sự cố.' };
        }

        // Rule 1: Reply must exist
        let reply = aiResult.reply;
        if (!reply || typeof reply !== 'string' || !reply.trim()) {
            reply = 'Ừm, mình nghe đây!';
        }

        // Check user explicit secret requests in userMessage ("đừng kể ai", "giữ bí mật", "đừng nói ai")
        const isUserSecretDemand = /(đừng kể|giữ bí mật|đừng nói ai|bí mật này|giữ kín)/i.test(userMessage || '') && !/(có kể|gì cho|không\?)/i.test(userMessage || '');

        await db.beginTransaction();
        try {
            // Rule 2, 3, 4: Relationship Delta Clamping
            if (aiResult.relationship) {
                let affDelta = Number(aiResult.relationship.affinity_delta || 0);
                let truDelta = Number(aiResult.relationship.trust_delta || 0);
                let famDelta = Number(aiResult.relationship.familiarity_delta || 1);

                // Max single interaction deltas
                affDelta = Math.max(-10, Math.min(10, affDelta));
                truDelta = Math.max(-5, Math.min(5, truDelta));
                famDelta = Math.max(0, Math.min(5, famDelta));

                await RelationshipService.applyDeltas(characterUid, userUid, affDelta, truDelta, famDelta);
            }

            // Rule 5, 6: Mood Change Validation
            if (aiResult.mood && aiResult.mood.change) {
                await MoodService.changeMood(characterUid, aiResult.mood);
            }

            // Rule 7, 8, 10: Secret vs Memory vs Shared Knowledge
            if (isUserSecretDemand) {
                // Save directly as Secret, DO NOT put in Memory or Shared Knowledge
                await SecretService.remember(characterUid, userUid, userMessage, 0.9);
                logger.info(`Detected secret request from user. Saved to SecretService for character=${characterUid}`);
            } else {
                // Normal Memory Proposal
                if (aiResult.memory && aiResult.memory.remember && aiResult.memory.content) {
                    const importance = Math.max(0.0, Math.min(1.0, Number(aiResult.memory.importance ?? 0.5)));
                    await MemoryService.remember(userUid, {
                        content: aiResult.memory.content,
                        type: aiResult.memory.type || 'Fact',
                        tags: aiResult.memory.tags || [],
                        importance
                    });
                }

                // Shared Knowledge Proposal (Check Rule 8: Cannot contain Secret)
                if (aiResult.shared && aiResult.shared.share && aiResult.shared.summary) {
                    const isSecretLike = /(bí mật|chuyện riêng|đừng kể|tâm sự thầm kín)/i.test(aiResult.shared.summary);
                    if (isSecretLike) {
                        logger.warn(`Rule Engine rejected Shared Knowledge proposal because it contains secret content.`);
                    } else {
                        await SharedKnowledgeService.shareEvent(userUid, characterUid, aiResult.shared);
                    }
                }
            }

            // Rule 9: Diary Proposal (Personal feeling append)
            if (aiResult.diary && aiResult.diary.write && aiResult.diary.entry) {
                await DiaryService.append(characterUid, userUid, aiResult.diary.entry);
            }

            // Save conversation history (Short term FIFO 100)
            await ConversationRepository.addMessage(characterUid, userUid, 'user', userMessage);
            await ConversationRepository.addMessage(characterUid, userUid, 'assistant', reply);

            await db.commitTransaction();
            return { reply, success: true };
        } catch (err) {
            await db.rollbackTransaction();
            logger.error(`RuleEngine transaction failed: ${err.message}. Rolling back.`, { error: err });
            return { reply: reply || 'Hình như có lỗi xảy ra khi xử lý tin nhắn.', success: false };
        }
    }
}

module.exports = new RuleEngine();
