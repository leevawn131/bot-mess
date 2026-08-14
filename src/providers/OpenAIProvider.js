const BaseProvider = require('./BaseProvider');
const axios = require('axios');

class OpenAIProvider extends BaseProvider {
    constructor() {
        super('OpenAI');
        this.apiKey = process.env.OPENAI_API_KEY || '';
        this.baseUrl = 'https://api.openai.com/v1/chat/completions';
        this.defaultModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    }

    async chat(prompt, options = {}) {
        const apiKey = options.apiKey || this.apiKey;
        if (!apiKey) {
            throw new Error('OpenAI API Key is missing in environment (OPENAI_API_KEY)');
        }

        const model = options.model || this.defaultModel;
        const startTime = Date.now();

        const messages = Array.isArray(prompt)
            ? prompt
            : [{ role: 'user', content: prompt }];

        const response = await axios.post(
            this.baseUrl,
            {
                model,
                messages,
                response_format: options.jsonMode ? { type: 'json_object' } : undefined
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: options.timeout || 10000
            }
        );

        const latencyMs = Date.now() - startTime;
        const choice = response.data?.choices?.[0]?.message?.content || '';
        const usage = response.data?.usage || {};

        return {
            text: choice,
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            latencyMs,
            provider: this.name,
            model
        };
    }

    async health() {
        return { ok: Boolean(this.apiKey), provider: this.name };
    }
}

module.exports = OpenAIProvider;
