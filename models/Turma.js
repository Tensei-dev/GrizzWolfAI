const pool = require('../db/pool');

// Só o semestre mais recente com dados de cada curso: a Matemática ainda tem só 2026/1 com os docentes, o BCC já tem 2026/2.
const LATEST = `(SELECT curso, max(semestre) AS semestre FROM turmas GROUP BY curso)`;

const COLUMNS = `t.id, t.document_id, t.curso, t.semestre, t.codigo, t.disciplina, t.turma, t.docente, t.pessoa_id, t.horarios,
                 d.title AS documento, d.source_url`;

async function forPeople(personIds) {
    if (!personIds.length) return [];
    const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM turmas t JOIN ${LATEST} l USING (curso, semestre) JOIN documents d ON d.id = t.document_id
         WHERE t.pessoa_id = ANY($1) ORDER BY t.curso, t.codigo, t.turma`,
        [personIds]
    );
    return rows;
}

// Turmas cuja disciplina (ou código) bate com a pergunta, do semestre mais recente; as que batem com mais palavras
// primeiro. Com o curso do estudante, as do curso dele vêm na frente.
async function search(text, { curso = null, limit = 10 } = {}) {
    const { rows } = await pool.query(
        `SELECT ${COLUMNS}, ts_rank_cd(t.tsv, q.q) AS score
         FROM turmas t JOIN ${LATEST} l USING (curso, semestre) JOIN documents d ON d.id = t.document_id
         CROSS JOIN (SELECT replace(websearch_to_tsquery('pt_unaccent', pt_normalize($1))::text, ' & ', ' | ')::tsquery AS q) q
         WHERE t.tsv @@ q.q
         ORDER BY (t.curso = $2) DESC NULLS LAST, score DESC, t.codigo, t.turma
         LIMIT $3`,
        [text, curso, limit * 3]
    );
    if (!rows.length) return [];
    // só as que batem quase tão bem quanto a melhor: "Banco de Dados" não deve trazer todas as disciplinas "de Dados"
    const best = Math.max(...rows.map((r) => r.score));
    return rows.filter((r) => r.score >= best * 0.6).slice(0, limit);
}

module.exports = { forPeople, search };
