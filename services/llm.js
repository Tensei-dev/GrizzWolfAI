require('dotenv').config();

const URL = 'https://api.groq.com/openai/v1/chat/completions';

// modelos configuráveis pelo .env; a lista de modelos da Groq muda com frequência
// (lista atual: GET https://api.groq.com/openai/v1/models)
const CHAT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const RERANK_MODEL = process.env.GROQ_RERANK_MODEL || 'openai/gpt-oss-20b';

// messages: [{ role: 'system' | 'user' | 'assistant', content }]
// reasoningEffort: 'low' | 'medium' | 'high', para os modelos que raciocinam antes de responder
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

        // 429 = limite do plano gratuito; espera e tenta de novo
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
            await new Promise((r) => setTimeout(r, 1500 * attempt));
            continue;
        }
        throw new Error(`Groq ${res.status}: ${await res.text()}`);
    }
}

module.exports = { complete, CHAT_MODEL, RERANK_MODEL };
