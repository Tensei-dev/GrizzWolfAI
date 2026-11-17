const pool = require('../db/pool');

// Encontra as pessoas (docentes e técnicos) citadas pelo nome numa pergunta, para o Grizz responder "quem é",
// telefone, ramal e sala. A busca é pelos nomes do cadastro em memória, sem LLM: um nome conta quando a pergunta
// traz duas partes dele (ex.: "Adriano Rocha"), ou uma parte rara junto de uma palavra como "professor" ou "ramal".
// Uma parte comum (ex.: "professor Marcelo") traz as pessoas com esse nome como candidatas.

const CACHE_MS = 10 * 60 * 1000;
const MAX_PEOPLE = 3;
const RARE = 2; // uma parte do nome que no máximo 2 pessoas têm
const AMBIGUOUS = 8; // "professor Marcelo": até 8 pessoas com o nome viram candidatas, para o Grizz perguntar qual
const CONNECTORS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
const PERSON_WORDS = /\b(prof|profa|professora?s?|docentes?|tecnic[oa]s?|servidor[ae]?s?|telefones?|ramal|ramais|sala|contato|email|e-mail|quem e|falar com)\b/;

let cache = null;

const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (text) => normalize(text).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !CONNECTORS.has(w));

async function load() {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache;
    const { rows } = await pool.query(
        `SELECT id, nome, unidade, categoria, cargo, funcao, situacao, titulacao, regime, lotacao, endereco, email,
                telefone, ramal, source_url
         FROM pessoas WHERE status = 'ativo'`
    );
    const frequency = new Map();
    const people = rows.map((p) => ({ ...p, parts: [...new Set(words(p.nome))] }));
    for (const p of people) for (const w of p.parts) frequency.set(w, (frequency.get(w) || 0) + 1);
    cache = { at: Date.now(), people, frequency };
    return cache;
}

function match(text, { people, frequency }) {
    const asked = new Set(words(text));
    const personWord = PERSON_WORDS.test(normalize(text));
    return people
        .map((p) => {
            const hits = p.parts.filter((w) => asked.has(w));
            const fewest = Math.min(...hits.map((w) => frequency.get(w)));
            const single = hits.length === 1 && personWord;
            if (hits.length >= 2 || (single && fewest <= RARE)) return { ...p, hits: hits.length };
            return single && fewest <= AMBIGUOUS && { ...p, hits: 1, ambiguous: true };
        })
        .filter(Boolean)
        .sort((a, b) => b.hits - a.hits || Number(b.situacao === 'Em exercício') - Number(a.situacao === 'Em exercício'));
}

// Quem foi citado na pergunta (ou na versão reescrita dela): fica só quem bate melhor, para "Adriano Barbosa Silva"
// não trazer também outros Adrianos e Silvas. Retorna { people, ambiguous }.
function mentioned(text, registry) {
    if (!text.trim()) return { people: [], ambiguous: false };
    const found = match(text, registry);
    const sure = found.filter((p) => !p.ambiguous);
    if (sure.length) return { people: sure.filter((p) => p.hits === sure[0].hits).slice(0, MAX_PEOPLE), ambiguous: false };
    return { people: found.slice(0, AMBIGUOUS), ambiguous: found.length > 1 };
}

async function findMentioned(...texts) {
    const text = texts.filter(Boolean).join(' ');
    if (!text.trim()) return { people: [], ambiguous: false };
    return mentioned(text, await load());
}

function describe(p) {
    const unit = p.unidade.toUpperCase();
    const situation = p.situacao && p.situacao !== 'Em exercício'
        ? `Situação: ${p.situacao} (não está mais em atividade na ${unit})`
        : p.situacao && `Situação: ${p.situacao}`;
    return [
        `Perfil de ${p.nome} no site da ${unit}`,
        [p.categoria, p.cargo || p.funcao].filter(Boolean).join(' · '),
        situation,
        p.titulacao && `Titulação: ${p.titulacao}`,
        p.regime && `Regime de trabalho: ${p.regime}`,
        p.lotacao && `Lotação: ${p.lotacao}`,
        p.endereco && `Endereço/sala: ${p.endereco}`,
        p.telefone && `Telefone: ${p.telefone}${p.ramal ? ` (ramal ${p.ramal})` : ''}`,
        p.email && `E-mail: ${p.email}`,
        ...describeClasses(p.disciplinas || []),
    ].filter(Boolean).join('\n');
}

// "Disciplinas em 2026/2 (horários de aula publicados): Projeto de Graduação (FACOM31806, Ciência da Computação, turma PG) …"
function describeClasses(rows) {
    if (!rows.length) return [];
    const { COURSES } = require('./courses');
    const bySemester = new Map();
    for (const r of rows) {
        const where = [r.codigo, COURSES[r.curso]?.name || r.curso, r.turma && `turma ${r.turma}`].filter(Boolean).join(', ');
        const line = `${r.disciplina} (${where})${r.horarios?.length ? `: ${r.horarios.join('; ')}` : ''}`;
        (bySemester.get(r.semestre) || bySemester.set(r.semestre, []).get(r.semestre)).push(line);
    }
    return [...bySemester].map(([semestre, lines]) => `Disciplinas em ${semestre} (pelos horários de aula publicados):\n- ${lines.join('\n- ')}`);
}

module.exports = { findMentioned, describe, words, match, mentioned };
