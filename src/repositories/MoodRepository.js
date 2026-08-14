const db = require('../database/database');

class MoodRepository {
    async findByCharacterUid(characterUid) {
        return await db.get('SELECT * FROM character_moods WHERE character_uid = ?', [characterUid]);
    }

    async upsert(characterUid, data) {
        const now = Date.now();
        const existing = await this.findByCharacterUid(characterUid);

        if (existing) {
            const sql = `
                UPDATE character_moods
                SET mood = ?, intensity = ?, reason = ?, expires_at = ?, updated_at = ?
                WHERE character_uid = ?
            `;
            await db.run(sql, [
                data.mood || 'Normal',
                data.intensity ?? 0.5,
                data.reason || '',
                data.expires_at ?? (now + 3600 * 1000),
                now,
                characterUid
            ]);
        } else {
            const sql = `
                INSERT INTO character_moods (character_uid, mood, intensity, reason, expires_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            await db.run(sql, [
                characterUid,
                data.mood || 'Normal',
                data.intensity ?? 0.5,
                data.reason || '',
                data.expires_at ?? (now + 3600 * 1000),
                now
            ]);
        }

        return await this.findByCharacterUid(characterUid);
    }

    async getExpired(now = Date.now()) {
        return await db.all('SELECT * FROM character_moods WHERE expires_at < ? AND mood != ?', [now, 'Normal']);
    }

    async resetToNormal(characterUid) {
        const now = Date.now();
        await db.run(
            'UPDATE character_moods SET mood = ?, intensity = ?, reason = ?, expires_at = ?, updated_at = ? WHERE character_uid = ?',
            ['Normal', 0.0, 'Expired to normal', now + 86400000, now, characterUid]
        );
    }
}

module.exports = new MoodRepository();
