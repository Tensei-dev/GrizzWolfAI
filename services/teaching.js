// Quem dá cada disciplina: lido dos horários de aula que as unidades publicam (PDFs já importados), por regras e sem
// LLM. Cada curso publica num formato:
//   - SIGAA (BCC, IA): "CÓDIGO - Disciplina Docentes: Nome Completo", com "Turma:" antes e "Horários:" depois;
//   - SIGAA com as colunas trocadas (Estatística): "Docentes: CÓDIGO - Disciplina Nome Completo";
//   - legenda das grades (Matemática, BSI Monte Carmelo): "AL1 - FAMAT31302 - Álgebra Linear I - Rosana (Sala: 5S 301)"
//     ou "GSI501 - Empreendedorismo em Informática (Maria Lúcia)", só com o primeiro nome.
// O nome é ligado ao cadastro de pessoas; nome curto que serve para mais de uma pessoa fica sem ligação.

const CODE = '[A-Z]{3,6}[0-9]{3,6}[A-Z]?';
const DASH = '\\s*[-–]\\s*';
const SIGAA_LINE = new RegExp(`^(${CODE})${DASH}(.+?)\\s+Docentes:\\s*(.*)$`);
const SIGAA_SWAPPED = new RegExp(`^Docentes:\\s*(${CODE})${DASH}(.+)$`);
// disciplina gulosa e nome sem traço: "AL1 - FAMAT31302 - Álgebra Linear I - Rosana (Sala: 5S 301)"
const LEGEND_ROOM = new RegExp(`^(?:[A-Z0-9]{1,6}${DASH})?(${CODE})${DASH}(.+)${DASH}([^()\\-–]+?)\\s*\\(Sala:\\s*([^)]+)\\)`);
const LEGEND_PAREN = new RegExp(`^(?:[A-Z0-9]{1,6}${DASH})?(${CODE})${DASH}(.+?)\\s*\\(([^()]+)\\)\\s*$`);
const TURMA = /^Turma:\s*(\S+)\s+Período:/;
const HORARIO = /^Horários:\s*(.*)$/;
const NEW_BLOCK = /CH Total:|^Estrutura Curricular:/;
const CONNECTORS = ['da', 'de', 'do', 'das', 'dos', 'e'];

const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const tidy = (text) => text.replace(/\s+/g, ' ').replace(/[\s|\-–]+$/, '').replace(/^[\s\-–]+/, '').trim();
// nome de gente: começa com maiúscula seguida de minúscula, sem número (fora "LEM", "1F129", "T")
const looksLikeName = (s) => /^[A-ZÀ-Ú][a-zà-ú]/.test(s) && !/\d/.test(s);

// "Segunda-feira 10:40:00 às 12:20:00 - Teórica Início: ... Sala: 1B 110 Capacidade: 80" → "Segunda-feira 10:40–12:20 (sala 1B 110)"
function shortSchedule(line) {
    const when = line.match(/(Segunda|Terça|Quarta|Quinta|Sexta|Sábado)(-feira)?\s+(\d{2}:\d{2})(?::\d{2})?\s+às\s+(\d{2}:\d{2})/i);
    if (!when) return null;
    const room = line.match(/Sala:\s*(\S.*?)\s+Capacidade/);
    const sala = room && !/^CH\b/.test(room[1]) ? ` (sala ${room[1]})` : '';
    return `${when[1]}${when[2] || ''} ${when[3]}–${when[4]}${sala}`;
}

// No texto do SIGAA ("Período: 2° Semestre de 2026"), que é mais confiável que o título ("Período Letivo 2026/1 -
// ... 2026/2"); senão, o último semestre citado no título.
function semesterOf(title, text = '') {
    const counts = {};
    for (const m of text.matchAll(/Per[ií]odo:\s*([12])\s*[°º]?\s*Semestre de (20\d{2})/g)) {
        const key = `${m[2]}/${m[1]}`;
        counts[key] = (counts[key] || 0) + 1;
    }
    const fromText = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (fromText) return fromText[0];
    const inTitle = [...title.matchAll(/(20\d{2})\s*[/_-]\s*([12])\b/g)].pop();
    return inTitle ? `${inTitle[1]}/${inTitle[2]}` : null;
}

// "Sarah Substituta" → "Sarah (substituta)": substituto quase nunca está no cadastro, então não é ligado pelo primeiro nome
const splitNames = (raw) => raw
    .replace(/\s*[-–]?\s*\bsubstitut([oa])s?\b/gi, (_, g) => ` (substitut${g.toLowerCase()})`)
    .split(/\s*(?:\/|,|;|\be\b)\s*/)
    .map((s) => tidy(s))
    .filter((s) => s.length > 1 && looksLikeName(s) && !/^a definir$/i.test(s));

