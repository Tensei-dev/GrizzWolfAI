const { fetchWithTimeout } = require('./network');

const USER_AGENT = 'GrizzWolfAI/1.0 (+https://github.com/Tensei-dev/GrizzWolfAI)';
const DEFAULT_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

const robotsByOrigin = new Map();
const nextSlotByHost = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseRobots(text) {
    const rules = { delayMs: DEFAULT_DELAY_MS, disallow: [] };
    let inGroup = false;
    for (const raw of text.split('\n')) {
        const line = raw.replace(/#.*/, '').trim();
        const [key, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        if (!key || !line.includes(':')) continue;
        const k = key.trim().toLowerCase();
        if (k === 'user-agent') inGroup = value === '*';
        else if (inGroup && k === 'crawl-delay') rules.delayMs = Math.min(MAX_DELAY_MS, Number(value) * 1000 || DEFAULT_DELAY_MS);
        else if (inGroup && k === 'disallow' && value) rules.disallow.push(value);
    }
    return rules;
}

async function robotsFor(origin) {
    if (!robotsByOrigin.has(origin)) {
        robotsByOrigin.set(origin, (async () => {
            try {
                const res = await fetchWithTimeout(`${origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT } }, { timeoutMs: 15000 });
                return res.ok ? parseRobots(await res.text()) : { delayMs: DEFAULT_DELAY_MS, disallow: [] };
            } catch {
                return { delayMs: DEFAULT_DELAY_MS, disallow: [] };
            }
        })());
    }
    return robotsByOrigin.get(origin);
}

function matchesRule(pathAndQuery, rule) {
    const pattern = rule.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${pattern}`).test(pathAndQuery);
}

async function isAllowed(url) {
    const u = new URL(url);
    const { disallow } = await robotsFor(u.origin);
    return !disallow.some((rule) => matchesRule(u.pathname + u.search, rule));
}

async function waitTurn(url) {
    const u = new URL(url);
    const { delayMs } = await robotsFor(u.origin);
    const now = Date.now();
    const slot = Math.max(now, nextSlotByHost.get(u.host) || 0);
    nextSlotByHost.set(u.host, slot + delayMs);
    if (slot > now) await sleep(slot - now);
}

async function politeFetch(url, options = {}, { timeoutMs = 30000, label = url } = {}) {
    await waitTurn(url);
    return fetchWithTimeout(url, { ...options, headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) } }, { timeoutMs, label });
}

module.exports = { politeFetch, isAllowed, robotsFor, USER_AGENT };
