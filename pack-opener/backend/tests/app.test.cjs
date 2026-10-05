const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');

async function launch(t, offline = false) {
    const temp = await mkdtemp(path.join(tmpdir(), 'asha-test-'));
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const child = spawn(process.execPath, ['--require', path.join(__dirname, 'spotify-fixture.cjs'), 'server.js'], {
        cwd: path.join(__dirname, '..'), windowsHide: true, stdio: 'ignore',
        env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(temp, 'test.sqlite'), TEST_SPOTIFY_OFFLINE: offline ? '1' : '' },
    });
    t.after(async () => {
        if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
        await rm(temp, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 300; attempt++) {
        try { if ((await fetch(`${base}${offline ? '/app' : '/api/cards'}`)).ok) return base; } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Server did not start');
}

test('accounts, persisted packs and simultaneous purchases', async (t) => {
    const base = await launch(t);
    const request = async (route, body, token) => {
        const response = await fetch(base + route, { method: body ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, ...await response.json() };
    };
    assert.equal((await request('/api/collection')).status, 401);
    const account = await request('/api/auth/register', { email: 'test@example.com', password: 'test-password' });
    assert.equal(account.status, 201);
    const token = account.token;
    const pack = await request('/api/pack/open', {}, token);
    assert.equal(pack.status, 200);
    assert.ok(pack.pack.length > 0);
    assert.equal(new Set(pack.pack.map((card) => card.id)).size, pack.pack.length);
    const collection = await request('/api/collection', null, token);
    assert.equal(collection.collection.reduce((sum, card) => sum + card.quantity, 0), pack.pack.length);
    const catalog = await request('/api/cards');
    const shop = await request('/api/shop');
    assert.equal(shop.cards.length, 6);
    assert.deepEqual((await request('/api/shop')).cards, shop.cards);
    const unavailable = catalog.cards.find((card) => !shop.cards.some((offer) => offer.id === card.id));
    assert.equal((await request('/api/cards/purchase', { id: unavailable.id }, token)).status, 404);
    assert.equal((await request('/api/cards/purchase', { id: shop.cards[0].id, shopDate: 'expired' }, token)).status, 404);
    const purchases = await Promise.all(Array.from({ length: 12 }, () => request('/api/cards/purchase', { id: shop.cards[0].id }, token)));
    assert.equal(purchases.filter((result) => result.status === 200).length, 1);
    assert.equal(purchases.filter((result) => result.status === 409).length, 11);
    assert.equal((await request('/api/shop', null, token)).cards[0].purchased, true);
    assert.equal((await request('/api/shop')).cards[0].purchased, false);
    const me = await request('/api/auth/me', null, token);
    assert.equal(me.user.points, 1050);
    const updated = await request('/api/collection', null, token);
    assert.equal(updated.collection.reduce((sum, card) => sum + card.quantity, 0), pack.pack.length + 1);
    const first = updated.collection.find((card) => card.id === shop.cards[0].id);
    const setPreferences = async (body, session = token) => fetch(`${base}/api/preferences`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` }, body: JSON.stringify(body),
    });
    assert.equal((await setPreferences({ favorites: [first.id], showcase: [first.id], theme: 'violet' })).status, 200);
    const preferences = await request('/api/preferences', null, token);
    assert.deepEqual(preferences.favorites, [first.id]);
    assert.deepEqual(preferences.showcase, [first.id]);
    assert.equal(preferences.theme, 'violet');
    assert.equal((await setPreferences({ favorites: [], showcase: ['1','2','3','4','5','6'], theme: 'gold' })).status, 400);
    assert.equal((await setPreferences({ favorites: ['not-owned'], showcase: [], theme: 'gold' })).status, 400);
    const details = await request(`/api/cards/${encodeURIComponent(first.id)}/details`, null, token);
    assert.equal(details.card.name, first.name);
    const other = await request('/api/auth/register', { email: 'other@example.com', password: 'test-password' });
    assert.deepEqual((await request('/api/preferences', null, other.token)).favorites, []);
    assert.equal((await request(`/api/cards/${encodeURIComponent(first.id)}/details`, null, other.token)).status, 404);
    assert.equal((await setPreferences({ favorites: [first.id], showcase: [], theme: 'gold' }, other.token)).status, 400);
    const artist = catalog.cards[0].artist;
    const themed = await request('/api/pack/open', { artist }, token);
    assert.equal(themed.status, 200);
    assert.equal(themed.pack.length, 5);
    // Legacy artist payloads no longer restrict the general catalog.
    assert.equal((await request('/api/pack/open', { artist: 'unknown artist' }, token)).status, 200);
    const beforeSale = (await request('/api/collection', null, token)).collection.find((card) => card.id === first.id);
    assert.ok(beforeSale.salePrice > 0);
    assert.equal((await request('/api/cards/sell', { id: first.id })).status, 401);
    assert.equal((await request('/api/cards/sell', { id: first.id }, other.token)).status, 404);
    const sales = await Promise.all(Array.from({ length: beforeSale.quantity + 2 }, () => request('/api/cards/sell', { id: first.id, price: 999999 }, token)));
    assert.equal(sales.filter((sale) => sale.status === 200).length, beforeSale.quantity);
    assert.equal(sales.filter((sale) => sale.status === 404).length, 2);
    assert.equal((await request('/api/auth/me', null, token)).user.points, 1050 + beforeSale.quantity * beforeSale.salePrice);
    assert.ok(!(await request('/api/collection', null, token)).collection.some((card) => card.id === first.id));
    assert.equal((await request('/api/cards/purchase', { id: first.id }, token)).status, 409);
    assert.equal((await request('/api/cards/purchase', { id: first.id }, other.token)).status, 200);
    const cleaned = await request('/api/preferences', null, token);
    assert.deepEqual(cleaned.favorites, []);
    assert.deepEqual(cleaned.showcase, []);
    assert.equal(cleaned.theme, 'violet');
    await request('/api/auth/logout', {}, token);
    assert.equal((await request('/api/auth/me', null, token)).status, 401);
});

test('interface remains available when Spotify is offline', async (t) => {
    const base = await launch(t, true);
    assert.match(await (await fetch(`${base}/app`)).text(), /collection-search/);
    assert.equal((await fetch(`${base}/api/cards`)).status, 503);
});
