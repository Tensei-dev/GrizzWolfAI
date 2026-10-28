const Chunk = require('../models/Chunk');
const { embedQuery } = require('./embeddings');
const { rerank } = require('./reranker');
const { scopeFor, describeDocuments } = require('./knowledgeGraph');

const CANDIDATES_PER_SEARCH = 20;
const CANDIDATES_TO_RERANK = 12;
const MAX_NEWER_VERSIONS = 3;
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

async function embed(text) {
    try {
        return await embedQuery(text);
    } catch (err) {
        console.error(`busca vetorial indisponível, usando só palavras-chave: ${err.message}`);
        return null;
    }
}

function searchBoth(searchText, embedding, filters) {
    return Promise.all([
        embedding ? Chunk.searchVector(embedding, { limit: CANDIDATES_PER_SEARCH, ...filters }) : [],
        Chunk.searchKeyword(searchText, { limit: CANDIDATES_PER_SEARCH, ...filters }),
    ]);
}

// Anota cada trecho com o que o grafo sabe do documento. Trechos de normas revogadas saem, e as normas
// que alteraram ou revogaram um documento encontrado entram na lista, para o Grizz usar a versão mais nova.
async function withGraph(chunks, searchText, embedding) {
    let info;
    try {
        info = await describeDocuments(chunks.map((c) => c.document_id));
    } catch (err) {
        console.error(`grafo de conhecimento indisponível, seguindo sem anotações: ${err.message}`);
        return chunks;
    }

    const kept = chunks.filter((c) => !info.get(c.document_id)?.revokedBy.length);
    const present = new Set(kept.map((c) => c.document_id));
    const newer = [...new Set([...info.values()].flatMap((i) => [...i.alteredBy, ...i.revokedBy].map((d) => d.documentId)))]
        .filter((id) => !present.has(id))
        .slice(0, MAX_NEWER_VERSIONS);

    if (newer.length) {
        const [vector, keyword] = await searchBoth(searchText, embedding, { onlyIds: newer });
        const seen = new Set();
        for (const c of reciprocalRankFusion([vector, keyword])) {
            if (seen.has(c.document_id)) continue;
            seen.add(c.document_id);
            kept.push(c);
        }
        for (const [id, i] of await describeDocuments(newer)) info.set(id, i);
    }
    return kept.map((c) => ({ ...c, graph: info.get(c.document_id) || null }));
}

async function hybridSearch(question, { categoryIds = null, topK = 5, useRerank = true, profile = null, previousMessages = [] } = {}) {
    const searchText = [...previousMessages, question].join('\n');
    const profileText = profile?.text || null;
    const [embedding, scope] = await Promise.all([
        embed(profileText ? `${searchText}\nEstudante do ${profileText}` : searchText),
        scopeFor(profile, question),
    ]);

    const run = async (scoped) => {
        const lists = await searchBoth(searchText, embedding, { categoryIds, excludeIds: scoped ? scope.excludeIds : null });
        if (scoped && scope.focusIds.length) lists.push(...await searchBoth(searchText, embedding, { categoryIds, onlyIds: scope.focusIds }));
        const fused = await withGraph(reciprocalRankFusion(lists).slice(0, CANDIDATES_TO_RERANK), searchText, embedding);
        if (!useRerank) return fused.slice(0, topK);
        return rerank(question, fused, { topK, profileText, previousMessages });
    };

    if (!scope) return run(false);
    const results = await run(true);
    // Nada do curso do estudante respondeu: busca no acervo todo, e o prompt manda deixar claro de qual curso é a regra.
    if (results.length === 0 && scope.excludeIds.length) return run(false);
    return results;
}

module.exports = { hybridSearch, reciprocalRankFusion };
