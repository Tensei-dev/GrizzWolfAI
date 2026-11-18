const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

const ROOT = path.join(__dirname, '..', 'conhecimento');
const NEWS_DAYS = 90;

const UNITS = {
    facom: {
        baseUrl: 'https://facom.ufu.br',
        sections: [
            'graduacao', 'facom', 'unidades', 'pessoas', 'secretaria', 'servicos', 'legislacoes', 'perguntas-frequentes',
            'telefones', 'numeros', 'mural-de-coordenadores', 'mural-de-gestores', 'corpo-docente', 'mais-facom', 'mais-sigla',
            'pet', 'empresas-juniores', 'parcerias-aliancas-academicas', 'acontece', 'node',
        ],
        courses: {
            bcc: ['bcc', 'ciencia-da-computacao', 'ciencia-da-computacao-campus-santa-monica'],
            bsi: ['bsi-santamonica', 'sistemas-de-informacao-campus-santa-monica'],
            'bsi-mc': ['bsi-montecarmelo', 'sistemas-de-informacao-campus-monte-carmelo'],
            bia: ['inteligencia-artificial', 'inteligencia-artificial-campus-santa-monica'],
        },
    },
    ime: {
        baseUrl: 'https://ime.ufu.br',
        sections: [
            'graduacao', 'ime', 'famat', 'unidades', 'pessoas', 'servicos', 'legislacoes', 'regimento', 'resolucao',
            'perguntas-frequentes', 'telefones', 'numeros', 'mural-de-diretores', 'egressos', 'mais-ime', 'mais-famat',
            'projetos-e-eventos', 'extensao', 'editais', 'acontece', 'node',
        ],
        courses: {
            'mat-bach': ['matematica'],
            'mat-lic': ['matematica'],
            'mat-ead': ['matematica-ead'],
            estat: ['estatistica', 'ciencia-de-dados-e-estatistica'],
        },
    },
};

const NEWS_SECTIONS = new Set(['acontece', 'editais']);
const NEWS_LISTINGS = { facom: ['/acontece'], ime: ['/acontece', '/editais'] };
const MAX_LISTING_PAGES = 10;
const TEMPLATE_PAGE = /^\/graduacao\/(curso-modelo|novo-curso-|modelo-[a-z])/;

function parseSitemap(xml, baseUrl) {
    const seen = new Set();
    const pages = [];
    for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
        const loc = block.match(/<loc>(.*?)<\/loc>/)?.[1];
        if (!loc) continue;
        let pathname;
        try { pathname = decodeURIComponent(new URL(loc.replace(/&amp;/g, '&')).pathname).replace(/\/+$/, '') || '/'; } catch { continue; }
        if (seen.has(pathname)) continue;
        seen.add(pathname);
        pages.push({ path: pathname, url: new URL(encodeURI(pathname), baseUrl).href, lastmod: block.match(/<lastmod>(.*?)<\/lastmod>/)?.[1]?.slice(0, 10) || null });
    }
    return pages;
}

const sectionOf = (pagePath) => pagePath.split('/').filter(Boolean)[0] || '';

function parseListing(html, listingPath, baseUrl) {
    const $ = cheerio.load(html);
    const prefix = `${listingPath}/`;
    const paths = new Set();
    $('.region-content a[href]').each((_, a) => {
        try {
            const p = decodeURIComponent(new URL($(a).attr('href'), baseUrl).pathname).replace(/\/+$/, '');
            if (p.startsWith(prefix) && !/\/\d+$/.test(p)) paths.add(p);
        } catch { }
    });
    return [...paths];
}

function dateFromPath(pagePath) {
    const m = pagePath.match(/\/((?:19|20)\d{2})[/-](\d{2})(?:[/-]|$)/);
    return m ? `${m[1]}-${m[2]}` : null;
}

function cutoffDate(days = NEWS_DAYS, now = new Date()) {
    return new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
}

function selectPage(unitId, page, now = new Date()) {
    const unit = UNITS[unitId];
    const section = sectionOf(page.path);
    if (!unit.sections.includes(section)) return { ok: false, reason: `seção "${section || 'início'}" fora do escopo` };
    if (TEMPLATE_PAGE.test(page.path)) return { ok: false, reason: 'página-modelo do portal' };
    if (NEWS_SECTIONS.has(section) && page.path.split('/').length > 2) {
        const month = dateFromPath(page.path);
        if (month && month < cutoffDate(NEWS_DAYS, now).slice(0, 7)) return { ok: false, reason: 'notícia ou edital com mais de 90 dias' };
    }
    return { ok: true, section };
}

