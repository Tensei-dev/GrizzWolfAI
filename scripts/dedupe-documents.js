// marca como duplicados os documentos com o mesmo texto de outro já importado.
// o duplicado perde os trechos (sai da busca), mas continua no banco para a
// sincronização não reimportar o link dele
// uso: npm run dedupe            (aplica)
//      npm run dedupe -- --dry-run  (só lista)
const pool = require('../db/pool');

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    // documentos cujo texto completo (todos os trechos em ordem) é idêntico
    const { rows } = await pool.query(`
        WITH texts AS (
            SELECT d.id, d.title, d.number,
                   md5(string_agg(c.content, E'\\n' ORDER BY c.chunk_index)) AS text_hash
            FROM documents d JOIN chunks c ON c.document_id = d.id
            WHERE d.status <> 'duplicado'
            GROUP BY d.id
        )
        SELECT json_agg(json_build_object('id', id, 'title', title, 'number', number) ORDER BY id) AS docs
        FROM texts GROUP BY text_hash HAVING count(*) > 1
    `);

    let marked = 0;
    for (const { docs } of rows) {
        // mantém o que tem número identificado (ex.: "Resolução nº 30/2026"); no empate, o mais antigo
        const keep = docs.find((d) => d.number) || docs[0];
        const duplicates = docs.filter((d) => d.id !== keep.id).map((d) => d.id);
        console.log(`mantém #${keep.id} ${keep.title}`);
        for (const d of docs) if (d.id !== keep.id) console.log(`  duplicado #${d.id} ${d.title}`);

        if (!dryRun) {
            await pool.query('DELETE FROM chunks WHERE document_id = ANY($1)', [duplicates]);
            await pool.query(
                `UPDATE documents SET status = 'duplicado', replaced_by = $2, updated_at = now() WHERE id = ANY($1)`,
                [duplicates, keep.id]
            );
            marked += duplicates.length;
        }
    }
    console.log(dryRun ? `${rows.length} grupos de duplicados` : `${marked} documentos marcados como duplicados`);
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
