const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { ensureCategories, ingestDocument } = require('../services/ingestion');
const { DailyQuotaError } = require('../services/embeddings');

async function main() {
    const file = process.argv[2];
    if (!file) throw new Error('informe o arquivo de fontes: npm run ingest -- data/sources.json');
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não definida no .env');

    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const categoriesBySlug = await ensureCategories(manifest.categories);
    let failures = 0;

    for (const entry of manifest.documents) {
        const source = /^https?:\/\//i.test(entry.source) ? entry.source : path.resolve(path.dirname(file), entry.source);
        try {
            console.log(`ok    ${entry.title}: ${await ingestDocument({ ...entry, source }, categoriesBySlug)}`);
        } catch (err) {
            failures++;
            console.error(`falha ${entry.title}: ${err.message}`);
            if (err instanceof DailyQuotaError) break;
        }
    }
    if (failures) process.exitCode = 1;
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
