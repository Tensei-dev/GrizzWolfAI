const fs = require('fs/promises');
const path = require('path');
const { writeFacts } = require('../services/okfFacts');
const { enrichBundle } = require('../services/okfPeople');
const okf = require('../services/okf');
const { politeFetch, isAllowed, robotsFor } = require('../services/politeFetch');
const { networkGuard, NetworkError } = require('../services/network');

const STATE_FILE = path.join(okf.ROOT, '.estado.json');
const today = () => new Date().toISOString().slice(0, 10);
const daysSince = (date) => (date ? (Date.now() - new Date(date).getTime()) / 86400000 : Infinity);
const MIN_BODY_CHARS = 40;
const PAGE_DEADLINE_MS = 90000;

function withDeadline(promise, ms, label) {
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new NetworkError(`${label} não terminou em ${ms / 1000} s`)), ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function option(name, fallback) {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    return arg ? Number(arg.split('=')[1]) : fallback;
}

async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function listMarkdown(dir) {
    const out = [];
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...await listMarkdown(full));
        else if (e.name.endsWith('.md') && e.name !== 'index.md') out.push(full);
    }
    return out;
}

async function writeFile(file, text) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
}

async function discoverNews(unitId, known) {
    const unit = okf.UNITS[unitId];
    const cutoffMonth = okf.cutoffDate().slice(0, 7);
    const found = [];
    for (const listing of okf.NEWS_LISTINGS[unitId] || []) {
        for (let n = 0; n < okf.MAX_LISTING_PAGES; n++) {
            const res = await politeFetch(`${unit.baseUrl}${listing}${n ? `?page=${n}` : ''}`, {}, { label: `a listagem ${listing} de ${unitId}` });
            if (!res.ok) break;
            const paths = okf.parseListing(await res.text(), listing, unit.baseUrl);
            const candidates = paths.filter((p) => !okf.dateFromPath(p) || okf.dateFromPath(p) >= cutoffMonth);
            for (const p of candidates) {
                if (known.has(p)) continue;
                known.add(p);
                found.push({ path: p, url: new URL(encodeURI(p), unit.baseUrl).href, lastmod: null });
            }
            if (!paths.some((p) => okf.dateFromPath(p) >= cutoffMonth)) break;
        }
    }
    return found;
}

