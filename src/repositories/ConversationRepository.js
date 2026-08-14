const db = require('../database/database');

class ConversationRepository {
    async getRecentHistory(characterUid, userUid, limit = 30) {
        const sql = `
            SELECT * FROM conversation_history
            WHERE character_uid = ? AND user_uid = ?
            ORDER BY id DESC
            LIMIT ?
        `;
        const rows = await db.all(sql, [characterUid, userUid, limit]);
        return rows.reverse(); // Standard chronological order
    }

    async addMessage(characterUid, userUid, role, content) {
        const now = Date.now();
        const sql = `
            INSERT INTO conversation_history (character_uid, user_uid, role, content, created_at)
            VALUES (?, ?, ?, ?, ?)
        `;
        const res = await db.run(sql, [characterUid, userUid, role, content, now]);
        // Clean FIFO if count > 100
        await this.cleanup(characterUid, userUid, 100);
        return res.lastID;
    }

    async cleanup(characterUid, userUid, maxKeep = 100) {
        const sql = `
            DELETE FROM conversation_history
            WHERE character_uid = ? AND user_uid = ? AND id NOT IN (
                SELECT id FROM conversation_history
                WHERE character_uid = ? AND user_uid = ?
                ORDER BY id DESC
                LIMIT ?
            )
        `;
        await db.run(sql, [characterUid, userUid, characterUid, userUid, maxKeep]);
    }
}

module.exports = new ConversationRepository();