// Separa "Disciplina Nome Completo" (SIGAA com as colunas trocadas) pelo nome de alguém do cadastro no fim da linha.
function splitTrailingName(text, people) {
    const n = normalize(text);
    let best = null;
    for (const p of people) {
        const name = normalize(p.nome);
        if (n.endsWith(` ${name}`) && (!best || name.length > normalize(best.nome).length)) best = p;
    }
    if (!best) return { discipline: tidy(text), names: [] };
    return { discipline: tidy(text.slice(0, text.length - best.nome.length)), names: [best.nome] };
}

function parseTimetable(text, people = []) {
    const rows = [];
    let turma = null;
    let last = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const t = line.match(TURMA);
        if (t) { turma = t[1]; continue; }
        const h = line.match(HORARIO);
        if (h) {
            const s = last && shortSchedule(h[1]);
            if (s && !last.horarios.includes(s)) last.horarios.push(s);
            continue;
        }
        let m = line.match(SIGAA_LINE);
        if (m) {
            last = { codigo: m[1], disciplina: tidy(m[2]), turma, docentes: splitNames(m[3]), horarios: [] };
            rows.push(last);
            continue;
        }
        m = line.match(SIGAA_SWAPPED);
        if (m) {
            const { discipline, names } = splitTrailingName(m[2], people);
            last = { codigo: m[1], disciplina: discipline, turma: null, docentes: names, horarios: [] };
            rows.push(last);
            continue;
        }
        m = line.match(LEGEND_ROOM);
        if (m) {
            rows.push({ codigo: m[1], disciplina: tidy(m[2]), turma: null, docentes: splitNames(m[3]), horarios: [`sala ${tidy(m[4])}`] });
            last = null;
            continue;
        }
        m = line.match(LEGEND_PAREN);
        if (m && splitNames(m[3]).length) {
            rows.push({ codigo: m[1], disciplina: tidy(m[2]), turma: null, docentes: splitNames(m[3]), horarios: [] });
            last = null;
            continue;
        }
        if (NEW_BLOCK.test(line)) last = null;
    }
    return dedupe(rows);
}

// Os trechos do banco se sobrepõem (200 caracteres): a mesma turma aparece duas vezes.
function dedupe(rows) {
    const seen = new Map();
    for (const r of rows) {
        const key = [r.codigo, r.turma || '', r.docentes.join('|')].join('#');
        const before = seen.get(key);
        if (!before) seen.set(key, r);
        else for (const h of r.horarios) if (!before.horarios.includes(h)) before.horarios.push(h);
    }
    return [...seen.values()];
}

// Liga o nome da grade a uma pessoa do cadastro. people: os docentes das duas unidades (professor do IME dá aula no BCC).
// Nome completo: igual ao do cadastro, em qualquer unidade. Nome curto ("Rosana", "Maria Lúcia"): só na unidade do
// curso, com todas as partes no nome de uma única pessoa em exercício; se der empate, vale quem é do campus do curso.
function resolvePerson(name, people, { unit = null, campus = null } = {}) {
    const n = normalize(name);
    const exact = people.filter((p) => normalize(p.nome) === n);
    if (exact.length === 1) return exact[0];
    if (/\(substitut/.test(n)) return null;
    const pool = unit ? people.filter((p) => p.unidade === unit) : people;
    const parts = n.split(' ').filter((w) => w.length > 1 && !CONNECTORS.includes(w));
    if (!parts.length) return null;
    const fits = pool.filter((p) => {
        const own = normalize(p.nome).split(' ');
        return own[0] === parts[0] && parts.every((w) => own.includes(w));
    });
    const active = fits.filter((p) => !p.situacao || p.situacao === 'Em exercício');
    if (active.length === 1) return active[0];
    if (!active.length && fits.length === 1) return fits[0];
    const onCampus = campus ? active.filter((p) => normalize(p.endereco || '').includes(normalize(campus))) : [];
    return onCampus.length === 1 ? onCampus[0] : null;
}

// A unidade que oferece a disciplina, pelo prefixo do código: no BSI de Monte Carmelo, "FAMAT39114 - Matemática
// Discreta (Gustavo)" é do IME. Outros prefixos (Física, Economia…) são de unidades fora do cadastro.
function unitOfCode(code) {
    if (/^(FAMAT|GES|GMA|GMB|IME)/.test(code)) return 'ime';
    if (/^(FACOM|GSI|GBC|COMPE)/.test(code)) return 'facom';
    return null;
}

module.exports = { parseTimetable, resolvePerson, semesterOf, shortSchedule, splitNames, unitOfCode };
