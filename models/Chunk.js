const pgvector = require('pgvector/pg');
const pool = require('../db/pool');

async function createMany(documentId, chunks) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const created = [];
        for (const [i, chunk] of chunks.entries()) {
            const { rows } = await client.query(
                `INSERT INTO chunks (document_id, chunk_index, content, page, token_count, embedding)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, document_id, chunk_index, content, page, token_count`,
                [documentId, i, chunk.content, chunk.page ?? null, chunk.tokenCount ?? null, pgvector.toSql(chunk.embedding)]
            );
            created.push(rows[0]);
        }
        await client.query('COMMIT');
        return created;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function findByDocument(documentId) {
    const { rows } = await pool.query(
        `SELECT id, document_id, chunk_index, content, page, token_count
         FROM chunks WHERE document_id = $1 ORDER BY chunk_index`,
        [documentId]
    );
    return rows;
}

async function removeByDocument(documentId) {
    await pool.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);
}

const SEARCH_COLUMNS = `
    c.id, c.document_id, c.chunk_index, c.content, c.page,
    d.title, d.subject, d.doc_type, d.number, d.source_url`;

const SEARCH_FILTER = `
    d.status = 'vigente'
    AND ($3::int[] IS NULL OR EXISTS (
        SELECT 1 FROM document_categories dc
        WHERE dc.document_id = d.id AND dc.category_id = ANY($3)))`;

async function searchVector(embedding, { limit = 20, categoryIds = null } = {}) {
    const { rows } = await pool.query(
        `SELECT ${SEARCH_COLUMNS}, 1 - (c.embedding <=> $1) AS score
         FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE ${SEARCH_FILTER}
         ORDER BY c.embedding <=> $1
         LIMIT $2`,
        [pgvector.toSql(embedding), limit, categoryIds]
    );
    return rows;
}

async function searchKeyword(text, { limit = 20, categoryIds = null } = {}) {
    const { rows } = await pool.query(
        `SELECT ${SEARCH_COLUMNS}, ts_rank_cd(c.tsv, query.q) AS score
         FROM chunks c JOIN documents d ON d.id = c.document_id
         CROSS JOIN (SELECT replace(websearch_to_tsquery('pt_unaccent', $1)::text, ' & ', ' | ')::tsquery AS q) query
         WHERE c.tsv @@ query.q AND ${SEARCH_FILTER}
         ORDER BY score DESC
         LIMIT $2`,
        [text, limit, categoryIds]
    );
    return rows;
}

module.exports = { createMany, findByDocument, removeByDocument, searchVector, searchKeyword };
