const path = require('path');

const TODAY = `(now() AT TIME ZONE 'America/Los_Angeles')::date`;

const db = () => require('../db/pool');

function defaultSource() {
    const main = require.main?.filename;
    if (!main) return 'servidor';
    const name = path.basename(main, '.js');
    return ['server', 'index'].includes(name) ? 'servidor' : name;
}

async function record(service, source, units) {
    try {
        await db().query(
            `INSERT INTO api_usage (day, service, source, units) VALUES (${TODAY}, $1, $2, $3)
             ON CONFLICT (day, service, source) DO UPDATE SET units = api_usage.units + EXCLUDED.units`,
            [service, source, units]
        );
    } catch (err) {
        console.error(`não consegui registrar o uso de ${service}: ${err.message}`);
    }
}

async function today(service) {
    const { rows } = await db().query(
        `SELECT source, units FROM api_usage WHERE day = ${TODAY} AND service = $1 ORDER BY units DESC`,
        [service]
    );
    const bySource = Object.fromEntries(rows.map((r) => [r.source, r.units]));
    return { total: rows.reduce((sum, r) => sum + r.units, 0), bySource };
}

module.exports = { record, today, defaultSource };
