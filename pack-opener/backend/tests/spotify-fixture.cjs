// Offline catalog: no Spotify account or production database is used by tests.
const nativeFetch = global.fetch;
global.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === 'accounts.spotify.com') {
        if (process.env.TEST_SPOTIFY_OFFLINE) return new Response('{}', { status: 503 });
        return Response.json({ access_token: 'test-token' });
    }
    if (url.hostname === 'api.spotify.com') {
        const name = url.searchParams.get('q').slice(8, -1);
        return Response.json({ tracks: { items: [0, 1].map((index) => ({
            id: `${name}-${index}`, name: index ? 'Écho nocturne' : 'Nuit <underground>',
            artists: [{ name, id: name === 'Shooda' ? '09yFOPej2iAOrLFZgdv7cv' : name }],
            album: { images: [] }, external_urls: { spotify: 'https://open.spotify.com/' },
        })) } });
    }
    return nativeFetch(input, options);
};
