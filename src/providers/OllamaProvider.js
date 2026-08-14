const BaseProvider = require('./BaseProvider');
const axios = require('axios');

class OllamaProvider extends BaseProvider {
    constructor() {
        super('Ollama');
        this.host = process.env.AI_OLLAMA_HOST || 'http://127.0.0.1:11434';
        this.defaultModel = process.env.AI_OLLAMA_MODEL || 'llama3:latest';
    }

    async chat(prompt, options = {}) {
        const host = options.host || this.host;
        const model = options.model || this.defaultModel;
        const startTime = Date.now();

        const messages = Array.isArray(prompt)
            ? prompt
            : [{ role: 'user', content: prompt }];

        const response = await axios.post(
            `${host.replace(/\/$/, '')}/api/chat`,
            {
                model,
                messages,
                stream: false,
                format: options.jsonMode ? 'json' : undefined
            },
            {
                timeout: options.timeout || 15000
            }
        );

        const latencyMs = Date.now() - startTime;
        const choice = response.data?.message?.content || '';

        return {
            text: choice,
            promptTokens: response.data?.prompt_eval_count || 0,
            completionTokens: response.data?.eval_count || 0,
            latencyMs,
            provider: this.name,
            model
        };
    }

    async health() {
        try {
            const res = await axios.get(`${this.host}/api/version`, { timeout: 2000 });
            return { ok: res.status === 200, provider: this.name };
        } catch (e) {
            return { ok: false, provider: this.name, error: e.message };
        }
    }
}

module.exports = OllamaProvider;
