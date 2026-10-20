const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name       TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

        const { rows } = await client.query('SELECT name FROM schema_migrations');
        const applied = new Set(rows.map((r) => r.name));
        const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

        for (const file of files) {
            if (applied.has(file)) continue;
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
                console.log(`aplicada: ${file}`);
            } catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`falha em ${file}: ${err.message}`);
            }
        }
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
