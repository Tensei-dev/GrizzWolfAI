const pool = require('../db/pool');

const FIELDS = [
    'source_url', 'okf_path', 'unidade', 'nome', 'categoria', 'cargo', 'funcao', 'situacao', 'titulacao', 'regime',
    'lotacao', 'endereco', 'email', 'telefone', 'ramal', 'resumo', 'areas', 'atualizado', 'content_hash',
];

const toVector = (embedding) => `[${embedding.join(',')}]`;
const RRF_K = 60;

async function findAll() {
    const { rows } = await pool.query('SELECT id, source_url, status, content_hash, embedding_hash FROM pessoas ORDER BY id');
    return rows;
}

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

async function needingEmbedding() {
    const { rows } = await pool.query(
        `SELECT id, source_url, nome, areas, resumo, embedding_hash FROM pessoas
         WHERE status = 'ativo' AND categoria = 'Docente' AND situacao = 'Em exercício'`
    );
    return rows;
}

async function setEmbedding(id, embedding, hash) {
    await pool.query('UPDATE pessoas SET embedding = $2, embedding_hash = $3 WHERE id = $1', [id, toVector(embedding), hash]);
}

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

async function searchByArea(text, embedding, { limit = 6, unidade = null } = {}) {
    const base = `p.status = 'ativo' AND p.categoria = 'Docente' AND p.situacao = 'Em exercício' AND ($2::text IS NULL OR p.unidade = $2)`;
    const [byVector, byKeyword] = await Promise.all([
        embedding
            ? pool.query(
                `SELECT p.* FROM pessoas p WHERE ${base} AND p.embedding IS NOT NULL
                 ORDER BY p.embedding <=> $1 LIMIT 20`,
                [toVector(embedding), unidade]
            ).then((r) => r.rows)
            : [],
        pool.query(
            `SELECT p.* FROM pessoas p
             CROSS JOIN (SELECT replace(websearch_to_tsquery('pt_unaccent', pt_normalize($1))::text, ' & ', ' | ')::tsquery AS q) q
             WHERE ${base} AND p.areas IS NOT NULL
               AND setweight(to_tsvector('pt_unaccent', pt_normalize(p.areas)), 'B') @@ q.q
             ORDER BY ts_rank_cd(setweight(to_tsvector('pt_unaccent', pt_normalize(p.areas)), 'B'), q.q) DESC LIMIT 20`,
            [text, unidade]
        ).then((r) => r.rows),
    ]);
    const fused = new Map();
    for (const list of [byVector, byKeyword]) {
        list.forEach((p, rank) => {
            const entry = fused.get(p.id) || { ...p, score: 0 };
            entry.score += 1 / (RRF_K + rank + 1);
            fused.set(p.id, entry);
        });
    }
    return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { findAll, upsert, markRemoved, needingEmbedding, setEmbedding, search, searchByArea };
