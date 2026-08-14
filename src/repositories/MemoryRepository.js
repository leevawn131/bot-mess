const db = require('../database/database');

class MemoryRepository {
    async findById(id) {
        return await db.get('SELECT * FROM memories WHERE id = ?', [id]);
    }

    async getByUser(userUid, limit = 50) {
        return await db.all('SELECT * FROM memories WHERE user_uid = ? ORDER BY importance DESC, updated_at DESC LIMIT ?', [userUid, limit]);
    }

    async search(userUid, keywords = []) {
        if (!keywords.length) {
            return await this.getByUser(userUid, 20);
        }
        const clauses = keywords.map(() => '(content LIKE ? OR tags LIKE ?)').join(' OR ');
        const params = [userUid];
        for (const kw of keywords) {
            params.push(`%${kw}%`, `%${kw}%`);
        }
        const sql = `SELECT * FROM memories WHERE user_uid = ? AND (${clauses}) ORDER BY importance DESC, updated_at DESC LIMIT 30`;
        return await db.all(sql, params);
    }

    async findExactOrSimilar(userUid, content) {
        return await db.get('SELECT * FROM memories WHERE user_uid = ? AND content = ?', [userUid, content]);
    }

    async create(data) {
        const now = Date.now();
        const tagsJson = Array.isArray(data.tags) ? JSON.stringify(data.tags) : (data.tags || '[]');
        const sql = `
            INSERT INTO memories (user_uid, type, content, tags, importance, usage_score, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
            data.user_uid,
            data.type || 'Fact',
            data.content,
            tagsJson,
            data.importance ?? 0.5,
            data.usage_score ?? 0,
            now,
            now
        ];
        const res = await db.run(sql, params);
        return await this.findById(res.lastID);
    }

    async update(id, data) {
        const now = Date.now();
        const fields = [];
        const params = [];

        if (data.content !== undefined) {
            fields.push('content = ?');
            params.push(data.content);
        }
        if (data.type !== undefined) {
            fields.push('type = ?');
            params.push(data.type);
        }
        if (data.tags !== undefined) {
            fields.push('tags = ?');
            params.push(Array.isArray(data.tags) ? JSON.stringify(data.tags) : data.tags);
        }
        if (data.importance !== undefined) {
            fields.push('importance = ?');
            params.push(data.importance);
        }
        if (data.usage_score !== undefined) {
            fields.push('usage_score = ?');
            params.push(data.usage_score);
        }

        if (!fields.length) return await this.findById(id);

        fields.push('updated_at = ?');
        params.push(now);
        params.push(id);

        const sql = `UPDATE memories SET ${fields.join(', ')} WHERE id = ?`;
        await db.run(sql, params);
        return await this.findById(id);
    }

    async incrementUsageScore(id) {
        const now = Date.now();
        await db.run('UPDATE memories SET usage_score = usage_score + 1, updated_at = ? WHERE id = ?', [now, id]);
    }

    async delete(id) {
        await db.run('DELETE FROM memories WHERE id = ?', [id]);
    }

    async deleteLowImportanceOldMemories(userUid, minImportance = 0.2, olderThanMs = 30 * 24 * 60 * 60 * 1000) {
        const threshold = Date.now() - olderThanMs;
        await db.run('DELETE FROM memories WHERE user_uid = ? AND importance < ? AND updated_at < ?', [userUid, minImportance, threshold]);
    }
}

module.exports = new MemoryRepository();
