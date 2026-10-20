require('dotenv').config();
const { Pool } = require('pg');

// o SSL é configurado pelo sslmode da DATABASE_URL
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// o Neon encerra conexões ociosas quando o banco "dorme"; sem este handler,
// o erro emitido pela conexão parada derruba o processo inteiro
pool.on('error', (err) => {
    console.error(`conexão ociosa com o banco encerrada: ${err.message}`);
});

module.exports = pool;