async function syncUnit(unitId, { limit, dryRun, revisitDays, state, forced }) {
    const unit = okf.UNITS[unitId];
    const { delayMs } = await robotsFor(unit.baseUrl);
    const sitemap = await (await politeFetch(`${unit.baseUrl}/sitemap.xml`, {}, { label: `o sitemap de ${unitId}` })).text();
    const pages = okf.parseSitemap(sitemap, unit.baseUrl);
    const fromListings = await discoverNews(unitId, new Set(pages.map((p) => p.path)));
    pages.push(...fromListings);

    const selected = [];
    const skipped = {};
    for (const page of pages) {
        const choice = okf.selectPage(unitId, page);
        const reason = !choice.ok ? choice.reason : (await isAllowed(page.url)) ? null : 'bloqueada pelo robots.txt';
        if (reason) skipped[reason] = (skipped[reason] || 0) + 1;
        else selected.push({ ...page, section: choice.section });
    }
    console.log(`[${unitId}] ${pages.length - fromListings.length} endereços no sitemap + ${fromListings.length} notícias/editais das listagens, `
        + `${selected.length} no escopo (intervalo entre requisições: ${delayMs / 1000} s)`);
    for (const [reason, n] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) console.log(`        fora: ${n} — ${reason}`);

    const urlToFile = new Map(selected.map((p) => [p.path, path.join(okf.ROOT, okf.filePathFor(unitId, p.path))]));
    const existing = new Map();
    for (const file of await listMarkdown(path.join(okf.ROOT, unitId))) {
        existing.set(file, okf.parseFrontmatter(await fs.readFile(file, 'utf8')).data);
    }

    const toFetch = selected.filter((p) => {
        if (forced) return forced.has(p.path);
        const file = urlToFile.get(p.path);
        const s = state[`${unitId}${p.path}`];
        if (!existing.has(file) && !s?.descartada) return true;
        if (p.lastmod) return p.lastmod !== s?.lastmod;
        return daysSince(s?.verificadoEm) >= revisitDays;
    });
    const batch = Number.isFinite(limit) ? toFetch.slice(0, limit) : toFetch;
    const minutes = Math.ceil((batch.length * delayMs) / 60000);
    console.log(`        a baixar: ${toFetch.length} (${selected.length - toFetch.length} sem mudança pela data)${batch.length < toFetch.length ? `, nesta rodada ${batch.length}` : ''} · ~${minutes} min`);
    if (dryRun) {
        for (const p of batch.slice(0, 40)) console.log(`        - ${p.path}${p.lastmod ? ` (${p.lastmod})` : ''}`);
        if (batch.length > 40) console.log(`        … e mais ${batch.length - 40}`);
        return { novas: 0, alteradas: 0, iguais: 0, removidas: 0, falhas: 0 };
    }

    const count = { novas: 0, alteradas: 0, iguais: 0, removidas: 0, falhas: 0 };
    const remove = async (file, why) => {
        if (!existing.has(file)) return;
        await fs.rm(file);
        existing.delete(file);
        count.removidas++;
        console.log(`  remove ${path.relative(okf.ROOT, file)} (${why})`);
    };
    const guard = networkGuard({ probe: () => politeFetch(`${unit.baseUrl}/robots.txt`, { method: 'HEAD' }, { timeoutMs: 15000 }) });
    const cutoff = okf.cutoffDate();

    for (const [file, data] of [...existing]) {
        const stale = isLoose(data.secao, data.title) && okf.staleReason(data, cutoff);
        if (!stale || !data.source) continue;
        const key = `${unitId}${new URL(data.source).pathname.replace(/\/+$/, '')}`;
        state[key] = { ...state[key], descartada: true };
        await remove(file, stale);
    }

    for (const [i, page] of batch.entries()) {
        const file = urlToFile.get(page.path);
        const key = `${unitId}${page.path}`;
        try {
            const res = await withDeadline((async () => {
                const r = await politeFetch(page.url, {}, { label: page.url });
                return { status: r.status, ok: r.ok, html: r.ok ? await r.text() : '' };
            })(), PAGE_DEADLINE_MS, page.url);
            if ([404, 410].includes(res.status)) {
                state[key] = { lastmod: page.lastmod, verificadoEm: today(), descartada: true };
                await remove(file, `HTTP ${res.status}`);
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const extracted = okf.extractPage(res.html, page, unitId);
            guard.ok();
            state[key] = { lastmod: page.lastmod, verificadoEm: today() };

            const isNews = ['acontece', 'editais'].includes(page.section) && page.path.split('/').length > 2;
            if (isNews && extracted.published && extracted.published < cutoff) {
                state[key].descartada = true;
                await remove(file, 'mais de 90 dias');
                continue;
            }
            const stale = isLoose(page.section, extracted.title)
                && okf.staleReason({ title: extracted.title, secao: page.section, type: okf.typeOf(page.section, extracted.title), publicado: extracted.published }, cutoff);
            if (stale) {
                state[key].descartada = true;
                await remove(file, stale);
                continue;
            }
            if (extracted.body.length < MIN_BODY_CHARS) {
                state[key].descartada = true;
                await remove(file, 'página sem conteúdo');
                console.log(`  vazia  ${page.path}`);
                continue;
            }

            const body = okf.linkInternal(extracted.body, file, urlToFile);
            const hash = okf.hashOf(`${extracted.title}\n${body}\n${JSON.stringify(extracted.person)}`);
            const before = existing.get(file);
            if (before?.hash === hash) { count.iguais++; continue; }

            const cursos = okf.coursesOf(unitId, page.path);
            const data = {
                type: okf.typeOf(page.section, extracted.title),
                title: extracted.title,
                description: okf.firstSentence(body),
                unidade: unitId,
                secao: page.section,
                cursos,
                tags: [unitId, page.section, ...cursos],
                source: page.url,
                publicado: extracted.published,
                atualizado: extracted.updated || page.lastmod,
                pessoa: extracted.person,
                hash,
            };
            await writeFile(file, `${okf.toFrontmatter(data)}\n# ${extracted.title}\n\n${body}\n`);
            existing.set(file, data);
            count[before ? 'alteradas' : 'novas']++;
            console.log(`  ${before ? 'altera' : 'nova  '} [${i + 1}/${batch.length}] ${path.relative(okf.ROOT, file)}`);
        } catch (err) {
            count.falhas++;
            console.error(`  falha  ${page.path}: ${err.message}`);
            try { await guard.failed(err); } catch (down) { console.error(`  ${down.message}; rode de novo para continuar`); break; }
        }
    }

    const inScope = new Set(urlToFile.values());
    for (const [file, data] of [...existing]) {
        if (!inScope.has(file)) await remove(file, 'fora do sitemap ou do escopo');
        else if (['noticia', 'edital'].includes(data.type) && data.publicado && data.publicado < cutoff) await remove(file, 'mais de 90 dias');
    }
    await repairLinks(existing, urlToFile, unit.baseUrl);
    await writeIndex(unitId, existing);
    return count;
}

async function repairLinks(existing, urlToFile, baseUrl) {
    const fileToPath = new Map([...urlToFile].map(([pagePath, file]) => [file, pagePath]));
    for (const file of existing.keys()) {
        const text = await fs.readFile(file, 'utf8');
        const fixed = text.replace(/\]\(([^)\s]+\.md)\)/g, (match, target) => {
            const absolute = path.resolve(path.dirname(file), target);
            if (existing.has(absolute)) return match;
            const pagePath = fileToPath.get(absolute);
            return pagePath ? `](${new URL(encodeURI(pagePath), baseUrl).href})` : match;
        });
        if (fixed !== text) await fs.writeFile(file, fixed);
    }
}

