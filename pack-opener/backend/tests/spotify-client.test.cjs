const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSpotifyClient, retryDelay } = require('../spotify-client');

test('Retry-After is respected, including long delays and missing headers', () => {
    assert.equal(retryDelay('86400', 0), 86401000);
    assert.equal(retryDelay(null, 0), 300000);
    assert.equal(retryDelay('bad header', 0, 2), 1200000);
    assert.equal(retryDelay('Thu, 01 Jan 1970 00:01:00 GMT', 0), 61000);
});

test('cached pages are reused and cooldown survives client restart', async () => {
    const rows = new Map();
    const db = {
        get: async (_, [key]) => rows.get(key),
        run: async (_, [key, value, updated_at]) => { rows.set(key, { value, updated_at }); },
    };
    let clock = 10000;
    let calls = 0;
    const options = { now: () => clock, sleep: async (ms) => { clock += ms; }, fetchImpl: async () => {
        calls++;
        return calls === 1 ? Response.json({ tracks: { items: [{ id: 'saved-track' }] } })
            : new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } });
    } };
    const client = createSpotifyClient(db, options);
    const first = 'https://api.spotify.com/v1/search?offset=0';
    await client.request(first);
    await assert.rejects(client.request('https://api.spotify.com/v1/search?offset=10'), (error) => error.retryAt > clock + 3600000);
    const restarted = createSpotifyClient(db, options);
    const cached = await restarted.request(first);
    assert.equal((await cached.json()).tracks.items[0].id, 'saved-track');
    await assert.rejects(restarted.request('https://accounts.spotify.com/api/token'), /Quota Spotify/);
    assert.equal(calls, 2, 'no Spotify calls during the persisted cooldown');
});
