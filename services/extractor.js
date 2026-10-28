require('./hostOverrides');
const fs = require('fs/promises');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { PDFParse } = require('pdf-parse');
const { ocrPdf } = require('./ocr');
const { NetworkError, fetchWithTimeout } = require('./network');

const MIN_CHARS_PER_PAGE = 50;

function textLength(pages) {
    return pages.reduce((sum, p) => sum + p.text.trim().length, 0);
}

const CONTENT_SELECTORS = ['.field-name-body', 'main', '[role=main]', '.region-content', 'article'];

async function fromPdfBuffer(buffer) {
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        let pages = result.pages.map((p) => ({ num: p.num, text: p.text }));
        if (textLength(pages) < MIN_CHARS_PER_PAGE * pages.length) pages = await ocrPdf(parser);
        return { pages, hash: sha256(normalize(pages.map((p) => p.text).join('\n'))) };
    } finally {
        await parser.destroy();
    }
}

function fromHtml(html) {
    const $ = cheerio.load(html);
    $('script, style, noscript, nav, header, footer, aside, form, iframe').remove();
    $('#barra-brasil, .compartilhar, .social, .widgets').remove();

    const root = $(CONTENT_SELECTORS.find((s) => $(s).length) || 'body').first();
    root.find('p, div, li, h1, h2, h3, h4, h5, h6, tr, br').each((_, el) => { $(el).append('\n'); });
    const text = root.text();

    return { pages: [{ num: null, text }], hash: sha256(normalize(text)) };
}

const DOWNLOAD_TIMEOUT_MS = 60000;

// O tempo limite do fetch também corta a leitura do corpo; aqui o erro vira NetworkError com o nome do arquivo.
async function readBody(res, source, isPdf) {
    try {
        return isPdf ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (err) {
        throw new NetworkError(`o download de ${source} foi interrompido (${err.name === 'TimeoutError' ? 'tempo esgotado' : err.message})`);
    }
}

async function extract(source) {
    if (/^https?:\/\//i.test(source)) {
        const res = await fetchWithTimeout(
            source,
            { headers: { 'User-Agent': 'GrizzWolfAI/1.0 (+https://github.com/Tensei-dev/GrizzWolfAI)' } },
            { timeoutMs: DOWNLOAD_TIMEOUT_MS }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${source}`);
        const type = res.headers.get('content-type') || '';
        const body = await readBody(res, source, type.includes('pdf') || /\.pdf($|\?)/i.test(source));
        return Buffer.isBuffer(body) ? fromPdfBuffer(body) : fromHtml(body);
    }

    const buffer = await fs.readFile(source);
    if (/\.pdf$/i.test(source)) return fromPdfBuffer(buffer);
    if (/\.html?$/i.test(source)) return fromHtml(buffer.toString('utf8'));
    throw new Error(`formato não suportado: ${source}`);
}

function normalize(text) {
    return text
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/(\s*\.){4,}\s*/g, ' … ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
}

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

module.exports = { extract, normalize };
