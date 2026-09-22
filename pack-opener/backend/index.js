require('dotenv').config();

const ARTIST_NAMES = [
  'Guizy',
  'coeurco',
];

const RARITY_WEIGHTS = [
  { tier: 'commun', weight: 20 },
  { tier: 'rare', weight: 15 },
  { tier: 'épique', weight: 8 },
  { tier: 'légendaire', weight: 50 },
  { tier: 'spécial', weight: 5 },
  { tier: 'exclu', weight: 2 },
];

const getToken = async () => {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return data.access_token;
};

const searchArtistTracks = async (token, artistName) => {
  const res = await fetch(
    `https://api.spotify.com/v1/search?q=artist:"${encodeURIComponent(artistName)}"&type=track&limit=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.tracks?.items || [];
};

const pickRarity = () => {
  const total = RARITY_WEIGHTS.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;

  for (const r of RARITY_WEIGHTS) {
    if (roll < r.weight) return r.tier;
    roll -= r.weight;
  }
};

const openPack = (pool, size = 5) => {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, size);

  return picked.map(track => ({
    name: track.name,
    cover: track.album.images[0]?.url,
    rarity: pickRarity(),
  }));
};

const buildCardPool = async () => {
  const token = await getToken();
  const allTracks = [];

  for (const name of ARTIST_NAMES) {
    const tracks = await searchArtistTracks(token, name);
    allTracks.push(...tracks);
  }

  console.log(`Pool total: ${allTracks.length} tracks`);

  const pack = openPack(allTracks);
  console.log('\n🎁 Pack ouvert:');
  pack.forEach(card => {
    console.log(`- ${card.name} [${card.rarity}]`);
  });
};

buildCardPool();