// Completa os perfis do pacote OKF com o que o cabeçalho não tinha: o e-mail (do próprio perfil ou das listas de
// docentes e técnicos) e as áreas de pesquisa (do campo "Áreas de pesquisa ou interesse" ou dos temas no texto de
// formação, no estilo do Lattes). Roda sem rede no fim de cada `npm run okf`; o hash do conteúdo não muda.
const fs = require('fs/promises');
const path = require('path');
const okf = require('./okf');
const { emailsFrom } = require('./okfContacts');

const MAILTO = /\(mailto:([^)\s?]+)/i;
const MAX_AREAS_CHARS = 600;

const clean = (text) => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

function personEmail(body) {
    return body.match(MAILTO)?.[1].toLowerCase() || null;
}

// O texto de um campo "**Rótulo:**", na mesma linha ou nas de baixo, até o próximo campo.
function fieldText(body, label) {
    const lines = body.split('\n');
    const start = lines.findIndex((l) => label.test(l));
    if (start < 0) return null;
    const out = [lines[start].replace(/^\*\*[^*]+\*\*\s*/, '')];
    for (const line of lines.slice(start + 1)) {
        if (/^\*\*[^*]+:\*\*/.test(line.trim()) || /^#/.test(line) || /^\[.*\]\(/.test(line.trim())) break;
        out.push(line);
    }
    return clean(out.join(' ')) || null;
}

// Áreas de pesquisa: o campo próprio; senão, os temas do resumo de formação ("Tem experiência na área de X, com ênfase
// em Y", "atuando principalmente nos seguintes temas: Z"). "Com ênfase em" solto fica de fora: aparece na descrição
// de diplomas ("mestrado com ênfase em IA (UFMG, 1999)").
function researchAreas(body) {
    const field = fieldText(body, /^\*\*Áreas de pesquisa ou interesse:\*\*/i);
    if (field) return field.slice(0, MAX_AREAS_CHARS);
    const formation = fieldText(body, /^\*\*Formação:\*\*/) || '';
    const found = [];
    for (const m of formation.matchAll(/tem experi[eê]ncia na [aá]rea de ([^.;(]+?)(?:\s*,\s*com [eê]nfase em ([^.;(]+))?(?=[.;(]|,\s*atuando|$)/gi)) {
        found.push(m[2] ? `${m[1].trim()} (ênfase em ${m[2].trim()})` : m[1].trim());
    }
    for (const m of formation.matchAll(/atuando principalmente n[oa]s? (?:seguintes )?(?:temas|[aá]reas|linhas)\s*:?\s*([^.]+)/gi)) {
        found.push(m[1].trim());
    }
    const areas = [...new Set(found.map((s) => s.replace(/\s+,/g, ',').trim()).filter((s) => s.length > 3))];
    return areas.length ? areas.join('; ').slice(0, MAX_AREAS_CHARS) : null;
}

// Lê o pacote: { file, data, body } de cada Markdown (menos os índices).
async function readEntries(dir = okf.ROOT, out = []) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await readEntries(full, out);
        else if (e.name.endsWith('.md') && e.name !== 'index.md') {
            const { data, body } = okf.parseFrontmatter(await fs.readFile(full, 'utf8'));
            if (data.source && data.type) out.push({ file: full, data, body });
        }
    }
    return out;
}

async function enrichBundle({ dryRun = false } = {}) {
    const entries = await readEntries();
    const listed = emailsFrom(entries);
    const count = { perfis: 0, alterados: 0, comEmail: 0, comAreas: 0 };
    for (const e of entries.filter((x) => x.data.type === 'pessoa')) {
        count.perfis++;
        const pessoa = { ...(e.data.pessoa || {}) };
        const email = personEmail(e.body) || listed.get(e.data.source) || null;
        const areas = researchAreas(e.body);
        if (email) count.comEmail++;
        if (areas) count.comAreas++;
        let body = e.body.replace(/\s+$/, '');
        // o e-mail que veio das listas também aparece no corpo do perfil, para quem lê o Markdown
        if (email && !personEmail(body)) body += `\n\n**E-mail:** [${email}](mailto:${email})`;
        if (email) pessoa.email = email; else delete pessoa.email;
        if (areas) pessoa.areas = areas; else delete pessoa.areas;
        const changed = JSON.stringify(pessoa) !== JSON.stringify(e.data.pessoa || {}) || body !== e.body.replace(/\s+$/, '');
        if (!changed) continue;
        count.alterados++;
        // o corpo lido já começa com a linha em branco depois do cabeçalho
        if (!dryRun) await fs.writeFile(e.file, `${okf.toFrontmatter({ ...e.data, pessoa })}${body}\n`);
    }
    return count;
}

module.exports = { enrichBundle, researchAreas, personEmail, readEntries, fieldText };