function isLoose(section, title = '') {
    return section === 'node' || /^teste/i.test(title);
}

async function writeIndex(unitId, existing) {
    const bySection = {};
    for (const [file, data] of existing) (bySection[data.secao || 'outros'] ||= []).push({ file, data });
    const dir = path.join(okf.ROOT, unitId);
    const lines = [
        '---', `type: "indice"`, `title: ${JSON.stringify(`Páginas do site da ${unitId.toUpperCase()}`)}`, `unidade: ${JSON.stringify(unitId)}`,
        `source: ${JSON.stringify(okf.UNITS[unitId].baseUrl)}`, '---', '', `# Páginas do site da ${unitId.toUpperCase()}`, '',
    ];
    for (const section of Object.keys(bySection).sort()) {
        const items = bySection[section].sort((a, b) => a.file.localeCompare(b.file));
        lines.push(`## ${section} (${items.length})`, '');
        for (const { file, data } of items) {
            const rel = path.relative(dir, file).split(path.sep).join('/');
            lines.push(`- [${data.title || rel}](${rel})${data.description ? ` — ${data.description}` : ''}`);
        }
        lines.push('');
    }
    await writeFile(path.join(dir, 'index.md'), `${lines.join('\n').trim()}\n`);
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const limit = option('limit', Infinity);
    const revisitDays = option('revisar-dias', 7);
    const listed = process.argv.find((a) => a.startsWith('--paginas='))?.split('=')[1];
    const forced = listed ? new Set(listed.split(',').map((p) => `/${p.trim().replace(/^\/+|\/+$/g, '')}`)) : null;
    const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    const unitIds = requested.length ? requested : Object.keys(okf.UNITS);
    for (const id of unitIds) if (!okf.UNITS[id]) throw new Error(`unidade desconhecida: ${id} (use ${Object.keys(okf.UNITS).join(', ')})`);

    const state = await readJson(STATE_FILE, {});
    let failures = 0;
    for (const unitId of unitIds) {
        try {
            const c = await syncUnit(unitId, { limit, dryRun, revisitDays, state, forced });
            failures += c.falhas;
            if (!dryRun) console.log(`[${unitId}] ${c.novas} novas, ${c.alteradas} alteradas, ${c.iguais} iguais (sem reescrever), ${c.removidas} removidas, ${c.falhas} falhas`);
        } catch (err) {
            failures++;
            console.error(`[${unitId}] ${err.message}`);
        }
    }
    if (!dryRun) {
        const sorted = Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b)));
        await writeFile(STATE_FILE, `${JSON.stringify(sorted, null, 1)}\n`);
        const enriched = await enrichBundle();
        console.log(`perfis: ${enriched.comEmail} com e-mail e ${enriched.comAreas} com áreas de pesquisa (${enriched.alterados} atualizados)`);
        const facts = await writeFacts();
        console.log(`fatos fixos: ${Object.keys(facts.cursos).length} cursos e ${Object.keys(facts.unidades).length} unidades em conhecimento/fatos.json`);
        if (facts.faltando.length) console.error(`páginas de contato que sumiram do pacote: ${facts.faltando.join(', ')}`);
    }
    if (failures) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
