require('./hostOverrides');
const cheerio = require('cheerio');

const UNITS = {
    facom: {
        baseUrl: 'https://facom.ufu.br',
        siteName: 'site da FACOM',
        category: { slug: 'facom', name: 'FACOM', description: 'Documentos publicados no site da FACOM' },
        skipTitles: [
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
        ],
        skipFiles: [/portaria_de_pessoal/i],
        issuer: (text) => (/conselho da faculdade de computa[cç][aã]o/i.test(text) ? 'CONFACOM' : 'FACOM'),
        // Na FACOM o título da publicação já descreve o arquivo; o nome do arquivo só entra quando há vários.
        fileInTitle: (item, siblings) => siblings > 1,
    },
    ime: {
        baseUrl: 'https://ime.ufu.br',
        siteName: 'site do IME',
        category: { slug: 'ime', name: 'IME', description: 'Documentos publicados no site do IME' },
        skipTitles: [
            /memorial|classe de professor titular/i,
            /progress[aã]o/i,
            /concurso p[uú]blico/i,
            /processo seletivo simplificado para cargo/i,
            /carga hor[aá]ria did[aá]tica/i,
            /relat[oó]rio de docentes/i,
            /plano de trabalho docente/i,
            /corpo docente/i,
            /avalia[cç][aã]o de desempenho docente/i,
            /afastamento/i,
            /capta[cç][aã]o de parcerias/i,
            /material did[aá]tico/i,
            /docentes\/disciplinas por per[ií]odo/i,
            /doutorado/i,
            /maratona de matem/i,
            /links e arquivos/i,
        ],
        skipFiles: [/revista|jornal|gazeta|portal de not[ií]cias/i, /levantamento_areas_docentes/i, /carga hor[aá]ria did[aá]tica/i],
        issuer: (text) => text.match(/\b(CONIME|CONFAMAT|COLCOCMA|CONGRAD|CONSEX|COPOA|COCMA|DIRIME)\b/i)?.[1].toUpperCase() || 'IME',
        // No IME o título costuma ser só a seção ("Monitorias", "Bacharelado"); o nome do arquivo diz o que é.
        fileInTitle: (item, siblings, label) => siblings > 1 || !item.title.toLowerCase().includes(label.toLowerCase()),
    },
};

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

const NUMBER = /(?:n[º°o.]\.?\s*|resolu[cç][aã]o\s+(?:[a-z]+\s+)?)([\d.]+\/\d{4})/i;

const HEADERS = { 'User-Agent': 'GrizzWolfAI/1.0 (+https://github.com/Tensei-dev/GrizzWolfAI)' };
const DELAY_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NETWORK_ATTEMPTS = 3;

function getUnit(id) {
    const unit = UNITS[id];
    if (!unit) throw new Error(`unidade desconhecida: ${id} (use ${Object.keys(UNITS).join(', ')})`);
    return unit;
}

async function fetchPage(unit, url) {
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
            throw new Error(`não consegui acessar o ${unit.siteName} (${cause}); ele pode estar fora do ar, tente mais tarde`);
        }
        if (res.ok) return res.text();
        if ([403, 429, 503].includes(res.status) && attempt < 4) {
            await sleep(30000 * attempt);
            continue;
        }
        throw new Error(`HTTP ${res.status} em ${url}`);
    }
}

async function fetchListingPage(unit, page) {
    const $ = cheerio.load(await fetchPage(unit, `${unit.baseUrl}/central-de-conteudos/documentos?page=${page}`));

    const items = [];
    $('.region-content .views-row').each((_, row) => {
        const title = $(row).find('h3.titulo').text().trim().replace(/\s+/g, ' ');
        const date = $(row).find('.info-lateral li').first().text().trim();
        const [d, m, y] = date.split('/');

        $(row).find('.linha-fina a[href]').each((_, a) => {
            items.push({
                title,
                fileName: $(a).text().trim().replace(/\s+/g, ' '),
                fileUrl: new URL($(a).attr('href'), unit.baseUrl).href,
                publishedAt: y ? `${y}-${m}-${d}` : null,
            });
        });
    });
    return items;
}

async function crawl(unitId) {
    const unit = getUnit(unitId);
    const all = [];
    for (let page = 0; ; page++) {
        const items = await fetchListingPage(unit, page);
        if (items.length === 0) break;
        all.push(...items);
        await sleep(DELAY_MS);
    }
    return all;
}

function shouldSkip(unitId, item) {
    const unit = getUnit(unitId);
    if (!/\.pdf($|\?)/i.test(item.fileUrl)) return true;
    return unit.skipTitles.some((r) => r.test(item.title)) || unit.skipFiles.some((r) => r.test(item.fileName));
}

// "grade_curricular_-_turma_2.pdf" vira "grade curricular turma 2".
function fileLabel(fileName) {
    const label = fileName.replace(/\.pdf$/i, '');
    if (/\s/.test(label)) return label;
    return label.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function toEntry(unitId, item, siblings) {
    const unit = getUnit(unitId);
    const label = fileLabel(item.fileName);
    const title = unit.fileInTitle(item, siblings, label) ? `${item.title} - ${label}` : item.title;
    const number = item.title.match(NUMBER)?.[1] || item.fileName.match(NUMBER)?.[1] || null;
    const docType = DOC_TYPES.find(([r]) => r.test(item.title) || r.test(item.fileName))?.[1] || 'documento';

    return {
        source: item.fileUrl,
        sourceUrl: item.fileUrl,
        title,
        docType,
        issuer: unit.issuer(`${item.title} ${item.fileName}`),
        number,
        publishedAt: item.publishedAt,
        status: /revogad/i.test(title) ? 'revogado' : 'vigente',
        categories: [unit.category.slug],
    };
}

module.exports = { UNITS, crawl, shouldSkip, toEntry };
