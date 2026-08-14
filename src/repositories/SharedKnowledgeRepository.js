const db = require('../database/database');

class SharedKnowledgeRepository {
    async getForUser(userUid, visibilityLevels = ['TEAM', 'PUBLIC'], limit = 10) {
        const placeholders = visibilityLevels.map(() => '?').join(', ');
        const sql = `
            SELECT * FROM shared_events
            WHERE user_uid = ? AND visibility IN (${placeholders})
            ORDER BY importance DESC, created_at DESC
            LIMIT ?
        `;
        return await db.all(sql, [userUid, ...visibilityLevels, limit]);
    }

    async create(data) {
        const now = Date.now();
        const sql = `
            INSERT INTO shared_events (user_uid, source_character_uid, title, summary, visibility, importance, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const res = await db.run(sql, [
            data.user_uid,
            data.source_character_uid,
            data.title || '',
            data.summary,
            data.visibility || 'TEAM',
            data.importance ?? 0.5,
            now
        ]);
        return res.lastID;
    }

    async cleanupOld(olderThanMs = 90 * 24 * 3600 * 1000, minImportance = 0.3) {
        const threshold = Date.now() - olderThanMs;
        await db.run('DELETE FROM shared_events WHERE created_at < ? AND importance < ?', [threshold, minImportance]);
    }
}

module.exports = new SharedKnowledgeRepository();
