require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { createSpotifyClient, CACHE_TTL } = require('./spotify-client');
const spotify = createSpotifyClient(db);

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const createSession = async (userId) => {
    const token = crypto.randomBytes(32).toString('hex');
    await db.run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, userId]);
    return token;
};

const requireUser = async (req, res, next) => {
    const token = req.get('Authorization')?.replace('Bearer ', '');
    const session = token
        ? await db.get('SELECT user_id FROM sessions WHERE token = ?', [token])
        : null;

    if (!session) {
        return res.status(401).json({ success: false, error: 'Connexion requise' });
    }

    req.userId = session.user_id;
    req.sessionToken = token;
    next();
};

app.use(
    express.static(
        path.join(__dirname, '../frontend')
    )
);

app.get('/app', (req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            '../frontend/index.html'
        )
    );
});

// ==========================
// CONFIGURATION
// ==========================

const ARTIST_NAMES = [
    'Rêves',
    'coeurco',
    '888rks',
    'Sim01',
    'Videuu',
    'Wakes',
    'Shooda',
    'ezasha',
    'Lunias',
    'Ptite Soeur',
    ''

];

const ARTIST_SPOTIFY_IDS = {
    Shooda: '09yFOPej2iAOrLFZgdv7cv',
    Guizy: '6oEHU1tnDAAeZna1pU0Nnq',
};

const RARITY_WEIGHTS = [
    {
        tier: 'commun',
        weight: 20,
    },
    {
        tier: 'rare',
        weight: 15,
    },
    {
        tier: 'épique',
        weight: 8,
    },
    {
        tier: 'légendaire',
        weight: 50,
    },
    {
        tier: 'spécial',
        weight: 5,
    },
    {
        tier: 'exclu',
        weight: 2,
    },
];

const PACK_SIZE = 5;
const SALE_PRICES = { commun: 25, rare: 40, 'épique': 60, 'légendaire': 80, 'spécial': 100, exclu: 120 };

// ==========================
// POOL DE CARTES
// ==========================

let cardPool = [];
const getDailyShop = require('./daily-shop').createDailyShop(db, () => cardPool);

// ==========================
// SPOTIFY
// ==========================

const getToken = async () => {
    const res = await spotify.request(
        'https://accounts.spotify.com/api/token',
        {
            method: 'POST',

            headers: {
                'Content-Type':
                    'application/x-www-form-urlencoded',

                'Authorization':
                    'Basic ' +
                    Buffer.from(
                        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
                    ).toString('base64'),
            },

            body:
                'grant_type=client_credentials',
        }
    );

    if (!res.ok) {
        const errorText =
            await res.text();

        throw new Error(
            `Erreur Spotify token : ${res.status} ${res.statusText} - ${errorText}`
        );
    }

    const data =
        await res.json();

    return data.access_token;
};

// ==========================
// RECHERCHE DES MORCEAUX
// ==========================
//
// Spotify autorise actuellement
// maximum 10 résultats par requête /search.
//
// On utilise donc offset pour récupérer
// plusieurs pages.
//
// ==========================

