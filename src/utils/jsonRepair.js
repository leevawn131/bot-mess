/**
 * Helper to safely extract and repair JSON from AI responses
 */
function parseAndRepairJSON(text) {
    if (!text || typeof text !== 'string') return null;

    let str = text.trim();

    // 1. Remove markdown backticks if present
    if (str.includes('```')) {
        const matches = str.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (matches && matches[1]) {
            str = matches[1].trim();
        } else {
            str = str.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        }
    }

    // 2. Extract first '{' to last '}'
    const startIdx = str.indexOf('{');
    const endIdx = str.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
        str = str.substring(startIdx, endIdx + 1);
    }

    // 3. First attempt standard JSON.parse
    try {
        return JSON.parse(str);
    } catch (e) {
        // Fallback repair steps
    }

    // 4. Basic repair regex heuristics
    try {
        let repaired = str
            // Remove trailing commas before } or ]
            .replace(/,\s*([}\]])/g, '$1')
            // Fix unescaped newlines in multi-line strings
            .replace(/(?<=:\s*"[^"]*)\n(?=[^"]*")/g, '\\n');

        return JSON.parse(repaired);
    } catch (err) {
        return null;
    }
}

module.exports = {
    parseAndRepairJSON
};
