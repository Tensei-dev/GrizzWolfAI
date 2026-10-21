require('dotenv').config();

const URL = 'https://api.groq.com/openai/v1/chat/completions';

const CHAT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const RERANK_MODEL = process.env.GROQ_RERANK_MODEL || 'openai/gpt-oss-20b';
const MAX_RETRY_DELAY_MS = 15000;

async function complete(messages, { model = CHAT_MODEL, temperature = 0.2, json = false, reasoningEffort = null } = {}) {
    for (let attempt = 1; ; attempt++) {
        const res = await fetch(URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            body: JSON.stringify({
                model,
                messages,
                temperature,
                ...(json && { response_format: { type: 'json_object' } }),
                ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
            }),
        });
        if (res.ok) return (await res.json()).choices[0].message.content;

        const text = await res.text();
        const waitSeconds = Number(text.match(/try again in (\d+(?:\.\d+)?)s/i)?.[1]);
        const delay = Number.isFinite(waitSeconds) ? waitSeconds * 1000 + 250 : 1500 * attempt;
        if ((res.status === 429 || res.status >= 500) && attempt < 3 && delay <= MAX_RETRY_DELAY_MS) {
            await new Promise((r) => setTimeout(r, delay));
            continue;
        }
        throw new Error(`Groq ${res.status}: ${text}`);
    }
}

module.exports = { complete, CHAT_MODEL, RERANK_MODEL };
