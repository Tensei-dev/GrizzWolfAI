const pool = require('../db/pool');

// retorna null se essa resposta já foi avaliada (um voto por resposta, sem troca)
async function create({ answerId, rating, comment = null, question, answer, sources = [], course = null, entryYear = null, model = null }) {
    const { rows } = await pool.query(
        `INSERT INTO feedback (answer_id, rating, comment, question, answer, sources, course, entry_year, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (answer_id) DO NOTHING
         RETURNING *`,
        [answerId, rating, comment, question, answer, JSON.stringify(sources), course, entryYear, model]
    );
    return rows[0] || null;
}

module.exports = { create };
