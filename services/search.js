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

// Os trechos mais relevantes para a pergunta dentro de um conjunto de documentos, do melhor para o pior.
async function rankWithin(documentIds, searchText, embedding) {
    return reciprocalRankFusion(await searchBoth(searchText, embedding, { onlyIds: documentIds }));
}

// Sem saber o currículo do estudante, cada currículo possível precisa aparecer na lista: se a busca só trouxe
// a grade 2023-1, o Grizz não teria como mostrar a diferença para a 2010-2. Entra o melhor trecho de cada um que faltou.
async function coverCurricula(chunks, curriculumDocs, searchText, embedding) {
    const present = new Set(chunks.map((c) => c.document_id));
    const missing = curriculumDocs.filter((ids) => !ids.some((id) => present.has(id)));
    const extra = [];
    for (const ids of missing) {
        const [best] = await rankWithin(ids, searchText, embedding);
        if (best) extra.push(best);
    }
    // Logo depois do primeiro: o rerank reordena tudo, mas se ele falhar a busca fica com os primeiros da lista.
    return [...chunks.slice(0, 1), ...extra, ...chunks.slice(1)];
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

// question é a pergunta completa (reescrita); originalQuestion, o que o estudante digitou, só ajuda o rerank.
async function hybridSearch(question, { categoryIds = null, topK = 5, useRerank = true, profile = null, originalQuestion = null } = {}) {
    const searchText = question;
    const profileText = profile?.text || null;
    const [embedding, scope] = await Promise.all([
        embed(profileText ? `${searchText}\nEstudante do ${profileText}` : searchText),
        scopeFor(profile, question),
    ]);

    const run = async (scoped) => {
        const lists = await searchBoth(searchText, embedding, { categoryIds, excludeIds: scoped ? scope.excludeIds : null });
        if (scoped && scope.focusIds.length) lists.push(...await searchBoth(searchText, embedding, { categoryIds, onlyIds: scope.focusIds }));
        let candidates = reciprocalRankFusion(lists).slice(0, CANDIDATES_TO_RERANK);
        if (scoped && scope.curriculumDocs.length) candidates = await coverCurricula(candidates, scope.curriculumDocs, searchText, embedding);
        const fused = await withGraph(candidates, searchText, embedding);
        if (!useRerank) return fused.slice(0, topK);
        return rerank(question, fused, { topK, profileText, originalQuestion });
    };

    if (!scope) return run(false);
    const results = await run(true);
    // Nada do curso do estudante respondeu: busca no acervo todo, e o prompt manda deixar claro de qual curso é a regra.
    if (results.length === 0 && scope.excludeIds.length) return run(false);
    return results;
}

module.exports = { hybridSearch, reciprocalRankFusion };
