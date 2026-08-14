const BaseProvider = require('./BaseProvider');
const axios = require('axios');
require("dotenv").config();

class GroqProvider extends BaseProvider {
    constructor() {
        super('Groq');
        this.apiKey = process.env.GROQ_APIKEY || '';
        this.baseUrl = 'https://api.groq.com/openai/v1/chat/completions';
        this.defaultModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    }

    async chat(prompt, options = {}) {
        const apiKey = options.apiKey || this.apiKey;
        if (!apiKey) {
            throw new Error('Groq API Key is missing in environment (GROQ_APIKEY)');
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
                temperature: options.temperature ?? 0.7,
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

module.exports = GroqProvider;
