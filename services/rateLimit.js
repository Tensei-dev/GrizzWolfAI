const crypto = require('crypto');
const pool = require('../db/pool');

const WINDOWS = { min: 60, dia: 86400 };
const CLEANUP_CHANCE = 0.02;

const SALT = process.env.RATE_LIMIT_SALT || crypto.createHash('sha256').update(process.env.DATABASE_URL || 'grizz').digest('hex');

function clientIp(req) {
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
            console.error(`limite de requisições indisponível, deixando passar: ${err.message}`);
            return next();
        }
        if (!blocked) return next();
        res.set('Retry-After', String(blocked.resetIn));
        return res.status(429).json({ error: message(blocked) });
    };
}

module.exports = { rateLimit, clientIp, visitorOf };
