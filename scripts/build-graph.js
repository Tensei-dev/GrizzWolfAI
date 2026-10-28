const pool = require('../db/pool');
const Graph = require('../models/KnowledgeGraph');
const { ensureTaxonomy, buildDocument, rebuildRuleReferences, normalizeNumber } = require('../services/knowledgeGraph');
const { GRAPH_MODEL, DailyLimitError } = require('../services/llm');
const { UNITS } = require('../services/courses');

// Documentos lidos pelo modelo por rodada; o resto fica para a próxima. Mude com --limit N ou GRAPH_MAX_DOCS.
const DEFAULT_LIMIT = 80;

function readLimit() {
    const arg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1];
    const limit = Number(arg ?? process.env.GRAPH_MAX_DOCS ?? DEFAULT_LIMIT);
    return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
}

async function main() {
    const rebuild = process.argv.includes('--rebuild');
    const useLlm = !process.argv.includes('--rules-only') && Boolean(process.env.GROQ_API_KEY);
    if (rebuild && !useLlm) throw new Error('--rebuild sem o modelo apagaria as ligações lidas por ele; rode com GROQ_API_KEY');
    console.log(useLlm ? `lendo os documentos com ${GRAPH_MODEL}` : 'montando o grafo só com as regras (sem GROQ_API_KEY ou com --rules-only)');

    const taxonomy = await ensureTaxonomy();
    const all = await Graph.findDocuments({ onlyPending: false });
    const docsByNumber = new Map();
    for (const d of all) {
        // Só as categorias que são unidades (facom, ime) contam; a primeira define os cursos que o modelo vê.
        d.units = d.units.filter((slug) => UNITS[slug]);
        d.unit = d.units[0] || null;
        const n = normalizeNumber(d.number);
        if (n) docsByNumber.set(n, [...(docsByNumber.get(n) || []), d]);
    }

    if (process.argv.includes('--references')) return rebuildReferences(all, docsByNumber);

    const candidates = rebuild ? all : all.filter((d) => !d.graph_built_at);
    const pending = useLlm ? candidates.slice(0, readLimit()) : candidates;
    console.log(`${all.length} documentos no acervo, ${candidates.length} para mapear, ${pending.length} nesta rodada`);

    let failures = 0;
    for (const doc of pending) {
        try {
            const r = await buildDocument(doc, { taxonomy, docsByNumber, useLlm });
            console.log(`ok    #${doc.id} ${doc.title.slice(0, 90)}: ${r.edges} ligações, ${r.references} normas relacionadas${r.llm ? '' : ' (só regras)'}`);
            for (const t of r.revoked) console.log(`      revogou #${t.id} ${t.title.slice(0, 90)} (confirmado pelas regras e pelo LLM)`);
        } catch (err) {
            failures++;
            console.error(`falha #${doc.id} ${doc.title}: ${err.message}`);
            if (err instanceof DailyLimitError) break;
        }
    }
    if (failures) process.exitCode = 1;
}

// --references: refaz as referências entre normas de todos os documentos só pelas regras, sem gastar cota do LLM.
async function rebuildReferences(all, docsByNumber) {
    console.log(`refazendo as referências entre normas de ${all.length} documentos (só regras)`);
    let total = 0;
    for (const doc of all) {
        try {
            total += await rebuildRuleReferences(doc, { docsByNumber });
        } catch (err) {
            process.exitCode = 1;
            console.error(`falha #${doc.id} ${doc.title}: ${err.message}`);
        }
    }
    console.log(`${total} referências entre normas`);
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
