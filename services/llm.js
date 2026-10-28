require('dotenv').config();
const { fetchWithTimeout } = require('./network');

const URL = 'https://api.groq.com/openai/v1/chat/completions';

const CHAT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const RERANK_MODEL = process.env.GROQ_RERANK_MODEL || 'openai/gpt-oss-20b';
// Modelo da montagem do grafo: cada modelo da Groq tem a sua cota diária, e o grafo não pode gastar a do chat.
const GRAPH_MODEL = process.env.GROQ_GRAPH_MODEL || 'qwen/qwen3.8-27b';
const MAX_RETRY_DELAY_MS = 15000;
const TIMEOUT_MS = 45000;

// "try again in 15.7s" ou "try again in 1m2.5s"
function retryDelayMs(text) {
    const m = text.match(/try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
    return m ? (Number(m[1] || 0) * 60 + Number(m[2])) * 1000 + 250 : null;
}

// Os scripts em lote podem esperar mais pela cota (maxAttempts, maxRetryDelayMs); o chat não.
async function complete(messages, {
    model = CHAT_MODEL, temperature = 0.2, json = false, reasoningEffort = null,
    maxAttempts = 3, maxRetryDelayMs = MAX_RETRY_DELAY_MS,
} = {}) {
    for (let attempt = 1; ; attempt++) {
        const res = await fetchWithTimeout(URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            body: JSON.stringify({
                model,
                messages,
                temperature,
                ...(json && { response_format: { type: 'json_object' } }),
                ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
            }),
        }, { timeoutMs: TIMEOUT_MS, label: 'a Groq' });
        if (res.ok) return (await res.json()).choices[0].message.content;

        const text = await res.text();
        const delay = retryDelayMs(text) ?? 1500 * attempt;
        if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts && delay <= maxRetryDelayMs) {
            await new Promise((r) => setTimeout(r, delay));
            continue;
        }
        if (res.status === 429 && /tokens per day|requests per day|\(TPD\)|\(RPD\)/i.test(text)) {
            throw new DailyLimitError(`cota diária do modelo ${model} esgotada na Groq`);
        }
        throw new Error(`Groq ${res.status}: ${text}`);
    }
}

class DailyLimitError extends Error {}

module.exports = { complete, CHAT_MODEL, RERANK_MODEL, GRAPH_MODEL, DailyLimitError };
