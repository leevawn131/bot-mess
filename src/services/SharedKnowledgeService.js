const SharedKnowledgeRepository = require('../repositories/SharedKnowledgeRepository');

class SharedKnowledgeService {
    async shareEvent(userUid, sourceCharacterUid, sharedProposal) {
        if (!sharedProposal || !sharedProposal.share || !sharedProposal.summary) return null;

        return await SharedKnowledgeRepository.create({
            user_uid: userUid,
            source_character_uid: sourceCharacterUid,
            title: sharedProposal.title || 'Sự kiện chia sẻ',
            summary: sharedProposal.summary,
            visibility: sharedProposal.visibility || 'TEAM',
            importance: sharedProposal.importance ?? 0.5
        });
    }

    async getSharedEvents(userUid, limit = 10) {
        return await SharedKnowledgeRepository.getForUser(userUid, ['TEAM', 'PUBLIC'], limit);
    }
}

module.exports = new SharedKnowledgeService();