function coursesOf(unitId, pagePath) {
    const [section, slug] = pagePath.split('/').filter(Boolean);
    if (section !== 'graduacao' || !slug) return [];
    return Object.entries(UNITS[unitId].courses).filter(([, slugs]) => slugs.includes(slug)).map(([id]) => id);
}

const NODE_EDITAL = /\b(edital|resultado|homologa[cç][aã]o|processo seletivo|sele[cç][aã]o de|concurso|elei[cç][oõ]es|monitoria|vagas remanescentes|professor(\(a\))? (substitut|visitante)|prof\. substituto|reabertura|visiting professor)/i;
const pastYearIn = (title, now = new Date()) => (title.match(/\b20\d{2}\b/g) || []).some((y) => Number(y) < now.getFullYear());
const TEST_PAGE = /^teste\b/i;

function typeOf(section, title = '') {
    if (section === 'acontece') return 'noticia';
    if (section === 'editais') return 'edital';
    if (section === 'node' && (NODE_EDITAL.test(title) || pastYearIn(title))) return 'edital';
    if (section === 'pessoas') return 'pessoa';
    return 'pagina';
}

function staleReason(data, cutoff = cutoffDate()) {
    if (TEST_PAGE.test(data.title || '')) return 'página de teste do portal';
    const type = data.secao === 'node' ? typeOf('node', data.title) : data.type;
    if (['noticia', 'edital'].includes(type) && data.publicado && data.publicado < cutoff) return 'notícia ou edital com mais de 90 dias';
    return null;
}

