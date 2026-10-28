require('dotenv').config();
const { Pool } = require('pg');

// Sem limite, uma conexão travada com o Neon seguraria a requisição ou a importação para sempre.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
    query_timeout: 60000,
});

pool.on('error', (err) => {
    console.error(`conexão ociosa com o banco encerrada: ${err.message}`);
});

module.exports = pool;
