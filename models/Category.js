const pool = require('../db/pool');

async function create({ name, slug, description = null }) {
    const { rows } = await pool.query(
        'INSERT INTO categories (name, slug, description) VALUES ($1, $2, $3) RETURNING *',
        [name, slug, description]
    );
    return rows[0];
}

async function findAll() {
    const { rows } = await pool.query('SELECT * FROM categories ORDER BY name');
    return rows;
}

async function findBySlug(slug) {
    const { rows } = await pool.query('SELECT * FROM categories WHERE slug = $1', [slug]);
    return rows[0] || null;
}

async function remove(id) {
    await pool.query('DELETE FROM categories WHERE id = $1', [id]);
}

module.exports = { create, findAll, findBySlug, remove };