function filePathFor(unitId, pagePath) {
    const parts = pagePath.split('/').filter(Boolean).map((p) => p.replace(/[<>:"\\|?*\x00-\x1f]/g, '-'));
    return path.join(unitId, ...(parts.length ? parts : ['inicio'])) + '.md';
}

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });
turndown.use(gfm);
turndown.remove(['script', 'style', 'noscript', 'iframe', 'form', 'img', 'button']);

function brDate(text, label) {
    const m = text.match(new RegExp(`${label}:\\s*(\\d{2})/(\\d{2})/(\\d{4})`));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function cleanMarkdown(md) {
    return md
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const plain = (md) => md.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*[-*]\s+/gm, '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();

function removeRepeats(md, title) {
    const lines = md.split('\n');
    const out = [];
    let lastHeading = plain(title).toLowerCase();
    for (const line of lines) {
        const text = plain(line).toLowerCase();
        if (text && text === lastHeading && !/^#+ /.test(line)) continue;
        if (/^#+ /.test(line)) lastHeading = text;
        else if (text) lastHeading = null;
        out.push(line);
    }
    return cleanMarkdown(out.join('\n'));
}

function firstSentence(md, max = 200) {
    const text = plain(md.replace(/^#+ .*$/gm, '')).replace(/https?:\S+/g, '').replace(/\s+/g, ' ').trim();
    const sentence = text.match(/^.{20,}?[.!?](\s|$)/)?.[0] || text;
    return sentence.length <= max ? sentence.trim() : `${sentence.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

const PERSON_FIELDS = {
    'field-categoria-funcional': 'categoria',
    'field-cargo': 'cargo',
    'funcao-cargo': 'funcao',
    'field-situacao-funcional': 'situacao',
    'field-titulacao': 'titulacao',
    'field-regime-trabalho': 'regime',
    'field-unidade-superior': 'unidade_organizacional',
    'field-localizacao': 'endereco',
    'field-email': 'email',
    'field-telefone': 'telefone',
    'field-lattes': 'lattes',
};

function extractPage(html, page, unitId) {
    const $ = cheerio.load(html);
    const root = $('.region-content').first().length ? $('.region-content').first() : $('body');
    const isNodePage = /\bpage-node\b/.test($('body').attr('class') || '');
    const main = isNodePage && root.find('.node').length ? root.find('.node').first() : root;
    const meta = main.find('.field-name-autor-publicacao-alteracao').first().text();
    const title = ((isNodePage && main.find('.field-name-title').first().text()) || $('title').text().split('|')[0]).replace(/\s+/g, ' ').trim();
    const section = sectionOf(page.path);

    const person = {};
    if (section === 'pessoas') {
        root.find('[class*="field-name-"]').each((_, el) => {
            const name = ($(el).attr('class').match(/field-name-([\w-]+)/) || [])[1];
            const key = PERSON_FIELDS[name];
            const value = $(el).text().replace(/\s+/g, ' ').replace(/^[^:]{2,40}:\s*/, '').trim();
            if (key && value) person[key] = value;
        });
    }

    main.find('script, style, noscript, form, iframe, .compartilhar, [class*="compartilhar"], .field-name-autor-publicacao-alteracao, '
        + '.field-name-field-categoria-funcional, .field-name-campo-dinamico, .carousel-control, .pager, .views-exposed-form, .element-invisible, '
        + '.breadcrumb, img, svg, i.fa, i[class*="fa-"]').remove();
    if (main !== root) main.find('.field-name-title').first().remove();
    main.find('.field').each((_, field) => {
        const label = $(field).children('.field-label').text().replace(/\s+/g, ' ').trim();
        if (!label) return;
        const value = ($(field).children('.field-items').html() || '').replace(/<(\/?)div\b[^>]*>/g, '<$1span>');
        $(field).replaceWith(`<p><strong>${label.replace(/:?\s*$/, ':')}</strong> ${value}</p>`);
    });
    main.find('a[href]').each((_, a) => {
        const href = $(a).attr('href');
        if (href.startsWith('#')) return void $(a).replaceWith($(a).html());
        if (!$(a).text().trim()) return void $(a).remove();
        try { $(a).attr('href', new URL(href, UNITS[unitId].baseUrl).href); } catch { $(a).removeAttr('href'); }
    });
    main.find('table').each((_, table) => {
        if ($(table).find('th').length) return;
        const items = $(table).find('tr').map((_, tr) => {
            const cells = $(tr).children('td').map((_, td) => $(td).html().trim().replace(/<(\/?)(p|div)\b[^>]*>/g, '<$1span> ')).get()
                .filter((c) => $('<div>').html(c).text().trim());
            return cells.length ? `<li>${cells.join(' — ')}</li>` : '';
        }).get().join('');
        $(table).replaceWith(items ? `<ul>${items}</ul>` : '');
    });

    const body = removeRepeats(cleanMarkdown(turndown.turndown(main.html() || '')), title);
    return {
        title,
        body,
        person,
        published: brDate(meta, 'Publicado'),
        updated: brDate(meta, 'Última modificação'),
    };
}

function linkInternal(body, fromFile, urlToFile) {
    return body.replace(/\]\((https?:\/\/[^)\s]+)\)/g, (match, href) => {
        let key;
        try { key = new URL(href).pathname.replace(/\/+$/, '') || '/'; key = decodeURIComponent(key); } catch { return match; }
        const target = urlToFile.get(key);
        if (!target) return match;
        return `](${path.relative(path.dirname(fromFile), target).split(path.sep).join('/')})`;
    });
}

const FIELD_ORDER = ['type', 'title', 'description', 'unidade', 'secao', 'cursos', 'tags', 'source', 'publicado', 'atualizado', 'pessoa', 'hash'];

function toFrontmatter(data) {
    const lines = FIELD_ORDER.filter((k) => data[k] !== undefined && data[k] !== null && !(Array.isArray(data[k]) && !data[k].length)
        && !(typeof data[k] === 'object' && !Array.isArray(data[k]) && !Object.keys(data[k]).length))
        .map((k) => `${k}: ${JSON.stringify(data[k])}`);
    return `---\n${lines.join('\n')}\n---\n`;
}

function parseFrontmatter(raw) {
    const text = raw.replace(/\r\n/g, '\n');
    const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!m) return { data: {}, body: text };
    const data = {};
    for (const line of m[1].split('\n')) {
        const i = line.indexOf(': ');
        if (i > 0) { try { data[line.slice(0, i)] = JSON.parse(line.slice(i + 2)); } catch { } }
    }
    return { data, body: text.slice(m[0].length) };
}

const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

module.exports = {
    ROOT, UNITS, NEWS_DAYS, NEWS_LISTINGS, MAX_LISTING_PAGES, parseSitemap, parseListing, selectPage, coursesOf, typeOf, sectionOf, filePathFor, extractPage,
    linkInternal, toFrontmatter, parseFrontmatter, firstSentence, hashOf, cutoffDate, dateFromPath, staleReason,
};
