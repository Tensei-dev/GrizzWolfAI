const { normalize } = require('./extractor');

const MAX_CHARS = 1200;
const OVERLAP_CHARS = 200;

// normas da UFU são organizadas em artigos: sempre começa um trecho novo
// num "Art." se o trecho atual já tiver conteúdo suficiente
const ARTICLE_START = /^Art\.?\s*\d+/i;
const MIN_CHARS_BEFORE_ARTICLE_BREAK = 400;

// pages: [{ num, text }] -> [{ content, page }]
function chunk(pages) {
    const chunks = [];
    let current = '';
    let currentPage = null;

    const flush = () => {
        if (current.trim()) chunks.push({ content: current.trim(), page: currentPage });
        // repete o fim do trecho anterior para não cortar o contexto no meio
        current = current.length > OVERLAP_CHARS ? current.slice(-OVERLAP_CHARS).replace(/^\S*\s/, '') : '';
    };

    for (const page of pages) {
        for (const paragraph of splitLong(normalize(page.text).split('\n'))) {
            if (!paragraph) continue;
            const startsArticle = ARTICLE_START.test(paragraph) && current.length >= MIN_CHARS_BEFORE_ARTICLE_BREAK;
            if (startsArticle || current.length + paragraph.length > MAX_CHARS) {
                flush();
                if (startsArticle) current = '';
            }
            if (!current) currentPage = page.num;
            current += (current ? '\n' : '') + paragraph;
        }
    }
    flush();
    return chunks;
}

// parágrafos maiores que MAX_CHARS são quebrados por frase
function splitLong(paragraphs) {
    const out = [];
    for (const p of paragraphs) {
        if (p.length <= MAX_CHARS) { out.push(p); continue; }
        let piece = '';
        for (const sentence of p.split(/(?<=[.;:])\s+/)) {
            if (piece && piece.length + sentence.length > MAX_CHARS) { out.push(piece); piece = ''; }
            piece += (piece ? ' ' : '') + sentence;
        }
        if (piece) out.push(piece);
    }
    return out;
}

module.exports = { chunk };