const searchArtistTracks = async (
    token,
    artistName,
    artistSpotifyId
) => {

    const allTracks = [];

    const limit = 10;

    // Spotify permet de paginer
    // jusqu'à offset 1000 pour /search.
    const maxOffset = 1000;

    for (
        let offset = 0;
        offset < maxOffset;
        offset += limit
    ) {

        const query =
            `artist:"${artistName}"`;

        const url =
            'https://api.spotify.com/v1/search' +
            `?q=${encodeURIComponent(query)}` +
            `&type=track` +
            `&market=FR` +
            `&limit=${limit}` +
            `&offset=${offset}`;

        const res = await spotify.request(
            url,
            {
                headers: {
                    Authorization:
                        `Bearer ${token}`,
                },
            }
        );

        if (!res.ok) {

            const errorText =
                await res.text();

            throw new Error(
                `Erreur Spotify recherche ${artistName} : ${res.status} ${res.statusText} - ${errorText}`
            );
        }

        const data =
            await res.json();

        const tracks =
            data.tracks?.items || [];

        // Plus aucun résultat
        if (
            tracks.length === 0
        ) {
            break;
        }

        // On vérifie que le morceau
        // appartient réellement à l'artiste
        for (
            const track of tracks
        ) {

            const isArtist =
                track.artists?.some(
                    (artist) => artistSpotifyId
                        ? artist.id === artistSpotifyId
                        : artist.name
                            .toLowerCase()
                            === artistName.toLowerCase()
                );

            if (isArtist) {
                allTracks.push(track);
            }
        }

        console.log(
            `   → ${allTracks.length} morceau(x) récupéré(s) pour ${artistName}`
        );

        // Si Spotify renvoie moins
        // de 10 résultats, il n'y a
        // probablement plus de pages.
        if (
            tracks.length < limit
        ) {
            break;
        }
    }

    // ==========================
    // SUPPRESSION DES DOUBLONS
    // ==========================

    const uniqueTracks = [
        ...new Map(
            allTracks.map(
                (track) => [
                    track.id,
                    track,
                ]
            )
        ).values(),
    ];

    console.log(
        `   🎵 ${uniqueTracks.length} morceau(x) unique(s) trouvé(s) pour ${artistName}`
    );

    return uniqueTracks;
};

// ==========================
// RARETÉ
// ==========================

const pickRarity = () => {

    const total =
        RARITY_WEIGHTS.reduce(
            (sum, rarity) =>
                sum + rarity.weight,
            0
        );

    let roll =
        Math.random() * total;

    for (
        const rarity
        of RARITY_WEIGHTS
    ) {

        if (
            roll < rarity.weight
        ) {
            return rarity.tier;
        }

        roll -=
            rarity.weight;
    }

    return 'commun';
};

// ==========================
// OUVERTURE D'UN PACK
// ==========================

const openPack = (
    pool,
    size = PACK_SIZE
) => {

    if (
        pool.length === 0
    ) {
        return [];
    }

    // Mélange du pool
    const shuffled = [...pool];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const selected = crypto.randomInt(index + 1);
        [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
    }

    // Sélection des cartes
    const picked =
        shuffled.slice(
            0,
            Math.min(
                size,
                pool.length
            )
        );

    return picked.map(
        (track) => ({

            id: track.id,

            name: track.name,

            artist:
                track.artists?.[0]
                    ?.name ||
                'Artiste inconnu',

            cover:
                track.album
                    ?.images?.[0]
                    ?.url ||
                null,

            rarity:
                pickRarity(),

            spotifyUrl:
                track.external_urls
                    ?.spotify ||
                null,

            previewUrl:
                track.preview_url ||
                null,
        })
    );
};

// ==========================
// PERSISTANCE DES SONS
// ==========================

const saveCardAndCollect = async (userId, card) => {
    await db.run(
        `INSERT INTO sounds (spotify_id, name, artist, cover_url, spotify_url, preview_url)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(spotify_id) DO UPDATE SET
            name = excluded.name,
            artist = excluded.artist,
            cover_url = excluded.cover_url,
            spotify_url = excluded.spotify_url,
            preview_url = excluded.preview_url`,
        [card.id, card.name, card.artist, card.cover, card.spotifyUrl, card.previewUrl]
    );

    const sound = await db.get('SELECT * FROM sounds WHERE spotify_id = ?', [card.id]);
    await db.run(
        `INSERT INTO sound_variants (sound_id, rarity)
         VALUES (?, ?)
         ON CONFLICT(sound_id) DO NOTHING`,
        [sound.id, card.rarity]
    );

    const variant = await db.get('SELECT * FROM sound_variants WHERE sound_id = ?', [sound.id]);
    await db.run(
        `INSERT INTO collection_items (user_id, sound_id, variant_id, quantity)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(user_id, sound_id) DO UPDATE SET quantity = quantity + 1`,
        [userId, sound.id, variant.id]
    );

    return {
        ...card,
        rarity: variant.rarity,
    };
};

const savePackToCollection = async (userId, pack) => {
    const saved = [];
    for (const card of pack) saved.push(await saveCardAndCollect(userId, card));
    return saved;
};

// ==========================
// CONSTRUCTION DU POOL
// ==========================

