const path = require('path');

// Contatos das pessoas que estão fora do perfil delas: o telefone e o ramal vêm da página de telefones, e o e-mail das
// listas de docentes e técnicos ("### [Nome](pessoas/...md)" seguido de "[email](mailto:...)"), que os perfis do site
// não mostram. As entradas são os arquivos do pacote: { file, data, body }.

const PERSON_LINK = /\[[^\]]+\]\(([^)]*pessoas\/[^)\s]+?)(?:\s+"[^"]*")?\)/;
const MAILTO = /\(mailto:([^)\s?]+)/i;

function resolver(entries) {
    const bySource = new Map(entries.map((e) => [path.resolve(e.file), e.data.source]));
    // o link pode ser relativo (pessoas/docentes/x.md) ou o endereço do site (https://facom.ufu.br/pessoas/docentes/x)
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

// Só nas listas de docentes e técnicos, em que cada pessoa abre um bloco com o próprio título ("### [Nome](...)"):
// nas páginas de colegiado, comissão e secretaria, o e-mail depois de "**Secretário:** [Nome]" ou do último membro
// é o do setor (cocma@, ime@, o da comissão), não o da pessoa. Se as listas discordam, vale o que aparece mais.
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
            current = null; // um e-mail por pessoa em cada bloco
        }
    }
    const chosen = [...votes].map(([source, counts]) => [source, [...counts].sort((a, b) => b[1] - a[1])[0][0]]);
    // o mesmo e-mail para duas pessoas é de um setor (ex.: ime@ufu.br na lista de técnicos): não vai para nenhuma
    const owners = new Map();
    for (const [, email] of chosen) owners.set(email, (owners.get(email) || 0) + 1);
    return new Map(chosen.filter(([, email]) => owners.get(email) === 1));
}

module.exports = { phonesFrom, emailsFrom };
