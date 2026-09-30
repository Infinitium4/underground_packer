const CACHE_TTL = 24 * 60 * 60 * 1000;

const retryDelay = (header, now, failures = 0) => {
    const seconds = header?.trim() ? Number(header) : NaN;
    const date = header ? Date.parse(header) : NaN;
    const supplied = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : (Number.isFinite(date) ? date - now : NaN);
    return Number.isFinite(supplied) && supplied >= 0
        ? Math.max(1000, supplied) + 1000
        : Math.min(60 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.min(failures, 4));
};

const createSpotifyClient = (db, { fetchImpl = (...args) => fetch(...args), now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), interval = 500 } = {}) => {
    let lastRequest = 0;
    const read = async (key) => {
        const row = await db.get('SELECT value, updated_at FROM spotify_cache WHERE key=?', [key]);
        if (!row) return null;
        try { return { value: JSON.parse(row.value), updatedAt: row.updated_at }; } catch { return null; }
    };
    const write = (key, value) => db.run(`INSERT INTO spotify_cache (key,value,updated_at) VALUES (?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`, [key, JSON.stringify(value), now()]);
    const limited = (retryAt) => Object.assign(new Error(`Quota Spotify atteint. Prochain essai autorisé : ${new Date(retryAt).toLocaleString('fr-FR')}`), { retryAt });
    const request = async (url, options = {}) => {
        const cacheable = url.startsWith('https://api.spotify.com/v1/search?');
        if (cacheable) {
            const cached = await read(url);
            if (cached && now() - cached.updatedAt < CACHE_TTL) return Response.json(cached.value);
        }
        const cooldown = (await read('cooldown'))?.value;
        if (cooldown?.until > now()) throw limited(cooldown.until);
        await sleep(Math.max(0, interval - (now() - lastRequest)));
        lastRequest = now();
        const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(20000) });
        if (response.status === 429) {
            const until = now() + retryDelay(response.headers.get('retry-after'), now(), cooldown?.failures || 0);
            await write('cooldown', { until, failures: (cooldown?.failures || 0) + 1 });
            throw limited(until);
        }
        if (response.ok && cacheable) {
            await write(url, await response.clone().json());
            if (cooldown) await write('cooldown', { until: 0, failures: 0 });
        }
        return response;
    };
    return { request, read, write };
};
module.exports = { createSpotifyClient, retryDelay, CACHE_TTL };
