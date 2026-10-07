const crypto = require('crypto');

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});
const dayKey = (date) => dayFormatter.format(date);

const nextRefresh = (now) => {
    const day = dayKey(now);
    let low = now.getTime();
    let high = low + 27 * 60 * 60 * 1000;
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (dayKey(new Date(middle)) === day) low = middle;
        else high = middle;
    }
    return new Date(high).toISOString();
};

const createDailyShop = (db, getPool) => async (now = new Date()) => db.transaction(async () => {
    const date = dayKey(now);
    const refreshAt = nextRefresh(now);
    const saved = await db.get('SELECT cards FROM daily_shop WHERE date = ?', [date]);
    if (saved) return { date, refreshAt, cards: JSON.parse(saved.cards) };

    const pool = [...getPool()];
    if (!pool.length) return { date, refreshAt, cards: [] };
    for (let index = pool.length - 1; index > 0; index -= 1) {
        const selected = crypto.randomInt(index + 1);
        [pool[index], pool[selected]] = [pool[selected], pool[index]];
    }
    const previous = await db.get('SELECT cards FROM daily_shop WHERE date < ? ORDER BY date DESC LIMIT 1', [date]);
    const previousIds = new Set(previous ? JSON.parse(previous.cards).map((card) => card.id) : []);
    // Prioritize new titles when the catalog is large enough.
    const ordered = [...pool.filter((track) => !previousIds.has(track.id)), ...pool.filter((track) => previousIds.has(track.id))];
    const cards = ordered.slice(0, 6).map((track, index) => ({
        id: track.id, name: track.name, artist: track.artists?.[0]?.name || 'Artiste inconnu',
        cover: track.album?.images?.[0]?.url || null,
        spotifyUrl: track.external_urls?.spotify || null, previewUrl: track.preview_url || null,
        price: 150 + (index % 5) * 100,
    }));
    await db.run('INSERT INTO daily_shop (date, cards) VALUES (?, ?)', [date, JSON.stringify(cards)]);
    return { date, refreshAt, cards };
});

module.exports = { createDailyShop, dayKey, nextRefresh };
