const Category = require('../models/Category');
const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const { extract } = require('./extractor');
const { chunk } = require('./chunker');
const { embedDocuments } = require('./embeddings');

const SUBJECT = /(?:Aprova|Dispõe sobre|Estabelece|Altera|Regulamenta|Institui|Normatiza|Define)\s[^.]{10,250}/;

function extractSubject(chunks) {
    const start = chunks.slice(0, 4).map((c) => c.content).join(' ');
    return start.match(SUBJECT)?.[0].replace(/\s+/g, ' ') || null;
}

async function ensureCategories(categories = []) {
    const bySlug = {};
    for (const c of categories) {
        bySlug[c.slug] = (await Category.findBySlug(c.slug)) || (await Category.create(c));
    }
    return bySlug;
}

// O mesmo arquivo em outra URL: guarda o endereço, para a sincronização não baixá-lo de novo, e a categoria
// de onde ele veio. Se a categoria for nova (ex.: publicado também no site da outra unidade), o grafo é refeito.
async function linkExisting(doc, sourceUrl, slugs = [], categoriesBySlug = {}) {
    if (sourceUrl) await Document.addSource(doc.id, sourceUrl);
    const current = new Set((await Document.getCategories(doc.id)).map((c) => c.slug));
    const added = slugs.filter((slug) => categoriesBySlug[slug] && !current.has(slug));
    for (const slug of added) await Document.addCategory(doc.id, categoriesBySlug[slug].id);
    if (added.length) await Document.resetGraph(doc.id);
    return `já existe (#${doc.id}), endereço guardado${added.length ? `, categoria ${added.join(', ')} acrescentada` : ''}`;
}

async function ingestDocument(entry, categoriesBySlug = {}) {
    const { pages, hash } = await extract(entry.source);
    const sourceUrl = entry.sourceUrl || (/^https?:\/\//i.test(entry.source) ? entry.source : null);

    const existing = await Document.findByHash(hash);
    if (existing) return linkExisting(existing, sourceUrl, entry.categories, categoriesBySlug);

    const chunks = chunk(pages);
    if (chunks.length === 0) throw new Error('nenhum texto extraído (PDF escaneado?)');
    const embeddings = await embedDocuments(chunks.map((c) => c.content));

    const doc = await Document.create({
        title: entry.title,
        docType: entry.docType,
        issuer: entry.issuer,
        number: entry.number,
        sourceUrl,
        publishedAt: entry.publishedAt,
        status: entry.status,
        subject: extractSubject(chunks),
        fileHash: hash,
    });
    try {
        if (sourceUrl) await Document.addSource(doc.id, sourceUrl);
        await Chunk.createMany(doc.id, chunks.map((c, i) => ({ ...c, embedding: embeddings[i] })));
        for (const slug of entry.categories || []) {
            if (!categoriesBySlug[slug]) throw new Error(`categoria não declarada: ${slug}`);
            await Document.addCategory(doc.id, categoriesBySlug[slug].id);
        }
        if (entry.replaces) {
            const old = await Document.findByNumber(entry.replaces.issuer, entry.replaces.number);
            if (!old) throw new Error(`documento substituído não encontrado: ${entry.replaces.issuer} ${entry.replaces.number}`);
            await Document.markReplaced(old.id, doc.id);
        }
    } catch (err) {
        await Document.remove(doc.id);
        throw err;
    }
    return `${chunks.length} trechos`;
}

module.exports = { ensureCategories, ingestDocument };