const buildCardPool =
    async () => {

        console.log(
            '🎵 Chargement du pool Spotify...'
        );

        const token =
            await getToken();

        const allTracks = [];

        for (const artistName of ARTIST_NAMES.filter((name) => name.trim())) {

            console.log(
                `\n🔎 Recherche des morceaux de ${artistName}...`
            );

            const tracks =
                await searchArtistTracks(
                    token,
                    artistName,
                    ARTIST_SPOTIFY_IDS[artistName]
                );

            allTracks.push(
                ...tracks
            );

            console.log(
                `   → ${tracks.length} morceau(x) ajouté(s) au pool`
            );
        }

        // ==========================
        // SUPPRESSION DES DOUBLONS
        // ==========================

        const updatedPool = [
            ...new Map(
                allTracks.map(
                    (track) => [
                        track.id,
                        track,
                    ]
                )
            ).values(),
        ];
        if (!updatedPool.length) throw new Error('Catalogue Spotify vide ; catalogue local conservé');
        cardPool = updatedPool;
        await spotify.write('catalog', cardPool);

        console.log(
            `\n🎵 Pool total : ${cardPool.length} cartes`
        );
    };

// ==========================
// ROUTE PRINCIPALE
// ==========================

app.get(
    '/',
    (req, res) => {

        res.json({

            success: true,

            message:
                'API Pack opérationnelle',

            endpoints: [
                'GET /api/cards',
                'GET /api/pack',
                'POST /api/pack/open',
                'GET /api/collection',
            ],
        });
    }
);

app.post('/api/auth/register', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6) {
        return res.status(400).json({
            success: false,
            error: 'Indique un email et un mot de passe de 6 caractères minimum',
        });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const result = await db.run(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            [email, passwordHash]
        );
        const token = await createSession(result.id);
        return res.status(201).json({ success: true, token, email });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            return res.status(409).json({ success: false, error: 'Cet email existe déjà' });
        }
        console.error('Erreur inscription :', error);
        return res.status(500).json({ success: false, error: 'Inscription impossible' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect' });
    }

    return res.json({
        success: true,
        token: await createSession(user.id),
        email: user.email,
        points: user.points,
    });
});

app.get('/api/auth/me', requireUser, async (req, res) => {
    const user = await db.get('SELECT id, email, points FROM users WHERE id = ?', [req.userId]);
    res.json({ success: true, user });
});

app.post('/api/auth/logout', requireUser, (req, res) => {
    db.run('DELETE FROM sessions WHERE token = ?', [req.sessionToken])
        .then(() => res.json({ success: true }))
        .catch(() => res.status(500).json({ success: false, error: 'Déconnexion impossible' }));
});

app.get('/api/preferences', requireUser, async (req, res) => {
    const row = await db.get('SELECT * FROM user_preferences WHERE user_id = ?', [req.userId]);
    res.json({ success: true, favorites: JSON.parse(row?.favorites || '[]'), showcase: JSON.parse(row?.showcase || '[]'), theme: row?.theme || 'gold' });
});

app.put('/api/preferences', requireUser, async (req, res) => {
    const { favorites, showcase, theme } = req.body || {};
    if (![favorites, showcase].every((list) => Array.isArray(list) && list.length <= 10000 && list.every((id) => typeof id === 'string') && new Set(list).size === list.length)
        || showcase.length > 5 || !['gold', 'violet', 'mint'].includes(theme)) {
        return res.status(400).json({ success: false, error: 'Sélection invalide (5 cartes maximum dans la vitrine).' });
    }
    const owned = await db.all('SELECT s.spotify_id AS id FROM collection_items c JOIN sounds s ON s.id = c.sound_id WHERE c.user_id = ?', [req.userId]);
    const ids = new Set(owned.map((card) => card.id));
    if ([...favorites, ...showcase].some((id) => !ids.has(id))) return res.status(400).json({ success: false, error: 'Choisis des cartes de ta collection.' });
    await db.run(`INSERT INTO user_preferences (user_id, favorites, showcase, theme) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET favorites=excluded.favorites, showcase=excluded.showcase, theme=excluded.theme`,
        [req.userId, JSON.stringify(favorites), JSON.stringify(showcase), theme]);
    res.json({ success: true, favorites, showcase, theme });
});

