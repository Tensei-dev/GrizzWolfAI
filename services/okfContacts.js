const path = require('path');

const PERSON_LINK = /\[[^\]]+\]\(([^)]*pessoas\/[^)\s]+?)(?:\s+"[^"]*")?\)/;
const MAILTO = /\(mailto:([^)\s?]+)/i;

function resolver(entries) {
    const bySource = new Map(entries.map((e) => [path.resolve(e.file), e.data.source]));
    return (file, href) => (/^https?:/.test(href) ? href.replace(/\/+$/, '') : bySource.get(path.resolve(path.dirname(file), href)));
}

function phonesFrom(entries) {
    const target = resolver(entries);
    const phones = new Map();
    for (const e of entries.filter((x) => x.data.secao === 'telefones')) {
        for (const line of e.body.split('\n')) {
            const m = line.match(/\[[^\]]+\]\(([^)]+)\)\s*—\s*([+\d][\d\s()+-]{6,}\d)(?:.*?Ramal:\*\*\s*(\d+))?/);
            if (!m) continue;
            const source = target(e.file, m[1]);
            if (source) phones.set(source, { telefone: m[2].trim(), ramal: m[3] || null });
        }
    }
    return phones;
}

function emailsFrom(entries) {
    const target = resolver(entries);
    const votes = new Map();
    for (const e of entries.filter((x) => x.data.type !== 'pessoa')) {
        let current = null;
        for (const line of e.body.split('\n')) {
            const heading = /^#{1,6}\s/.test(line);
            const person = heading && line.match(PERSON_LINK);
            if (person) { current = target(e.file, person[1]) || null; continue; }
            if (heading || PERSON_LINK.test(line)) { current = null; continue; }
            const mail = current && line.match(MAILTO);
            if (!mail) continue;
            const email = mail[1].toLowerCase();
            const counts = votes.get(current) || new Map();
            counts.set(email, (counts.get(email) || 0) + 1);
            votes.set(current, counts);
            current = null;
        }
    }
    const chosen = [...votes].map(([source, counts]) => [source, [...counts].sort((a, b) => b[1] - a[1])[0][0]]);
    const owners = new Map();
    for (const [, email] of chosen) owners.set(email, (owners.get(email) || 0) + 1);
    return new Map(chosen.filter(([, email]) => owners.get(email) === 1));
}

module.exports = { phonesFrom, emailsFrom };
