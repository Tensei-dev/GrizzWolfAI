// Importa o pacote OKF (conhecimento/) para o banco: só o que é novo ou mudou, comparando o hash de cada arquivo
// com o guardado no banco (mesmo efeito do git diff, sem depender do histórico do git).
//   npm run okf:import                  importa páginas e perfis
//   npm run okf:import -- --dry-run     só mostra o que mudaria, sem gerar vetores nem gravar
//   npm run okf:import -- --limit=20    importa no máximo 20 páginas (os vetores gastam cota do Gemini)
//   npm run okf:import -- --max-trechos=300   para antes de passar de 300 trechos (vetores) na rodada: a cota diária
//                                       do Gemini é a mesma das buscas do chat, e a Action deixa sobra para elas
// Páginas viram documentos (kind pagina/noticia/edital) com trechos por seção; perfis vão para a tabela pessoas,
// buscada só por palavra-chave. O que saiu do pacote fica com status "removido".
const fs = require('fs/promises');
const path = require('path');
const pool = require('../db/pool');
const okf = require('../services/okf');
const Document = require('../models/Document');
const Person = require('../models/Person');
const { chunkMarkdown } = require('../services/chunker');
const { embedDocuments, DailyQuotaError } = require('../services/embeddings');
const { ensureCategories } = require('../services/ingestion');
const { linkPage } = require('../services/knowledgeGraph');
const { UNITS } = require('../services/unitCrawler');
const { networkGuard } = require('../services/network');
const usage = require('../services/usage');

const KINDS = { pagina: ['pagina', 'página'], noticia: ['noticia', 'notícia'], edital: ['edital', 'edital'] };

function option(name, fallback) {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    return arg ? Number(arg.split('=')[1]) : fallback;
}

async function readBundle(dir = okf.ROOT, out = []) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await readBundle(full, out);
        else if (e.name.endsWith('.md') && e.name !== 'index.md') {
            const { data, body } = okf.parseFrontmatter(await fs.readFile(full, 'utf8'));
            if (data.source && data.type) out.push({ file: full, okfPath: path.relative(okf.ROOT, full).split(path.sep).join('/'), data, body });
        }
    }
    return out;
}

const bodyWithoutTitle = (body) => body.replace(/^\s*# .*\n+/, '').trim();

// A página de telefones de cada unidade lista "Nome — telefone · Ramal": vira telefone e ramal no perfil.
function phonesFrom(entries) {
    const bySource = new Map(entries.map((e) => [e.file, e.data.source]));
    const phones = new Map();
    for (const e of entries.filter((x) => x.data.secao === 'telefones')) {
        for (const line of e.body.split('\n')) {
            const m = line.match(/\[[^\]]+\]\(([^)]+)\)\s*—\s*([+\d][\d\s()+-]{6,}\d)(?:.*?Ramal:\*\*\s*(\d+))?/);
            if (!m) continue;
            const target = /^https?:/.test(m[1]) ? m[1] : bySource.get(path.resolve(path.dirname(e.file), m[1]));
            if (target) phones.set(target, { telefone: m[2].trim(), ramal: m[3] || null });
        }
    }
    return phones;
}

async function importPeople(entries, phones, { dryRun }) {
    const people = entries.filter((e) => e.data.type === 'pessoa');
    const inDb = new Map((await Person.findAll()).map((p) => [p.source_url, p]));
    const count = { novos: 0, alterados: 0, iguais: 0, removidos: 0 };
    for (const e of people) {
        const phone = phones.get(e.data.source) || {};
        // o telefone vem de outro arquivo (telefones.md): entra no hash para uma mudança dele também contar
        const contentHash = `${e.data.hash}|${phone.telefone || ''}|${phone.ramal || ''}`;
        const before = inDb.get(e.data.source);
        if (before && before.content_hash === contentHash && before.status === 'ativo') { count.iguais++; continue; }
        count[before ? 'alterados' : 'novos']++;
        if (dryRun) continue;
        const p = e.data.pessoa || {};
        await Person.upsert({
            source_url: e.data.source,
            okf_path: e.okfPath,
            unidade: e.data.unidade,
            nome: e.data.title,
            categoria: p.categoria,
            cargo: p.cargo,
            funcao: p.funcao,
            situacao: p.situacao,
            titulacao: p.titulacao,
            regime: p.regime,
            lotacao: p.unidade_organizacional,
            endereco: p.endereco,
            email: p.email,
            telefone: phone.telefone || p.telefone,
            ramal: phone.ramal,
            resumo: bodyWithoutTitle(e.body),
            atualizado: e.data.atualizado,
            content_hash: contentHash,
        });
    }
    const present = new Set(people.map((e) => e.data.source));
    const gone = [...inDb.values()].filter((p) => p.status === 'ativo' && !present.has(p.source_url));
    count.removidos = gone.length;
    if (!dryRun) await Person.markRemoved(gone.map((p) => p.id));
    return count;
}

