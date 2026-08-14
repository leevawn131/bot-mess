const db = require('../database/database');

class SecretRepository {
    async find(characterUid, userUid, limit = 10) {
        return await db.all(
            'SELECT * FROM secrets WHERE character_uid = ? AND user_uid = ? ORDER BY importance DESC, updated_at DESC LIMIT ?',
            [characterUid, userUid, limit]
        );
    }

    async create(data) {
        const now = Date.now();
        const sql = `
            INSERT INTO secrets (character_uid, user_uid, content, importance, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const res = await db.run(sql, [
            data.character_uid,
            data.user_uid,
            data.content,
            data.importance ?? 0.8,
            now,
            now
        ]);
        return res.lastID;
    }

    async delete(id) {
        await db.run('DELETE FROM secrets WHERE id = ?', [id]);
    }
}

module.exports = new SecretRepository();
