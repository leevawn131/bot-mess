const db = require('../database/database');

class DiaryRepository {
    async append(characterUid, userUid, entry) {
        const now = Date.now();
        const sql = `
            INSERT INTO character_diaries (character_uid, user_uid, entry, created_at)
            VALUES (?, ?, ?, ?)
        `;
        const res = await db.run(sql, [characterUid, userUid, entry, now]);
        return res.lastID;
    }

    async getLatest(characterUid, userUid, limit = 3) {
        const sql = `
            SELECT * FROM character_diaries
            WHERE character_uid = ? AND user_uid = ?
            ORDER BY created_at DESC
            LIMIT ?
        `;
        const rows = await db.all(sql, [characterUid, userUid, limit]);
        return rows.reverse(); // FIFO order for prompt display
    }

    async cleanupOld(characterUid, userUid, maxKeep = 100) {
        const sql = `
            DELETE FROM character_diaries
            WHERE character_uid = ? AND user_uid = ? AND id NOT IN (
                SELECT id FROM character_diaries
                WHERE character_uid = ? AND user_uid = ?
                ORDER BY created_at DESC
                LIMIT ?
            )
        `;
        await db.run(sql, [characterUid, userUid, characterUid, userUid, maxKeep]);
    }
}

module.exports = new DiaryRepository();
