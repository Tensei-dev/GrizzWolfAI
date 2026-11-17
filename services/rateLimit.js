const crypto = require('crypto');
const pool = require('../db/pool');

// Limite de requisições por visitante, guardado no banco (na Vercel, cada requisição pode cair numa instância
// diferente). O visitante é um hash do IP com um sal secreto: o IP não é gravado.

const WINDOWS = { min: 60, dia: 86400 };
const CLEANUP_CHANCE = 0.02; // de vez em quando, apaga as janelas antigas

// Sem RATE_LIMIT_SALT, o sal sai do DATABASE_URL, que já é secreto: sem sal, o hash de um IPv4 se desfaz por força bruta.
const SALT = process.env.RATE_LIMIT_SALT || crypto.createHash('sha256').update(process.env.DATABASE_URL || 'grizz').digest('hex');

function clientIp(req) {
    // na Vercel, x-vercel-forwarded-for é preenchido pela própria plataforma; x-forwarded-for pode vir do cliente
    const forwarded = req.headers['x-vercel-forwarded-for'] || (process.env.VERCEL ? req.headers['x-forwarded-for'] : null);
    return (forwarded ? String(forwarded).split(',')[0].trim() : req.socket?.remoteAddress) || 'desconhecido';
}

const visitorOf = (req) => crypto.createHash('sha256').update(`${SALT}:${clientIp(req)}`).digest('hex').slice(0, 32);

async function hit(bucket, visitor, seconds) {
    const { rows } = await pool.query(
        `INSERT INTO rate_limits (bucket, visitor, window_start, hits)
         VALUES ($1, $2, to_timestamp(floor(extract(epoch FROM now()) / $3) * $3), 1)
         ON CONFLICT (bucket, visitor, window_start) DO UPDATE SET hits = rate_limits.hits + 1
         RETURNING hits, extract(epoch FROM (window_start + make_interval(secs => $3) - now()))::int AS reset_in`,
        [bucket, visitor, seconds]
    );
    return rows[0];
}

// limits: { min: 5, dia: 25 }. Passou de algum, responde 429 com Retry-After e a mensagem do Grizz.
function rateLimit(name, limits, message) {
    return async (req, res, next) => {
        let blocked = null;
        try {
            const visitor = visitorOf(req);
            for (const [window, max] of Object.entries(limits)) {
                if (!max) continue;
                const { hits, reset_in: resetIn } = await hit(`${name}:${window}`, visitor, WINDOWS[window]);
                if (hits > max && !blocked) blocked = { window, resetIn: Math.max(resetIn, 1) };
            }
            if (Math.random() < CLEANUP_CHANCE) {
                pool.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'`).catch(() => {});
            }
        } catch (err) {
            // sem o banco, o chat também não responderia; não é o limite que deve derrubar a requisição
            console.error(`limite de requisições indisponível, deixando passar: ${err.message}`);
            return next();
        }
        if (!blocked) return next();
        res.set('Retry-After', String(blocked.resetIn));
        return res.status(429).json({ error: message(blocked) });
    };
}

module.exports = { rateLimit, clientIp, visitorOf };
