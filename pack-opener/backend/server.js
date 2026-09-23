require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

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

// ==========================
// POOL DE CARTES
// ==========================

let cardPool = [];

// ==========================
// SPOTIFY
// ==========================

const getToken = async () => {
    const res = await fetch(
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

        const res = await fetch(
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
    const shuffled =
        [...pool].sort(
            () =>
                Math.random() - 0.5
        );

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
    return Promise.all(pack.map((card) => saveCardAndCollect(userId, card)));
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

        for (
            const artistName
            of ARTIST_NAMES
        ) {

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

        cardPool = [
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

    if (!email || password.length < 6) {
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
            const savedPack = await savePackToCollection(req.userId, pack);

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

app.post(
    '/api/cards/purchase',
    requireUser,
    async (req, res) => {

        const cardId = String(req.body?.id || '');
        const track = cardPool.find((item) => String(item.id) === cardId);

        if (!track) {
            return res.status(404).json({
                success: false,
                error: 'Carte introuvable',
            });
        }

        const price = 150 + (cardPool.indexOf(track) % 5) * 100;
        const user = await db.get('SELECT points FROM users WHERE id = ?', [req.userId]);

        if (user.points < price) {
            return res.status(400).json({
                success: false,
                error: 'Pas assez de points pour cette carte',
            });
        }

        const card = (await db.transaction(async () => {
            await db.run('UPDATE users SET points = points - ? WHERE id = ?', [price, req.userId]);
            return savePackToCollection(req.userId, openPack([track], 1));
        }))[0];
        const updatedUser = await db.get('SELECT points FROM users WHERE id = ?', [req.userId]);

        return res.json({
            success: true,
            card,
            points: updatedUser.points,
        });
    }
);

// ==========================
// COLLECTION
// ==========================

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
            collection,
        });
    }
);

// ==========================
// DÉMARRAGE DU SERVEUR
// ==========================

const startServer =
    async () => {

        try {

            // Charger Spotify
            // avant de démarrer l'API
            await buildCardPool();

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