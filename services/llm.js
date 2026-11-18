require('dotenv').config();
const { fetchWithTimeout } = require('./network');

const URL = 'https://api.groq.com/openai/v1/chat/completions';

const CHAT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
// Cada modelo da Groq tem a sua cota (no plano gratuito, 8 mil tokens por minuto e 1.000 requisições por dia cada).
// As chamadas de apoio de cada pergunta ficam em modelos diferentes para não disputarem a mesma cota:
// - PROFILE_MODEL: leitura do perfil, reescrita da pergunta e versões concorrentes (chamadas curtas);
// - RERANK_MODEL: nota de relevância dos candidatos, a chamada mais pesada (~3 mil tokens por pergunta).
const PROFILE_MODEL = process.env.GROQ_PROFILE_MODEL || 'openai/gpt-oss-20b';
const RERANK_MODEL = process.env.GROQ_RERANK_MODEL || 'qwen/qwen3.8-27b';
// Modelo da montagem do grafo. Divide a cota com o rerank, mas o grafo só lê documentos novos, uma vez por dia.
const GRAPH_MODEL = process.env.GROQ_GRAPH_MODEL || 'qwen/qwen3.8-27b';
const MAX_RETRY_DELAY_MS = 15000;
const TIMEOUT_MS = 45000;

// "try again in 15.7s" ou "try again in 1m2.5s"
function retryDelayMs(text) {
    const m = text.match(/try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
    return m ? (Number(m[1] || 0) * 60 + Number(m[2])) * 1000 + 250 : null;
}

// Esforço de raciocínio no formato de cada família: os gpt-oss aceitam low/medium/high; o Qwen aceita "none" para
// responder sem a etapa de raciocínio (as tarefas de apoio são de classificar, não de pensar).
function effortFor(model, wanted) {
    if (!wanted) return null;
    if (model.startsWith('openai/gpt-oss')) return wanted;
    if (model.startsWith('qwen/')) return 'none';
    return null;
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
                ...(effortFor(model, reasoningEffort) && { reasoning_effort: effortFor(model, reasoningEffort) }),
            }),
        }, { timeoutMs: TIMEOUT_MS, label: 'a Groq' });
        if (res.ok) {
            // Os gpt-oss às vezes gastam todos os tokens raciocinando e devolvem o conteúdo vazio: tenta de novo.
            const choice = (await res.json()).choices?.[0];
            // modelos que raciocinam em voz alta (Qwen) podem devolver <think>…</think> antes da resposta
            const content = choice?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '');
            if (content?.trim()) return content;
            if (attempt < maxAttempts) continue;
            throw new Error(`a Groq devolveu uma resposta vazia (${model}, finish_reason: ${choice?.finish_reason || 'desconhecido'})`);
        }

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

const isRateLimit = (err) => err instanceof DailyLimitError || /\bGroq 429\b|rate limit/i.test(err.message);

// A resposta ao estudante: tenta os modelos em ordem e passa para o próximo quando o atual está no limite da cota
// (o gpt-oss-120b aguenta ~1 resposta por minuto no plano gratuito: cada uma leva ~5.500 tokens de 8.000/min).
// Devolve { content, model } para a resposta registrar quem escreveu.
async function completeWithFallback(messages, models, options = {}) {
    let lastError;
    for (const model of [...new Set(models.filter(Boolean))]) {
        try {
            return { content: await complete(messages, { ...options, model }), model };
        } catch (err) {
            if (!isRateLimit(err)) throw err;
            console.error(`${model} no limite da cota; tentando o próximo modelo`);
            lastError = err;
        }
    }
    throw lastError;
}

const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b';

module.exports = { complete, completeWithFallback, CHAT_MODEL, FALLBACK_MODEL, PROFILE_MODEL, RERANK_MODEL, GRAPH_MODEL, DailyLimitError, effortFor };
