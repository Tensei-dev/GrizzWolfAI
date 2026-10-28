const pool = require('../db/pool');
const Graph = require('../models/KnowledgeGraph');
const { ensureTaxonomy, buildDocument, normalizeNumber } = require('../services/knowledgeGraph');

async function main() {
    const rebuild = process.argv.includes('--rebuild');
    const useLlm = !process.argv.includes('--rules-only') && Boolean(process.env.GROQ_API_KEY);
    if (!useLlm) console.log('montando o grafo só com as regras (sem GROQ_API_KEY ou com --rules-only)');

    const taxonomy = await ensureTaxonomy();
    const all = await Graph.findDocuments({ onlyPending: false });
    const docsByNumber = new Map();
    for (const d of all) {
        const n = normalizeNumber(d.number);
        if (n) docsByNumber.set(n, [...(docsByNumber.get(n) || []), d]);
    }

    const pending = rebuild ? all : all.filter((d) => !d.graph_built_at);
    console.log(`${all.length} documentos no acervo, ${pending.length} para mapear`);

    let failures = 0;
    for (const doc of pending) {
        try {
            const r = await buildDocument(doc, { taxonomy, docsByNumber, useLlm });
            console.log(`ok    #${doc.id} ${doc.title.slice(0, 90)}: ${r.edges} ligações, ${r.references} normas relacionadas${r.llm ? '' : ' (só regras)'}`);
        } catch (err) {
            failures++;
            console.error(`falha #${doc.id} ${doc.title}: ${err.message}`);
        }
    }
    if (failures) process.exitCode = 1;
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
