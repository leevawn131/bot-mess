const BaseProvider = require('./BaseProvider');
const axios = require('axios');

class GeminiProvider extends BaseProvider {
    constructor() {
        super('Gemini');
        this.apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
        this.defaultModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    }

    async chat(prompt, options = {}) {
        const apiKey = options.apiKey || this.apiKey;
        if (!apiKey) {
            throw new Error('Gemini API Key is missing in environment (GEMINI_API_KEY)');
        }

        const model = options.model || this.defaultModel;
        const startTime = Date.now();

        const contents = Array.isArray(prompt)
            ? prompt.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
            : [{ role: 'user', parts: [{ text: prompt }] }];

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await axios.post(
            url,
            { contents },
            { timeout: options.timeout || 10000 }
        );

        const latencyMs = Date.now() - startTime;
        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const usage = response.data?.usageMetadata || {};

        return {
            text,
            promptTokens: usage.promptTokenCount || 0,
            completionTokens: usage.candidatesTokenCount || 0,
            latencyMs,
            provider: this.name,
            model
        };
    }

    async health() {
        return { ok: Boolean(this.apiKey), provider: this.name };
    }
}

module.exports = GeminiProvider;
