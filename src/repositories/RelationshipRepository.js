const db = require('../database/database');

class RelationshipRepository {
    async find(characterUid, userUid) {
        return await db.get(
            'SELECT * FROM relationships WHERE character_uid = ? AND user_uid = ?',
            [characterUid, userUid]
        );
    }

    async create(data) {
        const now = Date.now();
        const sql = `
            INSERT INTO relationships (character_uid, user_uid, affinity, trust, familiarity, last_interaction, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
            data.character_uid,
            data.user_uid,
            data.affinity ?? 50,
            data.trust ?? 50,
            data.familiarity ?? 0,
            now,
            now
        ];
        await db.run(sql, params);
        return await this.find(data.character_uid, data.user_uid);
    }

    async update(characterUid, userUid, data) {
        const now = Date.now();
        const fields = [];
        const params = [];

        for (const key of ['affinity', 'trust', 'familiarity', 'last_interaction']) {
            if (data[key] !== undefined) {
                fields.push(`${key} = ?`);
                params.push(data[key]);
            }
        }

        if (fields.length === 0) return await this.find(characterUid, userUid);

        fields.push('updated_at = ?');
        params.push(now);
        params.push(characterUid, userUid);

        const sql = `UPDATE relationships SET ${fields.join(', ')} WHERE character_uid = ? AND user_uid = ?`;
        await db.run(sql, params);
        return await this.find(characterUid, userUid);
    }
}

module.exports = new RelationshipRepository();
