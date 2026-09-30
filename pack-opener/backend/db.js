const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const database = new sqlite3.Database(process.env.DATABASE_PATH || path.join(__dirname, 'pack-opener.sqlite'));

const schema = [
    'PRAGMA foreign_keys = ON',
    `CREATE TABLE IF NOT EXISTS spotify_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        favorites TEXT NOT NULL DEFAULT '[]', showcase TEXT NOT NULL DEFAULT '[]', theme TEXT NOT NULL DEFAULT 'gold'
    )`,
    `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 1200,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
`,
    `
    CREATE TABLE IF NOT EXISTS sounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spotify_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        artist TEXT NOT NULL,
        cover_url TEXT,
        spotify_url TEXT,
        preview_url TEXT
    )
`,
    `
    CREATE TABLE IF NOT EXISTS sound_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sound_id INTEGER NOT NULL UNIQUE,
        rarity TEXT NOT NULL,
        FOREIGN KEY (sound_id) REFERENCES sounds(id) ON DELETE CASCADE
    )
`,
    `
    CREATE TABLE IF NOT EXISTS collection_items (
        user_id INTEGER NOT NULL,
        sound_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (user_id, sound_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (sound_id) REFERENCES sounds(id) ON DELETE CASCADE,
        FOREIGN KEY (variant_id) REFERENCES sound_variants(id) ON DELETE CASCADE
    )
`,
    `
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
`,
];

const ready = new Promise((resolve, reject) => {
    database.serialize(() => {
        let remaining = schema.length;
        schema.forEach((statement) => {
            database.run(statement, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                remaining -= 1;
                if (remaining === 0) resolve();
            });
        });
    });
});

const run = async (sql, params = []) => {
    await ready;
    return new Promise((resolve, reject) => database.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve({ id: this.lastID, changes: this.changes });
    }));
};

const get = async (sql, params = []) => {
    await ready;
    return new Promise((resolve, reject) => database.get(sql, params, (error, row) => {
        if (error) reject(error);
        else resolve(row);
    }));
};

const all = async (sql, params = []) => {
    await ready;
    return new Promise((resolve, reject) => database.all(sql, params, (error, rows) => {
        if (error) reject(error);
        else resolve(rows);
    }));
};

let transactionQueue = Promise.resolve();
const transaction = (callback) => {
    const operation = transactionQueue.then(() => executeTransaction(callback));
    transactionQueue = operation.catch(() => {});
    return operation;
};

const executeTransaction = async (callback) => {
    await ready;
    await run('BEGIN TRANSACTION');
    try {
        const result = await callback();
        await run('COMMIT');
        return result;
    } catch (error) {
        await run('ROLLBACK');
        throw error;
    }
};

module.exports = { run, get, all, transaction };
