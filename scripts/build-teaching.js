// Monta a tabela turmas (quem dá cada disciplina) a partir dos horários de aula já importados. Sem LLM e sem vetores:
// pode rodar todo dia depois do sync. Cada documento tem as turmas trocadas por inteiro a cada rodada.
//   npm run teaching             refaz as turmas de todos os horários
//   npm run teaching -- --dry-run  só mostra o resumo, sem gravar
const pool = require('../db/pool');
const { COURSES } = require('../services/courses');
const { parseTimetable, resolvePerson, semesterOf, unitOfCode } = require('../services/teaching');

const TIMETABLE = 'hor[aá]rio|docentes|disciplinas x|rela[cç][aã]o de disciplinas';
const CAMPUS = { 'bsi-mc': 'Monte Carmelo' };

async function timetables() {
    const { rows } = await pool.query(
        `SELECT d.id, d.title,
                (SELECT array_agg(DISTINCT split_part(n.key, ':', 1)) FROM kg_edges e
                   JOIN kg_nodes s ON s.id = e.source_id JOIN kg_nodes n ON n.id = e.target_id
                  WHERE s.document_id = d.id AND e.relation = 'aplica_a' AND n.type IN ('curso', 'curriculo')) AS cursos,
                (SELECT string_agg(c.content, E'\\n' ORDER BY c.chunk_index) FROM chunks c WHERE c.document_id = d.id) AS text
         FROM documents d
         WHERE d.status = 'vigente' AND d.kind = 'norma' AND d.title ~* $1
         ORDER BY d.id`,
        [TIMETABLE]
    );
    return rows.map((r) => ({ ...r, cursos: (r.cursos || []).filter((id) => COURSES[id]) }));
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const { rows: people } = await pool.query(
        `SELECT id, nome, unidade, situacao, endereco FROM pessoas WHERE status = 'ativo' AND categoria = 'Docente'`
    );
    const summary = [];
    const kept = [];
    for (const doc of await timetables()) {
        const semestre = semesterOf(doc.title, doc.text || '');
        const parsed = doc.text ? parseTimetable(doc.text, people) : [];
        if (!semestre || !doc.cursos.length || !parsed.some((r) => r.docentes.length)) continue;
        for (const curso of doc.cursos) {
            const unit = COURSES[curso].unit;
            const rows = parsed.flatMap((r) => (r.docentes.length ? r.docentes : [null]).map((name) => {
                const person = name && resolvePerson(name, people, { unit: unitOfCode(r.codigo) || unit, campus: CAMPUS[curso] || 'Santa Mônica' });
                return { ...r, docente: person ? person.nome : name, pessoa_id: person?.id || null };
            }));
            kept.push({ doc, curso, semestre, rows });
            const named = rows.filter((r) => r.docente);
            summary.push(`${curso.padEnd(9)} ${semestre}  #${String(doc.id).padEnd(4)} ${String(parsed.length).padStart(3)} turmas, `
                + `${named.filter((r) => r.pessoa_id).length}/${named.length} docentes ligados ao cadastro`);
        }
    }
    console.log(summary.join('\n'));
    if (dryRun) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // horários que deixaram de valer (ou de ter docentes) saem também
        await client.query('DELETE FROM turmas');
        for (const { doc, curso, semestre, rows } of kept) {
            for (const r of rows) {
                await client.query(
                    `INSERT INTO turmas (document_id, curso, semestre, codigo, disciplina, turma, docente, pessoa_id, horarios)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [doc.id, curso, semestre, r.codigo, r.disciplina, r.turma, r.docente, r.pessoa_id, r.horarios]
                );
            }
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
    const { rows: [total] } = await pool.query('SELECT count(*) AS n FROM turmas');
    console.log(`${total.n} linhas gravadas em turmas`);
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
