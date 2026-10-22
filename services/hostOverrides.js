require('dotenv').config();
const dns = require('dns');

const FACOM_HOSTS = ['facom.ufu.br', 'www.facom.ufu.br'];
const FACOM_IP = process.env.FACOM_IP;

if (FACOM_IP) {
    const originalLookup = dns.lookup;
    dns.lookup = function lookup(hostname, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        if (!FACOM_HOSTS.includes(hostname)) return originalLookup.call(dns, hostname, options, callback);
        if (options?.all) return process.nextTick(callback, null, [{ address: FACOM_IP, family: 4 }]);
        return process.nextTick(callback, null, FACOM_IP, 4);
    };
}
