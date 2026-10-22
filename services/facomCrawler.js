require('./hostOverrides');
const cheerio = require('cheerio');

const BASE_URL = 'https://facom.ufu.br';
const LISTING_URL = `${BASE_URL}/central-de-conteudos/documentos`;

const SKIP_TITLES = [
    /memoria(l|is)/i,
    /progress[aã]o funcional/i,
    /plano de trabalho docente/i,
    /concurso p[uú]blico/i,
    /professores substitutos/i,
    /redistribui[cç][aã]o/i,
    /elei[cç][oõ]es/i,
    /prorroga[cç][aã]o do prazo de validade/i,
    /^luto$/i,
    /congress/i,
    /guia da faculdade/i,
];
const SKIP_FILES = [/portaria_de_pessoal/i];

const DOC_TYPES = [
    [/^resolu[cç][aã]o/i, 'resolução'],
    [/^portaria/i, 'portaria'],
    [/^edital/i, 'edital'],
    [/^ata\b/i, 'ata'],
    [/^regimento/i, 'regimento'],
    [/^normas?\b/i, 'norma'],
    [/^calend[aá]rio/i, 'calendário'],
    [/^tcc\b/i, 'modelo'],
];

const HEADERS = { 'User-Agent': 'GrizzWolfAI/1.0 (+https://github.com/Tensei-dev/GrizzWolfAI)' };
const DELAY_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NETWORK_ATTEMPTS = 3;

async function fetchPage(url) {
    for (let attempt = 1; ; attempt++) {
        let res;
        try {
            res = await fetch(url, { headers: HEADERS });
        } catch (err) {
            if (attempt < NETWORK_ATTEMPTS) {
                await sleep(10000 * attempt);
                continue;
            }
            const cause = err.cause?.code || err.cause?.message || err.message;
            throw new Error(`não consegui acessar o site da FACOM (${cause}); ele pode estar fora do ar, tente mais tarde`);
        }
        if (res.ok) return res.text();
        if ([403, 429, 503].includes(res.status) && attempt < 4) {
            await sleep(30000 * attempt);
            continue;
        }
        throw new Error(`HTTP ${res.status} em ${url}`);
    }
}

async function fetchListingPage(page) {
    const $ = cheerio.load(await fetchPage(`${LISTING_URL}?page=${page}`));

    const items = [];
    $('.region-content .views-row').each((_, row) => {
        const title = $(row).find('h3.titulo').text().trim().replace(/\s+/g, ' ');
        const date = $(row).find('.info-lateral li').first().text().trim();
        const [d, m, y] = date.split('/');

        $(row).find('.linha-fina a[href]').each((_, a) => {
            items.push({
                title,
                fileName: $(a).text().trim(),
                fileUrl: new URL($(a).attr('href'), BASE_URL).href,
                publishedAt: y ? `${y}-${m}-${d}` : null,
            });
        });
    });
    return items;
}

async function crawl() {
    const all = [];
    for (let page = 0; ; page++) {
        const items = await fetchListingPage(page);
        if (items.length === 0) break;
        all.push(...items);
        await sleep(DELAY_MS);
    }
    return all;
}

function shouldSkip(item) {
    if (!/\.pdf($|\?)/i.test(item.fileUrl)) return true;
    return SKIP_TITLES.some((r) => r.test(item.title)) || SKIP_FILES.some((r) => r.test(item.fileName));
}

function toEntry(item, siblings) {
    const number = item.title.match(/n[º°o.]\s*([\d.]+\/\d{4})/i)?.[1] || null;
    const docType = DOC_TYPES.find(([r]) => r.test(item.title))?.[1] || 'documento';
    const issuer = /conselho da faculdade de computa[cç][aã]o/i.test(item.title) ? 'CONFACOM' : 'FACOM';
    const title = siblings > 1 ? `${item.title} - ${item.fileName.replace(/\.pdf$/i, '')}` : item.title;

    return {
        source: item.fileUrl,
        sourceUrl: item.fileUrl,
        title,
        docType,
        issuer,
        number,
        publishedAt: item.publishedAt,
        status: /revogad/i.test(item.title) ? 'revogado' : 'vigente',
        categories: ['facom'],
    };
}

module.exports = { crawl, shouldSkip, toEntry };
