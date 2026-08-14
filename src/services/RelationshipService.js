const RelationshipRepository = require('../repositories/RelationshipRepository');
const cache = require('../cache/MemoryCache');

class RelationshipService {
    async load(characterUid, userUid) {
        const cacheKey = `rel:${characterUid}:${userUid}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        let rel = await RelationshipRepository.find(characterUid, userUid);
        if (!rel) {
            rel = await RelationshipRepository.create({
                character_uid: characterUid,
                user_uid: userUid,
                affinity: 50,
                trust: 50,
                familiarity: 0
            });
        }
        cache.set(cacheKey, rel, 900); // 15 mins TTL
        return rel;
    }

    async applyDeltas(characterUid, userUid, affinityDelta = 0, trustDelta = 0, familiarityDelta = 0) {
        const current = await this.load(characterUid, userUid);

        // Clamp values 0 to 100
        const newAffinity = Math.max(0, Math.min(100, (current.affinity ?? 50) + affinityDelta));
        const newTrust = Math.max(0, Math.min(100, (current.trust ?? 50) + trustDelta));
        const newFamiliarity = Math.max(0, Math.min(100, (current.familiarity ?? 0) + familiarityDelta));

        const updated = await RelationshipRepository.update(characterUid, userUid, {
            affinity: newAffinity,
            trust: newTrust,
            familiarity: newFamiliarity,
            last_interaction: Date.now()
        });

        const cacheKey = `rel:${characterUid}:${userUid}`;
        cache.set(cacheKey, updated, 900);
        return updated;
    }
}

module.exports = new RelationshipService();
