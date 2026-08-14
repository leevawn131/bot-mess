const CharacterRepository = require('../repositories/CharacterRepository');
const cache = require('../cache/MemoryCache');
const logger = require('../utils/logger');

class CharacterService {
    async load(accountUid) {
        const cacheKey = `character:${accountUid}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        let character = await CharacterRepository.findByAccountUid(accountUid);
        if (character) {
            cache.set(cacheKey, character, 3600); // 1 hour TTL
        }
        return character;
    }

    async getOrGenerate(accountUid, aiService = null, fbName = 'Facebook User') {
        let character = await this.load(accountUid);
        if (character) return character;

        logger.info(`Character for account_uid=${accountUid} not found. Generating default/AI character...`);

        if (aiService) {
            try {
                const prompt = `
Bạn là Character Generator cho Messenger Bot.
Hãy tạo thông tin nhân vật cho tài khoản Facebook: "${fbName}".
Trả về JSON duy nhất theo định dạng:
{
  "display_name": "Tên nhân vật",
  "gender": "Nữ",
  "personality": "Tính cách chính (ấm áp, hóm hỉnh, mộng mơ...)",
  "speaking_style": "Phong cách nói chuyện (câu ngắn, hay dùng từ nhẹ nhàng...)",
  "self_pronoun": "Mình",
  "user_pronoun": "Cậu",
  "humor_level": 60,
  "emoji_level": 40,
  "system_prompt": "Prompt chỉ dẫn riêng cho nhân vật"
}
`;
                const aiResult = await aiService.generateJSON(prompt);
                if (aiResult && aiResult.display_name) {
                    character = await CharacterRepository.create({
                        account_uid: accountUid,
                        facebook_name: fbName,
                        display_name: aiResult.display_name,
                        gender: aiResult.gender || 'Nữ',
                        personality: aiResult.personality || 'Thân thiện, lắng nghe',
                        speaking_style: aiResult.speaking_style || 'Nói chuyện tự nhiên',
                        self_pronoun: aiResult.self_pronoun || 'Mình',
                        user_pronoun: aiResult.user_pronoun || 'Bạn',
                        humor_level: aiResult.humor_level ?? 50,
                        emoji_level: aiResult.emoji_level ?? 30,
                        system_prompt: aiResult.system_prompt || ''
                    });
                    cache.set(`character:${accountUid}`, character, 3600);
                    return character;
                }
            } catch (err) {
                logger.error('Failed to auto-generate character via AI. Falling back to default.', { error: err.message });
            }
        }

        // Fallback default character
        character = await CharacterRepository.create({
            account_uid: accountUid,
            facebook_name: fbName,
            display_name: fbName || 'Như Quỳnh',
            gender: 'Nữ',
            personality: 'Ấm áp, biết lắng nghe, tinh tế, thích chia sẻ.',
            speaking_style: 'Nói chuyện nhẹ nhàng, quan tâm.',
            self_pronoun: 'Mình',
            user_pronoun: 'Bạn',
            humor_level: 50,
            emoji_level: 40,
            system_prompt: 'Bạn luôn quan tâm tới cảm xúc của User.'
        });

        cache.set(`character:${accountUid}`, character, 3600);
        return character;
    }

    async update(accountUid, data) {
        const updated = await CharacterRepository.update(accountUid, data);
        cache.delete(`character:${accountUid}`);
        return updated;
    }
}

module.exports = new CharacterService();
