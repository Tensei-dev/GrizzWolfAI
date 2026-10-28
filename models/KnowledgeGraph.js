const pool = require('../db/pool');

async function upsertNode({ type, key, label, documentId = null }) {
    const { rows } = await pool.query(
        `INSERT INTO kg_nodes (type, key, label, document_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (type, key) DO UPDATE SET label = EXCLUDED.label
         RETURNING id`,
        [type, key, label, documentId]
    );
    return rows[0].id;
}

async function addEdge(sourceId, relation, targetId, origin = 'regra') {
    await pool.query(
        `INSERT INTO kg_edges (source_id, relation, target_id, origin) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [sourceId, relation, targetId, origin]
    );
}

async function replaceEdgesFrom(sourceId, edges) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM kg_edges WHERE source_id = $1', [sourceId]);
        for (const e of edges) {
            await client.query(
                `INSERT INTO kg_edges (source_id, relation, target_id, origin) VALUES ($1, $2, $3, $4)
                 ON CONFLICT DO NOTHING`,
                [sourceId, e.relation, e.targetId, e.origin]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function findDocuments({ onlyPending = true } = {}) {
    const { rows } = await pool.query(
        `SELECT d.id, d.title, d.subject, d.doc_type, d.issuer, d.number, d.status, d.published_at, d.graph_built_at,
                ARRAY(SELECT c.slug FROM categories c JOIN document_categories dc ON dc.category_id = c.id
                      WHERE dc.document_id = d.id ORDER BY c.id) AS units
         FROM documents d
         WHERE d.status <> 'duplicado' AND ($1 = false OR d.graph_built_at IS NULL)
         ORDER BY d.id`,
        [onlyPending]
    );
    return rows;
}

async function documentText(documentId, maxChunks = null) {
    const { rows } = await pool.query(
        `SELECT content FROM chunks WHERE document_id = $1 ORDER BY chunk_index LIMIT $2`,
        [documentId, maxChunks]
    );
    return rows.map((r) => r.content).join('\n');
}

async function markBuilt(documentId) {
    await pool.query('UPDATE documents SET graph_built_at = now() WHERE id = $1', [documentId]);
}

async function nodeIds(type, keys) {
    const { rows } = await pool.query('SELECT id, key FROM kg_nodes WHERE type = $1 AND key = ANY($2)', [type, keys]);
    return Object.fromEntries(rows.map((r) => [r.key, r.id]));
}

// Documentos que valem só para cursos, currículos ou unidades fora de allowedNodeIds.
async function documentsOutside(allowedNodeIds) {
    const { rows } = await pool.query(
        `SELECT n.document_id
         FROM kg_nodes n JOIN kg_edges e ON e.source_id = n.id AND e.relation = 'aplica_a'
         WHERE n.type = 'documento'
         GROUP BY n.document_id
         HAVING NOT bool_or(e.target_id = ANY($1))`,
        [allowedNodeIds]
    );
    return rows.map((r) => r.document_id);
}

// Documentos vigentes que tratam de um dos assuntos e valem para um dos nós (curso, currículo ou unidade).
async function documentsAbout(topicKeys, appliesToNodeIds, limit = 8) {
    const { rows } = await pool.query(
        `SELECT n.document_id
         FROM kg_nodes n
         JOIN documents d ON d.id = n.document_id AND d.status = 'vigente'
         JOIN kg_edges t ON t.source_id = n.id AND t.relation = 'trata_de'
         JOIN kg_nodes a ON a.id = t.target_id AND a.type = 'assunto' AND a.key = ANY($1)
         JOIN kg_edges e ON e.source_id = n.id AND e.relation = 'aplica_a' AND e.target_id = ANY($2)
         GROUP BY n.document_id, d.published_at
         ORDER BY count(DISTINCT a.id) DESC, d.published_at DESC NULLS LAST
         LIMIT $3`,
        [topicKeys, appliesToNodeIds, limit]
    );
    return rows.map((r) => r.document_id);
}

// Todas as arestas que saem dos documentos ou chegam neles, com os dois lados já resolvidos.
async function edgesOfDocuments(documentIds) {
    const { rows } = await pool.query(
        `SELECT e.relation,
                s.document_id AS source_document, sd.status AS source_status, sd.title AS source_title, sd.number AS source_number,
                t.type AS target_type, t.key AS target_key, t.label AS target_label,
                t.document_id AS target_document, td.status AS target_status
         FROM kg_edges e
         JOIN kg_nodes s ON s.id = e.source_id
         JOIN kg_nodes t ON t.id = e.target_id
         LEFT JOIN documents sd ON sd.id = s.document_id
         LEFT JOIN documents td ON td.id = t.document_id
         WHERE s.document_id = ANY($1) OR t.document_id = ANY($1)`,
        [documentIds]
    );
    return rows;
}

module.exports = {
    upsertNode, addEdge, replaceEdgesFrom, findDocuments, documentText, markBuilt, nodeIds,
    documentsOutside, documentsAbout, edgesOfDocuments,
};
