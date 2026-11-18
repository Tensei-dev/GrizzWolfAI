const Chunk = require('../models/Chunk');
const { embedQuery } = require('./embeddings');
const { rerank } = require('./reranker');
const { scopeFor, describeDocuments } = require('./knowledgeGraph');

const CANDIDATES_PER_SEARCH = 20;
const CANDIDATES_TO_RERANK = 12;
const MAX_PER_DOCUMENT = 4;
const MAX_NEWER_VERSIONS = 3;
const PAGE_CANDIDATES = 4;
const MAX_PAGES = 2;
const RERANK_FALLBACK = 3;
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

async function rankWithin(documentIds, searchText, embedding) {
    return reciprocalRankFusion(await searchBoth(searchText, embedding, { onlyIds: documentIds }));
}

async function coverCurricula(chunks, curriculumDocs, searchText, embedding) {
    const present = new Set(chunks.map((c) => c.document_id));
    const missing = curriculumDocs.filter((ids) => !ids.some((id) => present.has(id)));
    const extra = [];
    for (const ids of missing) {
        const [best] = await rankWithin(ids, searchText, embedding);
        if (best) extra.push(best);
    }
    return [...chunks.slice(0, 1), ...extra, ...chunks.slice(1)];
}

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
        const seen = new Set();
        for (const c of await rankWithin(newer, searchText, embedding)) {
            if (seen.has(c.document_id)) continue;
            seen.add(c.document_id);
            kept.push(c);
        }
        for (const [id, i] of await describeDocuments(newer)) info.set(id, i);
    }
    return kept.map((c) => ({ ...c, graph: info.get(c.document_id) || null }));
}

function diversify(fused, limit) {
    const perDocument = new Map();
    const chosen = [];
    for (const c of fused) {
        if (chosen.length >= limit) break;
        const n = perDocument.get(c.document_id) || 0;
        if (n >= MAX_PER_DOCUMENT) continue;
        perDocument.set(c.document_id, n + 1);
        chosen.push(c);
    }
    return chosen;
}

function pick(ranked, topK) {
    const chosen = [];
    const pages = new Set();
    for (const c of ranked) {
        if (chosen.length >= topK) break;
        const isPage = c.kind && c.kind !== 'norma';
        if (isPage && (pages.size >= MAX_PAGES || pages.has(c.document_id))) continue;
        if (isPage) pages.add(c.document_id);
        chosen.push(c);
    }
    return chosen;
}

async function hybridSearch(question, { categoryIds = null, topK = 5, useRerank = true, profile = null, originalQuestion = null } = {}) {
    const searchText = question;
    const profileText = profile?.text || null;
    const [embedding, scope] = await Promise.all([
        embed(profileText ? `${searchText}\nEstudante do ${profileText}` : searchText),
        scopeFor(profile, question),
    ]);

    const run = async (scoped) => {
        const excludeIds = scoped ? scope.excludeIds : null;
        const [lists, pageLists] = await Promise.all([
            searchBoth(searchText, embedding, { categoryIds, excludeIds }),
            searchBoth(searchText, embedding, { categoryIds, excludeIds, kinds: Chunk.PAGES }),
        ]);
        if (scoped && scope.focusIds.length) lists.push(...await searchBoth(searchText, embedding, { categoryIds, onlyIds: scope.focusIds }));
        let candidates = diversify(reciprocalRankFusion(lists), CANDIDATES_TO_RERANK);
        if (scoped && scope.curriculumDocs.length) candidates = await coverCurricula(candidates, scope.curriculumDocs, searchText, embedding);
        const pages = reciprocalRankFusion(pageLists).slice(0, PAGE_CANDIDATES);
        const fused = await withGraph([...candidates, ...pages], searchText, embedding);
        const ranked = useRerank ? await rerank(question, fused, { topK: Infinity, profileText, originalQuestion }) : fused;
        return { chosen: pick(ranked, topK), fused };
    };

    const fallback = (first) => {
        const norms = first.fused.filter((c) => c.kind === 'norma');
        if (norms.length) console.error('rerank não aprovou nenhum trecho; usando as normas mais bem colocadas na busca');
        return norms.slice(0, RERANK_FALLBACK);
    };

    if (!scope) {
        const result = await run(false);
        return result.chosen.length ? result.chosen : fallback(result);
    }
    const scoped = await run(true);
    if (scoped.chosen.length) return scoped.chosen;
    if (scope.excludeIds.length) {
        const all = await run(false);
        if (all.chosen.length) return all.chosen;
    }
    return fallback(scoped);
}

module.exports = { hybridSearch, reciprocalRankFusion, pick, diversify };