app.get('/api/cards/:id/details', requireUser, async (req, res) => {
    const card = await db.get(`SELECT s.name, s.artist, s.cover_url AS cover, s.spotify_url AS spotifyUrl, s.preview_url AS previewUrl,
        v.rarity, c.quantity FROM collection_items c JOIN sounds s ON s.id=c.sound_id JOIN sound_variants v ON v.id=c.variant_id
        WHERE c.user_id=? AND s.spotify_id=?`, [req.userId, req.params.id]);
    if (!card) return res.status(404).json({ success: false, error: 'Carte introuvable dans ta collection.' });
    const track = cardPool.find((track) => track.id === req.params.id);
    res.json({ success: true, card: { ...card, id: req.params.id, album: track?.album?.name || null, releaseDate: track?.album?.release_date || null, durationMs: track?.duration_ms || null } });
});

// ==========================
// TOUTES LES CARTES
// ==========================

app.get(
    '/api/cards',
    (req, res) => {

        try {

            if (
                cardPool.length === 0
            ) {

                return res
                    .status(503)
                    .json({

                        success: false,

                        error:
                            'Le pool de cartes n’est pas encore chargé',
                    });
            }

            const cards =
                cardPool.map(
                    (track) => ({

                        id: track.id,

                        name: track.name,

                        artist:
                            track.artists
                                ?.[0]
                                ?.name ||
                            'Artiste inconnu',

                        cover:
                            track.album
                                ?.images
                                ?.[0]
                                ?.url ||
                            null,

                        spotifyUrl:
                            track
                                .external_urls
                                ?.spotify ||
                            null,

                        previewUrl:
                            track.preview_url ||
                            null,
                    })
                );

            res.json({

                success: true,

                count:
                    cards.length,

                cards,
            });

        } catch (error) {

            console.error(
                '❌ Erreur récupération cartes :',
                error
            );

            res.status(500).json({

                success: false,

                error:
                    'Impossible de récupérer les cartes',
            });
        }
    }
);

// ==========================
// GÉNÉRER UN PACK
// ==========================
//
// Cette route génère un pack.
// Elle NE l'ajoute PAS à la collection.
//

app.get(
    '/api/pack',
    (req, res) => {

        try {

            if (
                cardPool.length === 0
            ) {

                return res
                    .status(503)
                    .json({

                        success: false,

                        error:
                            'Le pool de cartes n’est pas encore chargé',
                    });
            }

            const pack =
                openPack(
                    cardPool,
                    PACK_SIZE
                );

            res.json({

                success: true,

                pack,
            });

        } catch (error) {

            console.error(
                '❌ Erreur génération pack :',
                error
            );

            res.status(500).json({

                success: false,

                error:
                    'Impossible de générer le pack',
            });
        }
    }
);

// ==========================
// OUVRIR RÉELLEMENT UN PACK
// ==========================
//
// Cette route génère le pack
// ET l'ajoute à la collection.
//

app.post(
    '/api/pack/open',
    requireUser,
    async (req, res) => {

        try {

            if (
                cardPool.length === 0
            ) {

                return res
                    .status(503)
                    .json({

                        success: false,

                        error:
                            'Le pool de cartes n’est pas encore chargé',
                    });
            }

            const pack =
                openPack(
                    cardPool,
                    PACK_SIZE
                );

            // Ajouter les cartes
            // à la collection
            const savedPack = await db.transaction(() => savePackToCollection(req.userId, pack));

            res.json({

                success: true,

                pack: savedPack,
            });

        } catch (error) {

            console.error(
                '❌ Erreur ouverture pack :',
                error
            );

            res.status(500).json({

                success: false,

                error:
                    'Impossible d’ouvrir le pack',
            });
        }
    }
);

// ==========================
// ACHETER UNE CARTE
// ==========================

app.get('/api/shop', async (req, res) => {
    const shop = await getDailyShop();
    res.set('Cache-Control', 'no-store');
    if (!shop.cards.length) return res.status(503).json({ success: false, error: 'La boutique est en cours de chargement.' });
    const token = req.get('Authorization')?.replace('Bearer ', '');
    const session = token ? await db.get('SELECT user_id FROM sessions WHERE token = ?', [token]) : null;
    const purchases = session ? await db.all('SELECT card_id FROM shop_purchases WHERE user_id = ? AND shop_date = ?', [session.user_id, shop.date]) : [];
    const purchasedIds = new Set(purchases.map((purchase) => purchase.card_id));
    res.json({ success: true, ...shop, cards: shop.cards.map((card) => ({ ...card, purchased: purchasedIds.has(card.id) })) });
});

