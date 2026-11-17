const { normalize } = require('./extractor');

const MAX_CHARS = 1200;
const OVERLAP_CHARS = 200;

const ARTICLE_START = /^Art\.?\s*\d+/i;
const MIN_CHARS_BEFORE_ARTICLE_BREAK = 400;

function chunk(pages) {
    const chunks = [];
    let current = '';
    let currentPage = null;

    const flush = () => {
        if (current.trim()) chunks.push({ content: current.trim(), page: currentPage });
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

// Páginas dos sites (Markdown do pacote OKF): o corte é nos títulos de seção, não nos artigos. Cada trecho
// leva no heading o título da página e o caminho de seções ("Perguntas frequentes › O que é ENADE?"),
// que entra na busca por palavras-chave com peso maior.
const HEADING = /^(#{1,6})\s+(.*)$/;

function chunkMarkdown(markdown, title) {
    const chunks = [];
    const trail = [];
    let current = '';
    const heading = () => [title, ...trail.filter(Boolean)].join(' › ');
    let currentHeading = heading();

    const flush = (keepOverlap) => {
        if (current.trim()) chunks.push({ content: current.trim(), heading: currentHeading });
        current = keepOverlap && current.length > OVERLAP_CHARS ? current.slice(-OVERLAP_CHARS).replace(/^\S*\s/, '') : '';
    };

    const lines = markdown
        .replace(/\[([^\]]*)\]\([^)\s]+\.md\)/g, '$1') // links internos do pacote: só o texto
        .split('\n');
    for (const line of splitLong(lines)) {
        const h = line.match(HEADING);
        if (h) {
            if (h[1].length === 1) continue; // o "# título" da página já está no heading
            flush(false);
            trail.length = h[1].length - 2;
            trail.push(h[2].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim());
            currentHeading = heading();
            continue;
        }
        if (!line.trim()) { if (current && !current.endsWith('\n\n')) current += '\n'; continue; }
        if (current.length + line.length > MAX_CHARS) flush(true);
        current += (current && !current.endsWith('\n') ? '\n' : '') + line;
    }
    flush(false);
    // Página só de títulos ("Núcleos" → "## Núcleo de Estatística", ...): a lista dos títulos é o conteúdo. Sem isso,
    // ela não gerava nenhum trecho e ficava pendente na importação para sempre.
    if (!chunks.length) {
        const titles = lines
            .map((l) => l.match(HEADING))
            .filter((h) => h && h[1].length > 1)
            .map((h) => h[2].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim())
            .filter(Boolean);
        if (titles.length) chunks.push({ content: titles.map((t) => `- ${t}`).join('\n'), heading: title });
    }
    return chunks;
}

module.exports = { chunk, chunkMarkdown };
