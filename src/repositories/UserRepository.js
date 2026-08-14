const db = require('../database/database');

class UserRepository {
    async findByUserUid(userUid) {
        return await db.get('SELECT * FROM user_profiles WHERE user_uid = ?', [userUid]);
    }

    async create(data) {
        const now = Date.now();
        const sql = `
            INSERT INTO user_profiles (
                user_uid, nickname, preferred_pronoun, language, favorite_character, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
            data.user_uid,
            data.nickname || '',
            data.preferred_pronoun || '',
            data.language || 'vi',
            data.favorite_character || '',
            now,
            now
        ];
        await db.run(sql, params);
        return await this.findByUserUid(data.user_uid);
    }

    async update(userUid, data) {
        const now = Date.now();
        const fields = [];
        const params = [];

        for (const key of ['nickname', 'preferred_pronoun', 'language', 'favorite_character']) {
            if (data[key] !== undefined) {
                fields.push(`${key} = ?`);
                params.push(data[key]);
            }
        }

        if (fields.length === 0) return await this.findByUserUid(userUid);

        fields.push('updated_at = ?');
        params.push(now);
        params.push(userUid);

        const sql = `UPDATE user_profiles SET ${fields.join(', ')} WHERE user_uid = ?`;
        await db.run(sql, params);
        return await this.findByUserUid(userUid);
    }
}

module.exports = new UserRepository();
