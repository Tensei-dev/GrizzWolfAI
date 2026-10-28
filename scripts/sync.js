const pool = require('../db/pool');
const Document = require('../models/Document');
const { UNITS, crawl, shouldSkip, toEntry } = require('../services/unitCrawler');
const { ensureCategories, ingestDocument } = require('../services/ingestion');
const { DailyQuotaError } = require('../services/embeddings');

async function syncUnit(unitId, { dryRun }) {
    const items = await crawl(unitId);
    const titleCount = {};
    for (const item of items) titleCount[item.title] = (titleCount[item.title] || 0) + 1;

    const pending = [];
    const seen = new Set();
    let skipped = 0;
    for (const item of items) {
        if (shouldSkip(unitId, item)) { skipped++; continue; }
        if (seen.has(item.fileUrl) || await Document.findBySourceUrl(item.fileUrl)) continue;
        seen.add(item.fileUrl);
        pending.push(toEntry(unitId, item, titleCount[item.title]));
    }
    console.log(`[${unitId}] ${items.length} arquivos na listagem, ${skipped} ignorados pelos filtros, ${pending.length} novos`);

    if (dryRun) {
        for (const e of pending) console.log(`- [${e.docType}] ${e.title} (${e.issuer} ${e.number || 's/ nº'}, ${e.publishedAt})`);
        return 0;
    }

    const categoriesBySlug = await ensureCategories([UNITS[unitId].category]);
    let failures = 0;
    for (const entry of pending) {
        try {
            console.log(`ok    ${entry.title}: ${await ingestDocument(entry, categoriesBySlug)}`);
        } catch (err) {
            failures++;
            console.error(`falha ${entry.title}: ${err.message}`);
            if (err instanceof DailyQuotaError) throw err;
        }
    }
    return failures;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    if (!dryRun && !process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não definida no .env');

    const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    const unitIds = requested.length ? requested : Object.keys(UNITS);

    let failures = 0;
    for (const unitId of unitIds) {
        try {
            failures += await syncUnit(unitId, { dryRun });
        } catch (err) {
            failures++;
            console.error(`[${unitId}] ${err.message}`);
            if (err instanceof DailyQuotaError) break;
        }
    }
    if (failures) process.exitCode = 1;
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
