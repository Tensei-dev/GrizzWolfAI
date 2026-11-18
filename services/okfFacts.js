const fs = require('fs/promises');
const path = require('path');
const { parseFrontmatter } = require('./okf');
const { COURSES, courseOfText } = require('./courses');

const ROOT = path.join(__dirname, '..', 'conhecimento');
const OUTPUT = path.join(ROOT, 'fatos.json');

const COURSE_PAGES = {
    bcc: ['facom/graduacao/ciencia-da-computacao/conheca.md'],
    bsi: ['facom/graduacao/sistemas-de-informacao-campus-santa-monica/conheca.md', 'facom/graduacao/bsi-santamonica/secretaria.md'],
    'bsi-mc': ['facom/graduacao/bsi-montecarmelo/secretaria.md'],
    bia: ['facom/graduacao/inteligencia-artificial/conheca.md'],
    'mat-bach': ['ime/unidades/curso/curso-de-graduacao-matematica.md'],
    'mat-lic': ['ime/unidades/curso/curso-de-graduacao-matematica.md'],
    'mat-ead': ['ime/unidades/secretaria-de-curso/secretaria-do-curso-matematica-ead.md'],
    estat: ['ime/unidades/secretaria-de-curso/secretaria-do-curso-estatistica.md', 'ime/unidades/colegiado/colegiado-do-curso-de-ciencia-de-dados-e-estatistica.md'],
};
const UNIT_PAGES = {
    facom: ['facom/secretaria.md', 'facom/unidades/unidade-academica/faculdade-de-computacao.md'],
    ime: ['ime/unidades/diretoria/secretaria-do-instituto-de-matematica-e-estatistica.md', 'ime/unidades/unidade-academica/instituto-de-matematica-e-estatistica.md'],
};
const COORDINATORS_WALL = { facom: 'facom/mural-de-coordenadores.md' };

const WANTED = /^(coordenador|vice-?coordenador|secret[aá]ri|secretaria|hor[aá]rio|endere[cç]o|diretor|vice-?diretor|presidente|whatsapp)/i;
const LABEL = /^\*\*([^*]+?)\*\*\s*(.*)$/;

function plain(text) {
    return text
        .replace(/\[([^\]]*)\]\((?:mailto:)?[^)]*\)/g, '$1')
        .replace(/\*\*R:\*\*\s*/g, 'ramal ')
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function contactFields(body) {
    const fields = [];
    let current = null;
    for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const label = line.match(LABEL);
        if (label) {
            const name = label[1].replace(/:\s*$/, '').trim();
            const [title, inline] = name.includes(':') && !label[2] ? name.split(/:\s*/, 2) : [name, label[2]];
            current = WANTED.test(title) ? { label: title, values: [plain(inline || '')].filter(Boolean) } : null;
            if (current) fields.push(current);
            continue;
        }
        if (!current || /^(#|\||-\s|\*\s|!\[)/.test(line)) { current = line.startsWith('#') ? null : current; continue; }
        current.values.push(plain(line));
    }
    return fields
        .map((f) => ({ label: f.label, value: f.values.join(' · ') }))
        .filter((f) => f.value);
}

async function readPage(okfPath) {
    try {
        const { data, body } = parseFrontmatter(await fs.readFile(path.join(ROOT, okfPath), 'utf8'));
        return { title: data.title, source: data.source, atualizado: data.atualizado || null, fields: contactFields(body) };
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

async function coordinatorsFromWall(okfPath, year) {
    let body;
    try {
        ({ body } = parseFrontmatter(await fs.readFile(path.join(ROOT, okfPath), 'utf8')));
    } catch (err) {
        if (err.code === 'ENOENT') return {};
        throw err;
    }
    const current = {};
    for (const block of body.split(/^### /m).slice(1)) {
        const [name, ...rest] = block.split('\n');
        const text = rest.join('\n');
        const term = text.match(/(\d{4})(?:\s*até\s*(\d{4}))?/);
        const course = text.match(/\*\*([^*]+)\*\*/);
        if (!term || !course) continue;
        const [from, to] = [Number(term[1]), Number(term[2] || term[1])];
        const id = courseOfText(course[1].replace(/\s*-\s*/, ' '));
        if (!id || year < from || year > to) continue;
        (current[id] ||= []).push({ name: name.trim(), term: term[2] ? `${from} até ${to}` : String(from) });
    }
    return Object.fromEntries(Object.entries(current).filter(([, list]) => list.length === 1).map(([id, [c]]) => [id, c]));
}

async function buildFacts({ year = new Date().getFullYear() } = {}) {
    const facts = { cursos: {}, unidades: {}, faltando: [] };
    const load = async (paths) => {
        const pages = [];
        const seen = new Set();
        for (const p of paths) {
            const page = await readPage(p);
            if (!page) { facts.faltando.push(p); continue; }
            page.fields = page.fields
                .map((f) => (/colegiado/i.test(page.title) && /^presidente/i.test(f.label) ? { ...f, label: 'Presidente do colegiado do curso' } : f))
                .filter((f) => !seen.has(f.value) && seen.add(f.value));
            if (page.fields.length) pages.push(page);
        }
        return pages;
    };
    for (const [unit, paths] of Object.entries(UNIT_PAGES)) facts.unidades[unit] = await load(paths);
    const walls = {};
    for (const [unit, p] of Object.entries(COORDINATORS_WALL)) walls[unit] = await coordinatorsFromWall(p, year);
    for (const [id, paths] of Object.entries(COURSE_PAGES)) {
        const pages = await load(paths);
        const hasCoordinator = pages.some((p) => p.fields.some((f) => /^coordenador/i.test(f.label)));
        const fromWall = walls[COURSES[id].unit]?.[id];
        if (!hasCoordinator && fromWall) {
            pages.push({
                title: 'Mural de Coordenadores',
                source: `https://${COURSES[id].unit}.ufu.br/mural-de-coordenadores`,
                fields: [{ label: 'Coordenador(a)', value: `${fromWall.name} (mandato ${fromWall.term})` }],
            });
        }
        facts.cursos[id] = pages;
    }
    return facts;
}

async function writeFacts(options) {
    const facts = await buildFacts(options);
    await fs.writeFile(OUTPUT, `${JSON.stringify(facts, null, 2)}\n`);
    return facts;
}

module.exports = { buildFacts, writeFacts, contactFields, OUTPUT };
