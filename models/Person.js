const pool = require('../db/pool');

const FIELDS = [
    'source_url', 'okf_path', 'unidade', 'nome', 'categoria', 'cargo', 'funcao', 'situacao', 'titulacao', 'regime',
    'lotacao', 'endereco', 'email', 'telefone', 'ramal', 'resumo', 'atualizado', 'content_hash',
];

async function findAll() {
    const { rows } = await pool.query('SELECT id, source_url, status, content_hash FROM pessoas ORDER BY id');
    return rows;
}

// Perfil novo ou alterado: grava por endereço e volta a ficar ativo.
async function upsert(person) {
    const values = FIELDS.map((f) => person[f] ?? null);
    const placeholders = FIELDS.map((_, i) => `$${i + 1}`).join(', ');
    const updates = FIELDS.filter((f) => f !== 'source_url').map((f) => `${f} = EXCLUDED.${f}`).join(', ');
    const { rows } = await pool.query(
        `INSERT INTO pessoas (${FIELDS.join(', ')}) VALUES (${placeholders})
         ON CONFLICT (source_url) DO UPDATE SET ${updates}, status = 'ativo', updated_at = now()
         RETURNING id, (xmax = 0) AS created`,
        values
    );
    return rows[0];
}

async function markRemoved(ids) {
    if (!ids.length) return;
    await pool.query(`UPDATE pessoas SET status = 'removido', updated_at = now() WHERE id = ANY($1)`, [ids]);
}

// Busca só por palavra-chave (nome, cargo, lotação): perguntas sobre pessoas usam nomes e cargos.
async function search(text, { limit = 5, unidade = null } = {}) {
    const { rows } = await pool.query(
        `SELECT p.*, ts_rank_cd(p.tsv, q.q) AS score
         FROM pessoas p
         CROSS JOIN (SELECT replace(websearch_to_tsquery('pt_unaccent', pt_normalize($1))::text, ' & ', ' | ')::tsquery AS q) q
         WHERE p.status = 'ativo' AND p.tsv @@ q.q AND ($3::text IS NULL OR p.unidade = $3)
         ORDER BY score DESC
         LIMIT $2`,
        [text, limit, unidade]
    );
    return rows;
}

module.exports = { findAll, upsert, markRemoved, search };
