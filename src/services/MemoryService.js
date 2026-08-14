const MemoryRepository = require('../repositories/MemoryRepository');
const cache = require('../cache/MemoryCache');

class MemoryService {
    extractKeywords(text) {
        if (!text) return [];
        // Extract meaningful Vietnamese / English words (excluding common stop words)
        const stopWords = new Set(['la', 'va', 'cua', 'cho', 'voi', 'trong', 'nhung', 'la', 'co', 'nay', 'do', 'mình', 'bạn', 'tao', 'mày']);
        const words = text
            .toLowerCase()
            .replace(/[^\w\sàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 1 && !stopWords.has(w));
        return Array.from(new Set(words));
    }

    calculateScore(memory, keywords = []) {
        // 1. Relevance Score (0.1 to 1.0)
        let relevance = 0.3; // Default baseline relevance
        if (keywords.length > 0) {
            const contentLower = (memory.content || '').toLowerCase();
            const tagsLower = (memory.tags || '').toLowerCase();
            let matches = 0;
            for (const kw of keywords) {
                if (contentLower.includes(kw) || tagsLower.includes(kw)) {
                    matches++;
                }
            }
            if (matches > 0) {
                relevance = Math.min(1.0, 0.5 + (matches / keywords.length) * 0.5);
            }
        }

        // 2. Importance Score (0.0 to 1.0)
        const importance = memory.importance ?? 0.5;

        // 3. Recency Score (1.0 down over time)
        const ageInDays = (Date.now() - (memory.updated_at || memory.created_at || Date.now())) / (86400 * 1000);
        const recency = 1.0 / (1.0 + ageInDays * 0.03);

        // 4. Usage Score (1 + log(1 + usage_score))
        const usageCount = memory.usage_score || 0;
        const usageFactor = 1.0 + Math.log(1.0 + usageCount);

        return relevance * importance * recency * usageFactor;
    }

    async search(userUid, messageText, limit = 5) {
        const keywords = this.extractKeywords(messageText);
        const candidates = await MemoryRepository.search(userUid, keywords);

        const scored = candidates.map(m => ({
            memory: m,
            score: this.calculateScore(m, keywords)
        }));

        scored.sort((a, b) => b.score - a.score);
        const topMemories = scored.slice(0, limit).map(item => item.memory);

        // Increment usage score for retrieved top memories
        for (const mem of topMemories) {
            await MemoryRepository.incrementUsageScore(mem.id);
        }

        return topMemories;
    }

    async remember(userUid, memoryData) {
        if (!memoryData || !memoryData.content) return null;

        // Merge check (Section 39)
        const existing = await MemoryRepository.findExactOrSimilar(userUid, memoryData.content);
        if (existing) {
            await MemoryRepository.incrementUsageScore(existing.id);
            return await MemoryRepository.update(existing.id, {
                importance: Math.max(existing.importance || 0.5, memoryData.importance || 0.5)
            });
        }

        const created = await MemoryRepository.create({
            user_uid: userUid,
            type: memoryData.type || 'Fact',
            content: memoryData.content,
            tags: memoryData.tags || [],
            importance: memoryData.importance ?? 0.5
        });

        cache.delete(`memory_search:${userUid}`);
        return created;
    }

    async update(id, data) {
        return await MemoryRepository.update(id, data);
    }

    async delete(id) {
        return await MemoryRepository.delete(id);
    }
}

module.exports = new MemoryService();
