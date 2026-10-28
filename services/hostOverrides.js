require('dotenv').config();
const dns = require('dns');

// IP fixo por host, para quando o DNS do site de uma unidade falhar (FACOM_IP, IME_IP no .env).
const OVERRIDES = {};
for (const [unit, ip] of [['facom', process.env.FACOM_IP], ['ime', process.env.IME_IP]]) {
    if (ip) for (const host of [`${unit}.ufu.br`, `www.${unit}.ufu.br`]) OVERRIDES[host] = ip;
}

if (Object.keys(OVERRIDES).length) {
    const originalLookup = dns.lookup;
    dns.lookup = function lookup(hostname, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        const ip = OVERRIDES[hostname];
        if (!ip) return originalLookup.call(dns, hostname, options, callback);
        if (options?.all) return process.nextTick(callback, null, [{ address: ip, family: 4 }]);
        return process.nextTick(callback, null, ip, 4);
    };
}
