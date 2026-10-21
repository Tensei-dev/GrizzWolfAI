const Chunk = require('../models/Chunk');
const { embedQuery } = require('./embeddings');
const { rerank } = require('./reranker');

const CANDIDATES_PER_SEARCH = 20;
const CANDIDATES_TO_RERANK = 12;
const RRF_K = 60;

function reciprocalRankFusion(lists) {
    const fused = new Map();
    for (const list of lists) {
        list.forEach((item, rank) => {
            const entry = fused.get(item.id) || { ...item, rrfScore: 0 };
            entry.rrfScore += 1 / (RRF_K + rank + 1);
            fused.set(item.id, entry);
        });
    }
    return [...fused.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

async function vectorSearch(text, categoryIds) {
    try {
        return await Chunk.searchVector(await embedQuery(text), { limit: CANDIDATES_PER_SEARCH, categoryIds });
    } catch (err) {
        console.error(`busca vetorial indisponível, usando só palavras-chave: ${err.message}`);
        return [];
    }
}

async function hybridSearch(question, { categoryIds = null, topK = 5, useRerank = true, profileText = null } = {}) {
    const [vectorResults, keywordResults] = await Promise.all([
        vectorSearch(profileText ? `${question}\nEstudante do ${profileText}` : question, categoryIds),
        Chunk.searchKeyword(question, { limit: CANDIDATES_PER_SEARCH, categoryIds }),
    ]);

    const fused = reciprocalRankFusion([vectorResults, keywordResults]).slice(0, CANDIDATES_TO_RERANK);
    if (!useRerank) return fused.slice(0, topK);
    return rerank(question, fused, { topK, profileText });
}

module.exports = { hybridSearch, reciprocalRankFusion };
