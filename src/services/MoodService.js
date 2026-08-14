const MoodRepository = require('../repositories/MoodRepository');
const cache = require('../cache/MemoryCache');
const logger = require('../utils/logger');

const ALLOWED_MOODS = new Set([
    'Normal', 'Happy', 'Excited', 'Playful', 'Thoughtful',
    'Calm', 'Empathetic', 'Curious', 'Caring', 'Energetic'
]);

class MoodService {
    async load(characterUid) {
        const cacheKey = `mood:${characterUid}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        let moodObj = await MoodRepository.findByCharacterUid(characterUid);
        if (!moodObj) {
            moodObj = await MoodRepository.upsert(characterUid, {
                mood: 'Normal',
                intensity: 0.0,
                reason: 'Default state',
                expires_at: Date.now() + 86400000
            });
        } else if (moodObj.expires_at && moodObj.expires_at < Date.now() && moodObj.mood !== 'Normal') {
            moodObj = await MoodRepository.upsert(characterUid, {
                mood: 'Normal',
                intensity: 0.0,
                reason: 'Expired mood',
                expires_at: Date.now() + 86400000
            });
        }

        cache.set(cacheKey, moodObj, 300); // 5 mins TTL
        return moodObj;
    }

    async changeMood(characterUid, moodProposal) {
        if (!moodProposal || !moodProposal.change) return await this.load(characterUid);

        // Validation Rules: Section 16 & Rule Engine
        if (moodProposal.confidence !== undefined && moodProposal.confidence < 0.8) {
            logger.info(`Mood proposal rejected due to low confidence (${moodProposal.confidence} < 0.8)`);
            return await this.load(characterUid);
        }

        let newMood = moodProposal.mood || 'Normal';
        if (!ALLOWED_MOODS.has(newMood)) {
            logger.warn(`Invalid mood requested: ${newMood}. Reverting to Normal.`);
            newMood = 'Normal';
        }

        let durationMins = moodProposal.duration || 180; // default 3h
        if (durationMins > 360) {
            logger.warn(`Mood duration ${durationMins}m exceeds 6 hours limit. Clamping to 360m.`);
            durationMins = 360;
        }

        const expiresAt = Date.now() + (durationMins * 60 * 1000);
        const intensity = Math.max(0.0, Math.min(1.0, moodProposal.intensity ?? 0.5));

        const updated = await MoodRepository.upsert(characterUid, {
            mood: newMood,
            intensity,
            reason: moodProposal.reason || 'AI mood change',
            expires_at: expiresAt
        });

        cache.set(`mood:${characterUid}`, updated, 300);
        return updated;
    }

    async tickDecay() {
        const expiredMoods = await MoodRepository.getExpired();
        for (const m of expiredMoods) {
            await MoodRepository.resetToNormal(m.character_uid);
            cache.delete(`mood:${m.character_uid}`);
        }
    }
}

module.exports = new MoodService();
