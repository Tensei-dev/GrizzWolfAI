const pool = require('../db/pool');

async function create({ title, docType, issuer = null, number = null, sourceUrl = null, publishedAt = null, status = 'vigente', subject = null, fileHash }) {
    const { rows } = await pool.query(
        `INSERT INTO documents (title, doc_type, issuer, number, source_url, published_at, status, subject, file_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, docType, issuer, number, sourceUrl, publishedAt, status, subject, fileHash]
    );
    return rows[0];
}

async function findById(id) {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
    return rows[0] || null;
}

async function findByHash(fileHash) {
    const { rows } = await pool.query('SELECT * FROM documents WHERE file_hash = $1', [fileHash]);
    return rows[0] || null;
}

async function findBySourceUrl(sourceUrl) {
    const { rows } = await pool.query('SELECT * FROM documents WHERE source_url = $1 LIMIT 1', [sourceUrl]);
    return rows[0] || null;
}

async function findByNumber(issuer, number) {
    const { rows } = await pool.query(
        'SELECT * FROM documents WHERE issuer = $1 AND number = $2 ORDER BY id DESC LIMIT 1',
        [issuer, number]
    );
    return rows[0] || null;
}

async function findAll({ status = null, categoryId = null } = {}) {
    const { rows } = await pool.query(
        `SELECT d.* FROM documents d
         WHERE ($1::text IS NULL OR d.status = $1)
           AND ($2::int IS NULL OR EXISTS (
                SELECT 1 FROM document_categories dc
                WHERE dc.document_id = d.id AND dc.category_id = $2))
         ORDER BY d.published_at DESC NULLS LAST, d.id DESC`,
        [status, categoryId]
    );
    return rows;
}

async function markReplaced(oldId, newId) {
    const { rows } = await pool.query(
        `UPDATE documents SET status = 'revogado', replaced_by = $2, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [oldId, newId]
    );
    return rows[0] || null;
}

async function remove(id) {
    await pool.query('DELETE FROM documents WHERE id = $1', [id]);
}

async function addCategory(documentId, categoryId) {
    await pool.query(
        'INSERT INTO document_categories (document_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [documentId, categoryId]
    );
}

async function removeCategory(documentId, categoryId) {
    await pool.query(
        'DELETE FROM document_categories WHERE document_id = $1 AND category_id = $2',
        [documentId, categoryId]
    );
}

async function getCategories(documentId) {
    const { rows } = await pool.query(
        `SELECT c.* FROM categories c
         JOIN document_categories dc ON dc.category_id = c.id
         WHERE dc.document_id = $1 ORDER BY c.name`,
        [documentId]
    );
    return rows;
}

module.exports = {
    create, findById, findByHash, findBySourceUrl, findByNumber, findAll, markReplaced, remove,
    addCategory, removeCategory, getCategories,
};
