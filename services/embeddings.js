require('dotenv').config();
const { fetchWithTimeout } = require('./network');
const usage = require('./usage');

const TIMEOUT_MS = 30000;

const MODEL = 'gemini-embedding-001';
const DIMENSIONS = 768;
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`;

const SAFETY_MARGIN = 0.85;
const TEXTS_PER_MINUTE = Math.floor((Number(process.env.EMBED_TEXTS_PER_MINUTE) || 100) * SAFETY_MARGIN);
const TOKENS_PER_MINUTE = Math.floor((Number(process.env.EMBED_TOKENS_PER_MINUTE) || 30000) * SAFETY_MARGIN);
const BATCH_SIZE = Math.min(100, TEXTS_PER_MINUTE);
const BATCH_TOKENS = Math.floor(TOKENS_PER_MINUTE / 2);
const CHARS_PER_TOKEN = 3;

const DAILY_TEXTS = Number(process.env.EMBED_TEXTS_PER_DAY) || 1000;
const CHAT_RESERVE = Number.isFinite(Number(process.env.EMBED_CHAT_RESERVE)) && process.env.EMBED_CHAT_RESERVE !== undefined
    ? Number(process.env.EMBED_CHAT_RESERVE) : 200;

const estimateTokens = (text) => Math.ceil(text.length / CHARS_PER_TOKEN);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DailyQuotaError extends Error {}

function retryDelayMs(body) {
    const seconds = Number(body.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1]);
    return Number.isFinite(seconds) ? (seconds + 1) * 1000 : null;
}

const sent = [];
async function throttle(count, tokens) {
    for (;;) {
        const now = Date.now();
        while (sent.length && now - sent[0].at > 60000) sent.shift();
        const usedTexts = sent.reduce((sum, s) => sum + s.count, 0);
        const usedTokens = sent.reduce((sum, s) => sum + s.tokens, 0);
        if (usedTexts + count <= TEXTS_PER_MINUTE && usedTokens + tokens <= TOKENS_PER_MINUTE) break;
        await sleep(60000 - (now - sent[0].at) + 100);
    }
    sent.push({ at: Date.now(), count, tokens });
}

function splitIntoBatches(texts) {
    const batches = [];
    let current = [];
    let currentTokens = 0;
    for (const text of texts) {
        const tokens = estimateTokens(text);
        if (current.length && (current.length >= BATCH_SIZE || currentTokens + tokens > BATCH_TOKENS)) {
            batches.push(current);
            current = [];
            currentTokens = 0;
        }
        current.push(text);
        currentTokens += tokens;
    }
    if (current.length) batches.push(current);
    return batches;
}

async function embedBatch(texts, taskType, { maxAttempts = 6, maxDelayMs = Infinity, source } = {}) {
    const body = {
        requests: texts.map((text) => ({
            model: `models/${MODEL}`,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: DIMENSIONS,
        })),
    };

    const tokens = texts.reduce((sum, text) => sum + estimateTokens(text), 0);
    for (let attempt = 1; ; attempt++) {
        await throttle(texts.length, tokens);
        const res = await fetchWithTimeout(URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
            body: JSON.stringify(body),
        }, { timeoutMs: TIMEOUT_MS, label: 'o Gemini' });
        if (res.ok) {
            const vectors = (await res.json()).embeddings.map((e) => e.values);
            await usage.record('gemini', source, texts.length);
            return vectors;
        }

        const text = await res.text();
        if (res.status === 429 && /PerDay/i.test(text)) {
            throw new DailyQuotaError('cota diária do Gemini esgotada; rode de novo amanhã');
        }
        if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
            const delay = retryDelayMs(text) ?? 5000 * 2 ** attempt;
            if (delay <= maxDelayMs) {
                await sleep(delay);
                continue;
            }
        }
        throw new Error(`Gemini ${res.status}: ${text}`);
    }
}

async function embedDocuments(texts, { source = usage.defaultSource() } = {}) {
    const vectors = [];
    for (const batch of splitIntoBatches(texts)) {
        const { total } = await usage.today('gemini');
        if (total + batch.length > DAILY_TEXTS - CHAT_RESERVE) {
            throw new DailyQuotaError(`${total} de ${DAILY_TEXTS} vetores do Gemini usados hoje; o resto fica para as buscas do chat (reserva de ${CHAT_RESERVE}). Rode de novo amanhã`);
        }
        vectors.push(...await embedBatch(batch, 'RETRIEVAL_DOCUMENT', { source }));
    }
    return vectors;
}

async function embedQuery(text) {
    const [vector] = await embedBatch([text], 'RETRIEVAL_QUERY', { maxAttempts: 2, maxDelayMs: 5000, source: 'chat' });
    return vector;
}

module.exports = { embedDocuments, embedQuery, DailyQuotaError, DIMENSIONS };
