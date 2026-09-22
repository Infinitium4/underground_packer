require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
    'ezasha',
    'Lunias',
    'coeurco',

];

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
// COLLECTION
// ==========================

// Collection temporaire en mémoire
let collection = [];

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
    artistName
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
                    (artist) =>
                        artist.name
                            .toLowerCase()
                            ===
                        artistName
                            .toLowerCase()
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
// AJOUT À LA COLLECTION
// ==========================

const addToCollection = (
    pack
) => {

    for (
        const card of pack
    ) {

        // Chaque exemplaire reste une carte indépendante.
        collection.push({

            id: card.id,

            name: card.name,

            artist: card.artist,

            cover: card.cover,

            rarity: card.rarity,

            spotifyUrl:
                card.spotifyUrl,

            previewUrl:
                card.previewUrl,

            quantity: 1,
        });
    }
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
                    artistName
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

            // Ajouter les cartes
            // à la collection
            addToCollection(
                pack
            );

            res.json({

                success: true,

                pack,
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
    (req, res) => {

        const cardId = String(req.body?.id || '');
        const track = cardPool.find((item) => String(item.id) === cardId);

        if (!track) {
            return res.status(404).json({
                success: false,
                error: 'Carte introuvable',
            });
        }

        const card = openPack([track], 1)[0];
        addToCollection([card]);

        return res.json({
            success: true,
            card,
        });
    }
);

// ==========================
// COLLECTION
// ==========================

app.get(
    '/api/collection',
    (req, res) => {

        res.json({

            success: true,

            count:
                collection.length,

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