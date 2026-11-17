const path = require('path');

// Uso diário das APIs com cota, por origem. Serve para as importações deixarem uma reserva para o chat: a cota
// diária do Gemini é uma só para os vetores das importações e das buscas.

const TODAY = `(now() AT TIME ZONE 'America/Los_Angeles')::date`; // a cota do Gemini renova à meia-noite do Pacífico

// pool só quando usado: os testes e scripts sem banco carregam embeddings.js sem precisar dele
const db = () => require('../db/pool');

// Origem padrão: o script que está rodando (import-okf, sync-documents…); no servidor, "servidor".
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
        // a contagem não pode derrubar a busca nem a importação
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
