const fs = require('fs');
const path = require('path');
const { runAiConversation } = require('../../utils/aiAssistant');

const CONFIG_PATH = path.resolve(__dirname, '../../../config.json');
const DEFAULT_OLLAMA_MODEL = 'llama3:latest';

function loadAiConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            return {};
        }

        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return config.ai || {};
    } catch (error) {
        console.error('Không thể đọc cấu hình AI:', error);
        return {};
    }
}

module.exports = {
    name: "ai",
    description: "Chat AI",
    usage : "\nDùng AI local Ollama (mặc định model llama3:latest).\n!ai [câu hỏi]\n!ai -m [tên_model_ollama] [câu hỏi]",
    execute: async ({ api, event, args }) => {
        const threadID = String(event.threadID); // Ép kiểu chuỗi để tránh lỗi
        const displayLabel = 'AI local';
        const aiConfig = loadAiConfig();
        const defaultModel = process.env.OLLAMA_MODEL || aiConfig.model || DEFAULT_OLLAMA_MODEL;

        let model = defaultModel;
        let queryArgs = args;

        if (args[0] === '-m' || args[0] === '--model') {
            model = args[1] || defaultModel;
            queryArgs = args.slice(2);
        } else if (args[0] && args[0].startsWith('--model=')) {
            model = args[0].slice('--model='.length) || defaultModel;
            queryArgs = args.slice(1);
        }

        let query = queryArgs.join(" ").trim();

        if (!query) return api.sendMessage("🤖 Nhập câu hỏi đi bạn.\nVD: !ai Kể chuyện ma", threadID);

        api.sendMessage(`🔍 ${displayLabel} đang suy nghĩ...`, threadID);

        const result = await runAiConversation({
            api,
            event,
            query,
            source: 'manual',
            modelOverride: model,
        });

        if (result.ok && result.answer) {
            return api.sendMessage(`🤖 [${displayLabel}]:\n━━━━━━━━━━━━━━━━━━\n${result.answer}`, threadID);
        }

        if (result.reason === 'cooldown' && result.errorMessage) {
            return api.sendMessage(result.errorMessage, threadID);
        }

        if (result.errorMessage) {
            return api.sendMessage(result.errorMessage, threadID);
        }

        return api.sendMessage(`❌ Không xử lý được yêu cầu AI.`, threadID);
    }
};