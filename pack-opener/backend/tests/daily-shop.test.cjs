const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDailyShop, dayKey, nextRefresh } = require('../daily-shop');

test('Paris midnight follows summer and winter time, including clock changes', () => {
    assert.equal(dayKey(new Date('2026-10-05T22:00:00Z')), '2026-10-06');
    assert.equal(nextRefresh(new Date('2026-10-05T12:00:00Z')), '2026-10-05T22:00:00.000Z');
    assert.equal(nextRefresh(new Date('2026-01-05T12:00:00Z')), '2026-01-05T23:00:00.000Z');
    assert.equal(nextRefresh(new Date('2026-03-28T23:00:00Z')), '2026-03-29T22:00:00.000Z');
    assert.equal(nextRefresh(new Date('2026-10-24T22:00:00Z')), '2026-10-25T23:00:00.000Z');
});

test('daily offers survive service restart and change the next day', async () => {
    const rows = new Map();
    const db = {
        transaction: (callback) => callback(),
        get: async (sql, params) => {
            if (!sql.includes('date <')) return rows.get(params[0]);
            return [...rows.values()].at(-1);
        },
        run: async (sql, [date, cards]) => rows.set(date, { cards }),
    };
    const pool = Array.from({ length: 18 }, (_, id) => ({ id: String(id), name: `Track ${id}` }));
    const shop = createDailyShop(db, () => pool);
    const first = await shop(new Date('2026-10-05T12:00:00Z'));
    assert.equal(first.cards.length, 6);
    assert.equal(new Set(first.cards.map((card) => card.id)).size, 6);
    const restarted = createDailyShop(db, () => []);
    assert.deepEqual(await restarted(new Date('2026-10-05T18:00:00Z')), first);
    const tomorrow = await shop(new Date('2026-10-05T22:00:00Z'));
    assert.ok(tomorrow.cards.every((card) => !first.cards.some((previous) => previous.id === card.id)));
    assert.deepEqual(tomorrow.cards.map((card) => card.price), [150, 250, 350, 450, 550, 150]);
});
