require('dotenv').config();

const MODEL = 'gemini-embedding-001';
const DIMENSIONS = 768;
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`;

const TEXTS_PER_MINUTE = Number(process.env.EMBED_TEXTS_PER_MINUTE) || 80;
const BATCH_SIZE = Math.min(100, TEXTS_PER_MINUTE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DailyQuotaError extends Error {}

function retryDelayMs(body) {
    const seconds = Number(body.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1]);
    return Number.isFinite(seconds) ? (seconds + 1) * 1000 : null;
}

const sent = [];
async function throttle(count) {
    for (;;) {
        const now = Date.now();
        while (sent.length && now - sent[0].at > 60000) sent.shift();
        const used = sent.reduce((sum, s) => sum + s.count, 0);
        if (used + count <= TEXTS_PER_MINUTE) break;
        await sleep(60000 - (now - sent[0].at) + 100);
    }
    sent.push({ at: Date.now(), count });
}

async function embedBatch(texts, taskType, { maxAttempts = 6, maxDelayMs = Infinity } = {}) {
    const body = {
        requests: texts.map((text) => ({
            model: `models/${MODEL}`,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: DIMENSIONS,
        })),
    };

    for (let attempt = 1; ; attempt++) {
        await throttle(texts.length);
        const res = await fetch(URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
            body: JSON.stringify(body),
        });
        if (res.ok) return (await res.json()).embeddings.map((e) => e.values);

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

async function embedDocuments(texts) {
    const vectors = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        vectors.push(...await embedBatch(texts.slice(i, i + BATCH_SIZE), 'RETRIEVAL_DOCUMENT'));
    }
    return vectors;
}

async function embedQuery(text) {
    const [vector] = await embedBatch([text], 'RETRIEVAL_QUERY', { maxAttempts: 2, maxDelayMs: 5000 });
    return vector;
}

module.exports = { embedDocuments, embedQuery, DailyQuotaError, DIMENSIONS };