app.post(
    '/api/cards/purchase',
    requireUser,
    async (req, res) => {

        const cardId = String(req.body?.id || '');
        const shop = await getDailyShop();
        const card = shop.cards.find((item) => String(item.id) === cardId);

        if (!card || (req.body?.shopDate && req.body.shopDate !== shop.date)) {
            return res.status(404).json({
                success: false,
                error: 'Cette offre a expiré. Actualise la boutique.',
            });
        }

        const price = card.price;
        const purchased = await db.transaction(async () => {
            const existing = await db.get('SELECT 1 FROM shop_purchases WHERE user_id = ? AND shop_date = ? AND card_id = ?', [req.userId, shop.date, cardId]);
            if (existing) return { alreadyPurchased: true };
            const debit = await db.run(
                'UPDATE users SET points = points - ? WHERE id = ? AND points >= ?',
                [price, req.userId, price]
            );
            if (!debit.changes) return null;
            await db.run('INSERT INTO shop_purchases (user_id, shop_date, card_id) VALUES (?, ?, ?)', [req.userId, shop.date, cardId]);
            const cards = await savePackToCollection(req.userId, [{ ...card, rarity: pickRarity() }]);
            const user = await db.get('SELECT points FROM users WHERE id = ?', [req.userId]);
            return { card: cards[0], points: user.points };
        });

        if (purchased?.alreadyPurchased) {
            return res.status(409).json({ success: false, error: 'Tu as déjà acheté cette carte dans la boutique du jour.' });
        }
        if (!purchased) {
            return res.status(400).json({
                success: false,
                error: 'Pas assez de points pour cette carte',
            });
        }

        return res.json({
            success: true,
            ...purchased,
        });
    }
);

// ==========================
// COLLECTION
// ==========================

app.post('/api/cards/sell', requireUser, async (req, res) => {
    const id = req.body?.id;
    if (typeof id !== 'string' || !id) return res.status(400).json({ success: false, error: 'Carte invalide.' });
    const sale = await db.transaction(async () => {
        const card = await db.get(`SELECT c.sound_id, c.quantity, s.name, v.rarity FROM collection_items c
            JOIN sounds s ON s.id=c.sound_id JOIN sound_variants v ON v.id=c.variant_id
            WHERE c.user_id=? AND s.spotify_id=?`, [req.userId, id]);
        if (!card || card.quantity < 1) return null;
        const earned = SALE_PRICES[card.rarity];
        if (!earned) throw new Error('Prix de vente inconnu');
        if (card.quantity > 1) {
            await db.run('UPDATE collection_items SET quantity=quantity-1 WHERE user_id=? AND sound_id=?', [req.userId, card.sound_id]);
        } else {
            await db.run('DELETE FROM collection_items WHERE user_id=? AND sound_id=?', [req.userId, card.sound_id]);
            const prefs = await db.get('SELECT favorites, showcase FROM user_preferences WHERE user_id=?', [req.userId]);
            if (prefs) await db.run('UPDATE user_preferences SET favorites=?, showcase=? WHERE user_id=?', [
                JSON.stringify(JSON.parse(prefs.favorites).filter((item) => item !== id)),
                JSON.stringify(JSON.parse(prefs.showcase).filter((item) => item !== id)), req.userId,
            ]);
        }
        await db.run('UPDATE users SET points=points+? WHERE id=?', [earned, req.userId]);
        const user = await db.get('SELECT points FROM users WHERE id=?', [req.userId]);
        return { id, name: card.name, earned, quantity: card.quantity - 1, points: user.points };
    });
    if (!sale) return res.status(404).json({ success: false, error: 'Tu ne possèdes plus cette carte.' });
    res.json({ success: true, ...sale });
});

