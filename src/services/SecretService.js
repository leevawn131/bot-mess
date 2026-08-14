const SecretRepository = require('../repositories/SecretRepository');

class SecretService {
    async remember(characterUid, userUid, content, importance = 0.8) {
        if (!content || !content.trim()) return null;
        return await SecretRepository.create({
            character_uid: characterUid,
            user_uid: userUid,
            content: content.trim(),
            importance
        });
    }

    async getSecrets(characterUid, userUid, limit = 10) {
        return await SecretRepository.find(characterUid, userUid, limit);
    }
}

module.exports = new SecretService();
