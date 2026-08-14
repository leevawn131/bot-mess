const db = require('../database/database');

class CharacterRepository {
    async findByAccountUid(accountUid) {
        return await db.get('SELECT * FROM characters WHERE account_uid = ?', [accountUid]);
    }

    async findById(id) {
        return await db.get('SELECT * FROM characters WHERE id = ?', [id]);
    }

    async getAll() {
        return await db.all('SELECT * FROM characters');
    }

    async create(data) {
        const now = Date.now();
        const sql = `
            INSERT INTO characters (
                account_uid, facebook_name, display_name, avatar, gender,
                personality, speaking_style, self_pronoun, user_pronoun,
                humor_level, emoji_level, system_prompt, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
            data.account_uid,
            data.facebook_name || 'FB User',
            data.display_name || 'AI Character',
            data.avatar || '',
            data.gender || 'Nữ',
            data.personality,
            data.speaking_style,
            data.self_pronoun || 'Mình',
            data.user_pronoun || 'Bạn',
            data.humor_level ?? 50,
            data.emoji_level ?? 30,
            data.system_prompt || '',
            now,
            now
        ];
        const res = await db.run(sql, params);
        return await this.findById(res.lastID);
    }

    async update(accountUid, data) {
        const existing = await this.findByAccountUid(accountUid);
        if (!existing) {
            return await this.create({ account_uid: accountUid, ...data });
        }
        const now = Date.now();
        const fields = [];
        const params = [];

        for (const key of ['facebook_name', 'display_name', 'avatar', 'gender', 'personality', 'speaking_style', 'self_pronoun', 'user_pronoun', 'humor_level', 'emoji_level', 'system_prompt']) {
            if (data[key] !== undefined) {
                fields.push(`${key} = ?`);
                params.push(data[key]);
            }
        }

        if (fields.length === 0) return existing;

        fields.push('updated_at = ?');
        params.push(now);
        params.push(accountUid);

        const sql = `UPDATE characters SET ${fields.join(', ')} WHERE account_uid = ?`;
        await db.run(sql, params);
        return await this.findByAccountUid(accountUid);
    }
}

module.exports = new CharacterRepository();
