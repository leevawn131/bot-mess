const DiaryRepository = require('../repositories/DiaryRepository');

class DiaryService {
    async append(characterUid, userUid, entry) {
        if (!entry || typeof entry !== 'string' || !entry.trim()) return null;
        const id = await DiaryRepository.append(characterUid, userUid, entry.trim());
        await DiaryRepository.cleanupOld(characterUid, userUid, 100);
        return id;
    }

    async getLatest(characterUid, userUid, limit = 3) {
        return await DiaryRepository.getLatest(characterUid, userUid, limit);
    }
}

module.exports = new DiaryService();