async function importPages(entries, { dryRun, limit, maxChunks = Infinity }) {
    const pages = entries.filter((e) => KINDS[e.data.type]);
    const inDb = new Map((await Document.listPages()).map((d) => [d.source_url, d]));
    const changed = pages.filter((e) => {
        const before = inDb.get(e.data.source);
        return !before || before.content_hash !== e.data.hash || before.status !== 'vigente';
    });
    const present = new Set(pages.map((e) => e.data.source));
    const gone = [...inDb.values()].filter((d) => d.status === 'vigente' && !present.has(d.source_url));
    const batch = Number.isFinite(limit) ? changed.slice(0, limit) : changed;
    console.log(`páginas: ${pages.length} no pacote, ${changed.length} novas ou alteradas`
        + `${batch.length < changed.length ? ` (nesta rodada ${batch.length})` : ''}, ${gone.length} saíram do pacote`);

    const count = { novas: 0, alteradas: 0, removidas: gone.length, trechos: 0, falhas: 0 };
    if (dryRun) {
        for (const e of batch.slice(0, 30)) console.log(`  ${inDb.has(e.data.source) ? 'altera' : 'nova  '} ${e.okfPath}`);
        for (const d of gone.slice(0, 30)) console.log(`  remove ${d.source_url}`);
        return count;
    }

    const categories = await ensureCategories(Object.values(UNITS).map((u) => u.category));
    const guard = networkGuard({ probe: () => pool.query('SELECT 1') });
    for (const [i, e] of batch.entries()) {
        const chunks = chunkMarkdown(e.body, e.data.title);
        if (!chunks.length) continue;
        if (count.trechos + chunks.length > maxChunks) {
            console.log(`  limite de ${maxChunks} trechos desta rodada atingido; o resto entra na próxima`);
            break;
        }
        try {
            // o vetor de cada trecho leva o título da página e da seção: o trecho sozinho perde o contexto
            const embeddings = await embedDocuments(chunks.map((c) => `${c.heading}\n\n${c.content}`));
            const [kind, docType] = KINDS[e.data.type];
            const saved = await Document.savePage({
                title: e.data.title,
                docType,
                kind,
                issuer: e.data.unidade.toUpperCase(),
                sourceUrl: e.data.source,
                publishedAt: e.data.publicado || null,
                subject: e.data.description || null,
                contentHash: e.data.hash,
                okfPath: e.okfPath,
            }, chunks.map((c, k) => ({ ...c, embedding: embeddings[k] })), categories[e.data.unidade]?.id);
            await linkPage({ documentId: saved.id, title: e.data.title, description: e.data.description, unidade: e.data.unidade, cursos: e.data.cursos });
            count[saved.created ? 'novas' : 'alteradas']++;
            count.trechos += chunks.length;
            console.log(`  ${saved.created ? 'nova  ' : 'altera'} [${i + 1}/${batch.length}] ${e.okfPath}: ${chunks.length} trechos`);
            guard.ok();
        } catch (err) {
            count.falhas++;
            console.error(`  falha  ${e.okfPath}: ${err.message}`);
            if (err instanceof DailyQuotaError) break;
            try { await guard.failed(err); } catch (down) { console.error(`  ${down.message}; rode de novo para continuar`); break; }
        }
    }
    await Document.markPagesRemoved(gone.map((d) => d.id));
    return count;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const limit = option('limit', Infinity);
    if (!dryRun && !process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não definida no .env');

    const entries = await readBundle();
    const phones = phonesFrom(entries);
    const people = await importPeople(entries, phones, { dryRun });
    console.log(`pessoas: ${people.novos} novas, ${people.alterados} alteradas, ${people.iguais} iguais, ${people.removidos} removidas`
        + ` · ${phones.size} telefones encontrados nas páginas de telefones`);
    const pages = await importPages(entries, { dryRun, limit, maxChunks: option('max-trechos', Infinity) });
    if (!dryRun) {
        console.log(`páginas: ${pages.novas} novas, ${pages.alteradas} alteradas, ${pages.removidas} removidas, `
            + `${pages.trechos} trechos com vetor, ${pages.falhas} falhas`);
    }
    const used = await usage.today('gemini');
    console.log(`gemini hoje: ${used.total} vetores (${Object.entries(used.bySource).map(([s, n]) => `${s} ${n}`).join(', ') || 'nenhum'})`);
    if (pages.falhas) process.exitCode = 1;
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
