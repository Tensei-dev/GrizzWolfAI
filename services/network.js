class NetworkError extends Error {}

const NETWORK_CODES = /^(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR_\w+)$/;
const NETWORK_MESSAGES = /fetch failed|timeout|timed out|connection terminated|socket hang up|getaddrinfo/i;

function errorCode(err) {
    return err?.code || err?.cause?.code || err?.cause?.cause?.code || err?.cause?.errors?.[0]?.code || null;
}

function isNetworkError(err) {
    if (err instanceof NetworkError) return true;
    if (['TimeoutError', 'AbortError'].includes(err?.name)) return true;
    return NETWORK_CODES.test(errorCode(err) || '') || NETWORK_MESSAGES.test(err?.message || '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, options = {}, { timeoutMs = 30000, label = url } = {}) {
    try {
        return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
        if (err.name === 'TimeoutError') throw new NetworkError(`${label} não respondeu em ${timeoutMs / 1000}s`);
        throw new NetworkError(`não consegui acessar ${label} (${errorCode(err) || err.message})`);
    }
}

function networkGuard({ probe, maxConsecutive = 3, pauseMs = 60000 }) {
    let consecutive = 0;
    return {
        ok() {
            consecutive = 0;
        },
        async failed(err) {
            if (!isNetworkError(err)) return;
            consecutive++;
            if (consecutive < maxConsecutive) return;
            console.error(`${consecutive} falhas de rede seguidas; esperando ${pauseMs / 1000}s para testar a conexão`);
            await sleep(pauseMs);
            try {
                await probe();
            } catch (probeErr) {
                throw new NetworkError(`a rede caiu (${errorCode(probeErr) || probeErr.message})`);
            }
            console.log('conexão de volta, continuando');
            consecutive = 0;
        },
    };
}

module.exports = { NetworkError, isNetworkError, fetchWithTimeout, networkGuard };
