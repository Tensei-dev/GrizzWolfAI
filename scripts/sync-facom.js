// importa os PDFs novos da aba Documentos do site da FACOM
// uso: npm run sync:facom            (importa)
//      npm run sync:facom -- --dry-run  (só lista o que seria importado)
const pool = require('../db/pool');
const Document = require('../models/Document');
const { crawl, shouldSkip, toEntry } = require('../services/facomCrawler');
const { ensureCategories, ingestDocument } = require('../services/ingestion');
const { DailyQuotaError } = require('../services/embeddings');

const CATEGORIES = [{ slug: 'facom', name: 'FACOM', description: 'Documentos publicados no site da FACOM' }];

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    if (!dryRun && !process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não definida no .env');

    const items = await crawl();
    const titleCount = {};
    for (const item of items) titleCount[item.title] = (titleCount[item.title] || 0) + 1;

    const pending = [];
    let skipped = 0;
    for (const item of items) {
        if (shouldSkip(item)) { skipped++; continue; }
        if (await Document.findBySourceUrl(item.fileUrl)) continue;
        pending.push(toEntry(item, titleCount[item.title]));
    }
    console.log(`${items.length} arquivos na listagem, ${skipped} ignorados pelos filtros, ${pending.length} novos`);

    if (dryRun) {
        for (const e of pending) console.log(`- [${e.docType}] ${e.title} (${e.number || 's/ nº'}, ${e.publishedAt})`);
        return;
    }

    const categoriesBySlug = await ensureCategories(CATEGORIES);
    let failures = 0;
    for (const entry of pending) {
        try {
            console.log(`ok    ${entry.title}: ${await ingestDocument(entry, categoriesBySlug)}`);
        } catch (err) {
            failures++;
            console.error(`falha ${entry.title}: ${err.message}`);
            if (err instanceof DailyQuotaError) break; // os próximos falhariam do mesmo jeito
        }
    }
    if (failures) process.exitCode = 1;
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
