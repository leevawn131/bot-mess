const fs = require('fs');
const path = require('path');

class PromptBuilder {
    constructor() {
        this.systemPromptPath = path.join(__dirname, '../prompts/system.md');
        this.systemPromptTemplate = '';
        this.loadTemplates();
    }

    loadTemplates() {
        if (fs.existsSync(this.systemPromptPath)) {
            this.systemPromptTemplate = fs.readFileSync(this.systemPromptPath, 'utf8');
        } else {
            this.systemPromptTemplate = 'Bạn là AI Character. Trả lời dạng JSON.';
        }
    }

    buildPrompt(context) {
        const {
            character,
            mood,
            worldState,
            userProfile,
            relationship,
            memories,
            secrets,
            sharedEvents,
            diaries,
            history,
            currentMessage
        } = context;

        const sections = [];

        // 1. System Prompt
        sections.push(this.systemPromptTemplate);

        // 2. Character
        if (character) {
            const fullName = character.display_name || character.facebook_name || 'AI';
            const nameParts = fullName.split(' ').filter(p => p.length >= 2);
            const shortName = nameParts.length > 0 ? nameParts[nameParts.length - 1] : fullName;
            sections.push(`
# CHARACTER
Tên chính thức: ${fullName}
Tên gọi tắt/thân mật: ${shortName} (Ví dụ: "${shortName} ơi", "${fullName} ơi", "bạn ơi", "bot ơi" đều là đang gọi BẠN)
Giới tính: ${character.gender || 'Nữ'}
Tính cách: ${character.personality}
Phong cách nói: ${character.speaking_style}
Tự xưng: ${character.self_pronoun || 'Mình'}
Gọi User là: ${character.user_pronoun || 'Bạn'}
Độ hài hước (Humor Level 0-100): ${character.humor_level ?? 50}
Mức dùng Emoji (Emoji Level 0-100): ${character.emoji_level ?? 30}
${character.system_prompt ? `Mô tả bổ sung: ${character.system_prompt}` : ''}
`.trim());
        }

        // 3. Current Mood
        if (mood && mood.mood && mood.mood !== 'Normal') {
            sections.push(`
# CURRENT MOOD
Tâm trạng hiện tại: ${mood.mood} (Độ mạnh: ${mood.intensity ?? 0.5})
Lý do: ${mood.reason || 'Cảm xúc tự nhiên'}
Hướng dẫn: Bạn đang có tâm trạng ${mood.mood}. Hãy điều chỉnh giọng điệu và cách dùng emoji một chút theo cảm xúc này, nhưng giữ nguyên bản chất tính cách và kiến thức thực tế.
`.trim());
        }

        // 4. World State
        if (worldState) {
            sections.push(`
# WORLD STATE
Nhân vật đang tương tác: ${character ? (character.display_name || character.facebook_name) : 'Unknown'}
Trạng thái thế giới: ${typeof worldState === 'string' ? worldState : JSON.stringify(worldState)}
`.trim());
        }

        // 5. User Profile
        if (userProfile) {
            sections.push(`
# USER PROFILE
Tên/Biệt danh User: ${userProfile.nickname || 'User'}
Xưng hô ưa thích: ${userProfile.preferred_pronoun || 'Bạn'}
Ngôn ngữ: ${userProfile.language || 'vi'}
`.trim());
        }

        // 6. Relationship
        if (relationship) {
            let relDesc = 'Hai người đã từng tương tác với nhau.';
            if (relationship.affinity < 30) {
                relDesc = 'Mối quan hệ còn khá xa lạ hoặc có chút khoảng cách. Trả lời lịch sự, giữ mức độ thân sơ.';
            } else if (relationship.affinity > 75) {
                relDesc = 'Mối quan hệ rất thân thiết, thoải mái trò chuyện tự nhiên như bạn bè thân thiết.';
            }
            sections.push(`
# RELATIONSHIP
Thân thiết (Affinity): ${relationship.affinity}/100
Tin tưởng (Trust): ${relationship.trust}/100
Quen thuộc (Familiarity): ${relationship.familiarity}/100
Cảm nhận: ${relDesc}
`.trim());
        }

        // 7. Relevant Memory
        if (memories && memories.length > 0) {
            const memList = memories.map(m => `- ${m.content} (Độ tin cậy: ${m.importance >= 0.8 ? 'Chắc chắn' : 'Có vẻ vậy'})`).join('\n');
            sections.push(`
# RELEVANT MEMORY (Ghi nhớ về User)
${memList}
`.trim());
        }

        // 8. Relevant Secrets (Chỉ khi thuộc về Character hiện tại)
        if (secrets && secrets.length > 0) {
            const secList = secrets.map(s => `- ${s.content}`).join('\n');
            sections.push(`
# RELEVANT SECRETS (Bí mật riêng tư User từng tâm sự riêng với bạn)
${secList}
Lưu ý: Không tự dưng nhắc lại trừ khi User chủ động mở lại chủ đề. Tuyệt đối không leak ra ngoài.
`.trim());
        }

        // 9. Shared Knowledge
        if (sharedEvents && sharedEvents.length > 0) {
            const sharedList = sharedEvents.map(e => `- ${e.title}: ${e.summary}`).join('\n');
            sections.push(`
# SHARED KNOWLEDGE (Sự kiện đời sống của User mà các nhân vật trong nhóm chia sẻ với nhau)
${sharedList}
`.trim());
        }

        // 10. Character Diary
        if (diaries && diaries.length > 0) {
            const diaryList = diaries.map(d => `- ${d.entry}`).join('\n');
            sections.push(`
# CHARACTER DIARY (Nhật ký cảm nhận cá nhân trước đây của bạn)
${diaryList}
`.trim());
        }

        // 11. Recent Conversation
        if (history && history.length > 0) {
            const historyText = history.map(h => `${h.role === 'user' ? 'User' : (character?.display_name || 'Assistant')}: ${h.content}`).join('\n');
            sections.push(`
# RECENT CONVERSATION (Lịch sử hội thoại gần đây)
${historyText}
`.trim());
        }

        // 12. Current User Message
        sections.push(`
# CURRENT USER MESSAGE
User: ${currentMessage}
`.trim());

        return sections.join('\n\n---\n\n');
    }
}

module.exports = new PromptBuilder();
