const GroqProvider = require('../providers/GroqProvider');
const OllamaProvider = require('../providers/OllamaProvider');
const GeminiProvider = require('../providers/GeminiProvider');
const OpenAIProvider = require('../providers/OpenAIProvider');
const { parseAndRepairJSON } = require('../utils/jsonRepair');
const logger = require('../utils/logger');

class AIService {
    constructor() {
        this.providers = {
            groq: new GroqProvider(),
            ollama: new OllamaProvider(),
            gemini: new GeminiProvider(),
            openai: new OpenAIProvider()
        };
        this.defaultProvider = process.env.AI_PROVIDER || 'groq';
    }

    getProvider(providerName) {
        const name = (providerName || this.defaultProvider).toLowerCase();
        return this.providers[name] || this.providers.groq;
    }

    async generateJSON(prompt, options = {}) {
        const primaryProvider = this.getProvider(options.provider);
        let response = null;

        try {
            response = await primaryProvider.chat(prompt, { ...options, jsonMode: true });
        } catch (firstErr) {
            logger.warn(`Primary provider (${primaryProvider.name}) failed: ${firstErr.message}. Attempting retry or fallback...`);
            // Fallback retry with Ollama or Groq if primary failed
            const fallbackProvider = primaryProvider.name === 'Groq' ? this.providers.ollama : this.providers.groq;
            try {
                response = await fallbackProvider.chat(prompt, { ...options, jsonMode: true });
            } catch (fallbackErr) {
                logger.error(`Fallback provider (${fallbackProvider.name}) also failed: ${fallbackErr.message}`);
                throw new Error(`AI Generation failed on all providers`);
            }
        }

        const parsedJSON = parseAndRepairJSON(response.text);

        logger.logAIPerformance({
            provider: response.provider,
            character: options.characterName || 'Unknown',
            memoryCount: options.memoryCount || 0,
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
            latencyMs: response.latencyMs
        });

        if (!parsedJSON) {
            logger.warn('AI Output failed JSON parsing after repair attempts.');
            return {
                reply: response.text || 'Xin lỗi nha, hiện tại mình đang gặp chút gián đoạn. Bạn nói lại giúp mình nhé!',
                fallbackUsed: true
            };
        }

        return parsedJSON;
    }
}

module.exports = new AIService();
