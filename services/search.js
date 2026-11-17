const Chunk = require('../models/Chunk');
const { embedQuery } = require('./embeddings');
const { rerank } = require('./reranker');
const { scopeFor, describeDocuments } = require('./knowledgeGraph');

const CANDIDATES_PER_SEARCH = 20;
const CANDIDATES_TO_RERANK = 12;
const MAX_NEWER_VERSIONS = 3;
const PAGE_CANDIDATES = 4; // trechos de páginas dos sites que vão ao rerank junto com os das normas
const MAX_PAGES = 2; // trechos de páginas na resposta, no máximo
const RERANK_FALLBACK = 3; // trechos de normas usados quando o rerank não aprova nenhum
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

// Os melhores trechos na ordem do rerank, com no máximo MAX_PAGES de páginas dos sites: a resposta continua
// apoiada nas normas, e as páginas completam com contatos, procedimentos e avisos.
// Um trecho por página: duas vagas para a mesma página (a da ASCII) deixavam outra igualmente boa (a da TechMob) de fora.
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

// question é a pergunta completa (reescrita); originalQuestion, o que o estudante digitou, só ajuda o rerank.
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
            // as páginas dos sites têm lista e cota próprias, para não tirarem as normas do rerank
            searchBoth(searchText, embedding, { categoryIds, excludeIds, kinds: Chunk.PAGES }),
        ]);
        if (scoped && scope.focusIds.length) lists.push(...await searchBoth(searchText, embedding, { categoryIds, onlyIds: scope.focusIds }));
        let candidates = reciprocalRankFusion(lists).slice(0, CANDIDATES_TO_RERANK);
        if (scoped && scope.curriculumDocs.length) candidates = await coverCurricula(candidates, scope.curriculumDocs, searchText, embedding);
        const pages = reciprocalRankFusion(pageLists).slice(0, PAGE_CANDIDATES);
        const fused = await withGraph([...candidates, ...pages], searchText, embedding);
        const ranked = useRerank ? await rerank(question, fused, { topK: Infinity, profileText, originalQuestion }) : fused;
        return { chosen: pick(ranked, topK), fused };
    };

    // O rerank às vezes dá nota baixa a tudo, até a trechos que respondem (visto na carga horária de estágio):
    // em vez de responder "não encontrei", vão as normas mais bem colocadas na busca (do curso do estudante, se houver),
    // e o modelo julga se elas respondem. Só depois de tentar o acervo todo.
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
    // Nada do curso do estudante respondeu: busca no acervo todo, e o prompt manda deixar claro de qual curso é a regra.
    if (scope.excludeIds.length) {
        const all = await run(false);
        if (all.chosen.length) return all.chosen;
    }
    return fallback(scoped);
}

module.exports = { hybridSearch, reciprocalRankFusion };