app.get(
    '/api/collection',
    requireUser,
    async (req, res) => {
        const collection = await db.all(
            `SELECT sounds.spotify_id AS id, sounds.name, sounds.artist,
                    sounds.cover_url AS cover, variants.rarity,
                    sounds.spotify_url AS spotifyUrl, sounds.preview_url AS previewUrl,
                    collection_items.quantity
             FROM collection_items
             JOIN sounds ON sounds.id = collection_items.sound_id
             JOIN sound_variants AS variants ON variants.id = collection_items.variant_id
             WHERE collection_items.user_id = ?
             ORDER BY variants.rarity DESC, sounds.name ASC`,
            [req.userId]
        );

        res.json({
            success: true,
            count: collection.length,
            collection: collection.map((card) => ({ ...card, salePrice: SALE_PRICES[card.rarity] || 0 })),
        });
    }
);

// ==========================
// DÉMARRAGE DU SERVEUR
// ==========================

app.use((error, req, res, next) => {
    console.error('Erreur API :', error.message);
    res.status(error.status === 400 ? 400 : 500).json({
        success: false,
        error: error.status === 400 ? 'Requête invalide' : 'Une erreur est survenue. Réessaie dans un instant.',
    });
});

const startServer =
    async () => {

        try {

            // L'interface et les collections restent accessibles pendant le chargement Spotify.
            await db.get('SELECT 1');
            const cachedCatalog = await spotify.read('catalog');
            if (Array.isArray(cachedCatalog?.value) && cachedCatalog.value.length) {
                cardPool = cachedCatalog.value.filter((track) => track.artists?.some((artist) => ARTIST_NAMES.includes(artist.name)));
            } else {
                // Keep existing music playable when Spotify is temporarily unavailable.
                const saved = await db.all('SELECT * FROM sounds');
                cardPool = saved.filter((sound) => ARTIST_NAMES.includes(sound.artist)).map((sound) => ({
                    id: sound.spotify_id, name: sound.name, artists: [{ name: sound.artist }],
                    album: { images: sound.cover_url ? [{ url: sound.cover_url }] : [] },
                    external_urls: { spotify: sound.spotify_url }, preview_url: sound.preview_url,
                }));
            }
            if (cardPool.length) console.log(`Catalogue local disponible : ${cardPool.length} titres`);

            app.listen(
                PORT,
                () => {

                    console.log(
                        `\n🚀 API lancée sur http://localhost:${PORT}`
                    );

                    console.log(
                        `🎴 Cartes : http://localhost:${PORT}/api/cards`
                    );

                    console.log(
                        `🎁 Pack : http://localhost:${PORT}/api/pack`
                    );

                    console.log(
                        `📦 Ouvrir pack : POST http://localhost:${PORT}/api/pack/open`
                    );

                    console.log(
                        `📚 Collection : http://localhost:${PORT}/api/collection`
                    );

                    console.log(
                        `🌐 Interface : http://localhost:${PORT}/app`
                    );
                }
            );

            let failures = 0;
            const scheduleCatalog = (delay) => setTimeout(loadCatalog, Math.min(delay, 2_147_483_647)).unref();
            const loadCatalog = async () => {
                try {
                    await buildCardPool();
                    if (!cardPool.length) throw new Error('Catalogue Spotify vide');
                    failures = 0;
                    scheduleCatalog(CACHE_TTL);
                } catch (error) {
                    failures += 1;
                    const delay = error.retryAt ? Math.max(1000, error.retryAt - Date.now()) : Math.min(3600000, 60000 * 2 ** Math.min(failures - 1, 6));
                    console.error(`Actualisation Spotify suspendue. Nouvel essai dans ${Math.ceil(delay / 60000)} minute(s). ${cardPool.length} titres locaux disponibles.`, error.message);
                    scheduleCatalog(delay);
                }
            };
            if (cachedCatalog?.value?.length && Date.now() - cachedCatalog.updatedAt < CACHE_TTL) {
                scheduleCatalog(CACHE_TTL - (Date.now() - cachedCatalog.updatedAt));
            } else void loadCatalog();

        } catch (error) {

            console.error(
                '\n❌ Impossible de démarrer le serveur :'
            );

            console.error(
                error
            );

            process.exit(1);
        }
    };

startServer();
