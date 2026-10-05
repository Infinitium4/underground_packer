const API_URL = window.location.origin;


// =========================
// ELEMENTS
// =========================

const openPackButton =
    document.getElementById('open-pack-btn');

const packContainer =
    document.getElementById('pack-container');

const statusText =
    document.getElementById('status');

const collectionContainer =
    document.getElementById('collection-container');

const refreshCollectionButton =
    document.getElementById('refresh-collection');

const pointsValue =
    document.getElementById('points-value');

const boosterShop =
    document.getElementById('booster-shop');

const pageTitle = document.getElementById('page-title');
const pageTagline = document.getElementById('page-tagline');
const navigationButtons = document.querySelectorAll('.nav-button');
const viewPanels = document.querySelectorAll('[data-view-panel]');
const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const registerButton = document.getElementById('register-button');
const authStatus = document.getElementById('auth-status');
const logoutButton = document.getElementById('logout-button');
const accountPanel = document.getElementById('account-panel');
const profileMenu = document.getElementById('profile-menu');
const profileEmail = document.getElementById('profile-email');
const profileLogout = document.getElementById('profile-logout');


// =========================
// HELPERS
// =========================

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const safeUrl = (value) => {
    try { const url = new URL(value); return url.protocol === 'https:' ? escapeHtml(url.href) : ''; }
    catch { return ''; }
};
const coverUrl = (value) => safeUrl(value) || 'asha-logo.png';
let toastTimer;
const notify = (message) => {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
};
let collectionCards = [];
let artistCatalog = null;
const renderArtistAlbum = () => {
    const container = document.getElementById('artist-progress');
    if (!artistCatalog) {
        container.textContent = 'Le catalogue des artistes est en cours de chargement…';
        return;
    }
    const owned = new Set(collectionCards.map((card) => card.id));
    const artists = new Map();
    for (const card of artistCatalog) {
        if (!artists.has(card.artist)) artists.set(card.artist, new Map());
        artists.get(card.artist).set(card.id, card);
    }
    container.innerHTML = [...artists].sort(([a], [b]) => a.localeCompare(b, 'fr')).map(([artist, tracks]) => {
        const collected = [...tracks.keys()].filter((id) => owned.has(id)).length;
        const total = tracks.size;
        const percentage = Math.floor(collected / total * 100);
        const complete = collected === total;
        return `<article class="artist-progress-card${complete ? ' complete' : ''}">
            <div><h3>${escapeHtml(artist)}</h3><span>${complete ? 'COMPLET ✓' : `${percentage} %`}</span></div>
            <progress value="${collected}" max="${total}" aria-label="${escapeHtml(artist)} : ${collected} titres sur ${total}"></progress>
            <p>${collected} / ${total} titres collectés · ${complete ? 'Album complété' : `${total - collected} à découvrir`}</p>
        </article>`;
    }).join('') || '<p>Aucun artiste disponible pour le moment.</p>';
};
let finishReveal = null;
let sessionVersion = 0;
const revealAllButton = document.getElementById('reveal-all');
const packSummary = document.getElementById('pack-summary');

const rarityClass = (rarity) => rarity
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-');

const rarityOrder = {
    commun: 1,
    rare: 2,
    epique: 3,
    legendaire: 4,
    special: 5,
    exclu: 6,
};

let points = 0;
let authToken = localStorage.getItem('asha-auth-token');
let shopCards = [];
let shopDate;
let shopRefreshAt = 0;
let shopRefreshTimer;
let previewAudio;

const views = {
    packs: {
        title: 'OUVRIR DES PACKS',
        tagline: 'Révèle les cartes de ton prochain drop.',
    },
    shop: {
        title: 'BOUTIQUE',
        tagline: 'Choisis les cartes à ajouter à ton casier.',
    },
    collection: {
        title: 'COLLECTION',
        tagline: 'Retrouve toutes les cartes de ton casier.',
    },
};

const showView = (viewName) => {
    const view = views[viewName] || views.packs;

    pageTitle.textContent = view.title;
    pageTagline.textContent = view.tagline;

    navigationButtons.forEach((button) => {
        const isActive = button.dataset.view === viewName;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    viewPanels.forEach((panel) => {
        const isActive = panel.dataset.viewPanel === viewName;
        panel.hidden = !isActive;
        panel.classList.toggle('active', isActive);
    });

    if (viewName === 'shop') {
        loadCardShop();
    }

    if (viewName === 'collection') {
        loadCollection();
    }
};

const buildPlaceholder = () => `
    <div class="pack-placeholder">
        <span class="pack-clip"></span>
        <p class="pack-label">ASHΛ <span>VOL. 01</span></p>
        <span class="pack-side" aria-hidden="true">SOUND IS COLLECTIBLE // EST. UNDERGROUND</span>
        <img class="pack-logo" src="asha-logo.png" alt="ASHΛ">
        <span class="pack-edition">UNDER<br>GROUND<span>MUSIC COLLECTOR PACK</span></span>
        <div class="pack-footer"><span class="pack-barcode" aria-hidden="true"></span><span class="pack-hint">DÉCHIRE.<br>DÉCOUVRE.</span></div>
    </div>
`;

const formatPoints = (value) => value.toLocaleString('fr-FR');

const updatePoints = () => {
    pointsValue.textContent = formatPoints(points);
};

const apiFetch = (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (authToken) {
        headers.set('Authorization', `Bearer ${authToken}`);
    }
    return fetch(url, { signal: AbortSignal.timeout(20_000), ...options, headers });
};

const setAuthenticated = (user) => {
    sessionVersion += 1;
    document.body.classList.add('authenticated');
    points = user.points ?? points;
    updatePoints();
    accountPanel.hidden = true;
    profileMenu.hidden = false;
    profileEmail.textContent = user.email;
    authForm.hidden = true;
    logoutButton.hidden = false;
    authStatus.textContent = `Connecté : ${user.email}`;
    authPassword.value = '';
    loadCollection();
    document.dispatchEvent(new Event('account-ready'));
};

const setLoggedOut = (message = 'Connecte-toi pour sauvegarder ta collection.') => {
    sessionVersion += 1;
    finishReveal?.();
    document.dispatchEvent(new Event('account-cleared'));
    previewAudio?.pause();
    collectionCards = [];
    artistCatalog = null;
    shopCards = [];
    clearTimeout(shopRefreshTimer);
    shopRefreshAt = 0;
    packSummary.hidden = true;
    packSummary.innerHTML = '';
    packContainer.innerHTML = buildPlaceholder();
    displayCollection([]);
    showView('packs');
    document.body.classList.remove('authenticated');
    accountPanel.hidden = false;
    profileMenu.hidden = true;
    authForm.hidden = false;
    logoutButton.hidden = true;
    authStatus.textContent = message;
    points = 0;
    updatePoints();
};

const authenticate = async (endpoint) => {
    if (authForm.dataset.busy) return;
    authForm.dataset.busy = 'true';
    authForm.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
    const response = await apiFetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail.value, password: authPassword.value }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Connexion impossible');
    authToken = data.token;
    localStorage.setItem('asha-auth-token', authToken);
    setAuthenticated({ email: data.email, points: data.points ?? 1200 });
    } finally {
        delete authForm.dataset.busy;
        authForm.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
};

const restoreSession = async () => {
    if (!authToken) return setLoggedOut();
    try {
        const response = await apiFetch(`${API_URL}/api/auth/me`);
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error();
        setAuthenticated(data.user);
    } catch {
        authToken = null;
        localStorage.removeItem('asha-auth-token');
        setLoggedOut();
    }
};

const playLegendaryPreview = (card) => {
    if (!card?.previewUrl) {
        statusText.textContent = 'Légendaire obtenue. Écouter le morceau : ';

        if (card?.spotifyUrl) {
            const spotifyLink = document.createElement('a');
            spotifyLink.href = card.spotifyUrl;
            spotifyLink.target = '_blank';
            spotifyLink.rel = 'noreferrer';
            spotifyLink.textContent = 'ouvrir Spotify';
            statusText.appendChild(spotifyLink);
        } else {
            statusText.append('aucun lien Spotify disponible.');
        }

        return;
    }

    previewAudio?.pause();
    previewAudio = new Audio(card.previewUrl);
    previewAudio.volume = 0.7;
    previewAudio.play().catch(() => {
        statusText.textContent = 'L’extrait est prêt, clique à nouveau pour l’écouter.';
    });
};

const renderCardShop = () => {
    boosterShop.innerHTML = shopCards.map((card, index) => {
        const price = card.price;

        return `
        <article class="booster-card card-shop-item" style="--delay: ${index * 55}ms">
            <div class="booster-art">
                <img src="${coverUrl(card.cover)}" alt="${escapeHtml(card.name)}" loading="lazy">
                <span class="booster-stamp">CARTE 0${index + 1}</span>
                <span class="booster-count">${escapeHtml(card.artist)}</span>
            </div>
            <div class="booster-copy">
                <div>
                    <h3>${escapeHtml(card.name)}</h3>
                    <p>${escapeHtml(card.artist)} // carte artiste</p>
                </div>
                <button class="buy-booster" type="button" data-card-id="${escapeHtml(card.id)}" data-card-price="${price}" ${card.purchased ? 'disabled' : ''}>
                    <span>${card.purchased ? 'DÉJÀ ACHETÉE' : 'ACHETER'}</span>
                    <strong>◆ ${formatPoints(price)}</strong>
                </button>
            </div>
        </article>
    `;
    }).join('');
};

const loadCardShop = async () => {
    const currentSession = sessionVersion;
    try {
        const response = await apiFetch(`${API_URL}/api/shop`);
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Impossible de charger les cartes');
        }

        if (currentSession !== sessionVersion) return;
        shopCards = data.cards;
        shopDate = data.date;
        shopRefreshAt = Date.parse(data.refreshAt);
        clearTimeout(shopRefreshTimer);
        shopRefreshTimer = setTimeout(loadCardShop, Math.max(1000, shopRefreshAt - Date.now()));
        document.querySelector('.shop-timer').textContent = 'RENOUVELLEMENT À MINUIT // HEURE DE PARIS';
        renderCardShop();
    } catch (error) {
        boosterShop.innerHTML = '<p class="empty">La boutique est indisponible pour le moment.</p>';
        console.error('Erreur boutique :', error);
        if (currentSession === sessionVersion) {
            clearTimeout(shopRefreshTimer);
            shopRefreshTimer = setTimeout(loadCardShop, 60_000);
        }
    }
};

const buyCard = async (cardId, price, button) => {
    if (button.disabled) return;
    const currentSession = sessionVersion;
    if (points < price) {
        notify('Pas assez de points pour cette carte.');
        return;
    }

    button.disabled = true;

    try {
        const response = await apiFetch(`${API_URL}/api/cards/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: cardId, shopDate }),
        });
        const data = await response.json();
        if (currentSession !== sessionVersion) return;

        if (!response.ok || !data.success) {
            if (response.status === 404 || response.status === 409) loadCardShop();
            throw new Error(data.error || 'Achat impossible');
        }

        points = data.points;
        const offer = shopCards.find((card) => card.id === cardId);
        if (offer) offer.purchased = true;
        renderCardShop();
        updatePoints();
        notify(`${data.card.name} ajouté à ta collection.`);
        loadCollection();
    } catch (error) {
        notify(error.message);
    } finally {
        button.disabled = shopCards.some((card) => card.id === cardId && card.purchased);
    }
};

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && shopCards.length && Date.now() >= shopRefreshAt) loadCardShop();
});


// =========================
// OUVRIR UN PACK
// =========================

const tearOpenWrapper = async () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const original = packContainer.querySelector('.pack-placeholder');
    if (!original) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'pack-tear';
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.innerHTML = '<div class="tear-card-stack"><span></span><span></span><span></span></div><div class="tear-light"></div>';
    for (const part of ['left', 'right', 'seal']) {
        const fragment = original.cloneNode(true);
        fragment.className = `pack-placeholder tear-fragment tear-${part}`;
        wrapper.appendChild(fragment);
    }
    const seam = document.createElement('div');
    seam.className = 'tear-seam';
    wrapper.appendChild(seam);
    packContainer.replaceChildren(wrapper);
    statusText.textContent = 'Le sachet se déchire…';
    // A timed fallback also completes the transition in background tabs.
    await wait(500);
};

const openPack = async (booster = null) => {
    if (openPackButton.disabled) return;
    const currentSession = sessionVersion;
    packSummary.hidden = true;

    if (booster && points < booster.price) {
        statusText.textContent = 'Pas assez de points pour ce booster.';
        return;
    }

    openPackButton.disabled = true;
    document.querySelectorAll('.buy-booster').forEach((button) => {
        button.disabled = true;
    });
    statusText.textContent = 'Ouverture du pack...';

    try {
        const [response] = await Promise.all([
            apiFetch(`${API_URL}/api/pack/open`, { method: 'POST' }),
            tearOpenWrapper(),
        ]);


        const data = await response.json();
        if (currentSession !== sessionVersion) return;


        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Erreur inconnue');
        }

        if (booster) {
            points -= booster.price;
            updatePoints();
        }


        statusText.textContent = 'Clique sur la carte du dessus.';

        // La collection est déjà mise à jour par l'API à l'ouverture du pack.
        loadCollection();

        await displayPack(data.pack);

        if (currentSession !== sessionVersion) return;
        statusText.textContent = `${data.pack.length} cartes ajoutées à ta collection. Prêt pour le prochain drop ?`;

        // Actualiser la collection
        loadCollection();


    } catch (error) {
        if (currentSession !== sessionVersion) return;

        console.error(error);

        statusText.textContent = error.message || 'Impossible d’ouvrir le pack.';

        packContainer.innerHTML = buildPlaceholder();

    } finally {
        openPackButton.disabled = false;
        document.querySelectorAll('.buy-booster').forEach((button) => {
            button.disabled = false;
        });
    }

};


// =========================
// AFFICHER LE PACK (pile de cartes, une carte à la fois)
// =========================

const displayPack = (pack) => {

    return new Promise((resolve) => {
        if (!pack.length) { resolve(); return; }

        packContainer.innerHTML = '';
        let effectTimer;
        let unlockTimer;
        let revealLocked = false;
        let cinematic = null;
        let cinematicCard = null;
        const closeCinematic = () => {
            if (!cinematic) return;
            cinematic.close();
            cinematic.remove();
            cinematic = null;
            revealLocked = false;
            if (cinematicCard?.isConnected) cinematicCard.focus({ preventScroll: true });
            cinematicCard = null;
        };
        const clearRevealEffect = () => {
            clearTimeout(effectTimer);
            clearTimeout(unlockTimer);
            revealLocked = false;
            closeCinematic();
            packContainer.querySelector('.rarity-effect')?.remove();
        };
        const animateRarity = (card, element) => {
            clearRevealEffect();
            const rarity = rarityClass(card.rarity);
            const durations = { commun: 650, rare: 900, epique: 1150, legendaire: 3600, special: 3600, exclu: 1650 };
            const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const duration = reducedMotion ? 0 : (durations[rarity] || 650);
            element.style.setProperty('--reveal-duration', `${Math.min(duration, 250)}ms`);
            const effect = document.createElement('div');
            effect.className = `rarity-effect ${rarity}`;
            effect.setAttribute('aria-hidden', 'true');
            effect.innerHTML = `<span class="reveal-aura"></span><span class="reveal-ring"></span>
                <span class="reveal-beam"></span><span class="reveal-particles">${Array.from({ length: 12 }, (_, index) =>
                    `<i style="--particle-angle:${index * 30}deg;--particle-delay:${index % 3 * 45}ms"></i>`).join('')}</span>
                <span class="reveal-caption">${escapeHtml(card.rarity)}</span>`;
            packContainer.appendChild(effect);
            revealLocked = !reducedMotion;
            if (!reducedMotion && ['legendaire', 'special'].includes(rarity)) {
                cinematicCard = element;
                cinematic = document.createElement('dialog');
                cinematic.className = `card-cinematic ${rarity}`;
                cinematic.setAttribute('aria-label', `Carte ${card.rarity} : ${card.name}, ${card.artist}`);
                cinematic.innerHTML = `<div class="cinema-stage" aria-hidden="true">
                    <div class="cinema-nebula"></div><div class="cinema-rays"></div>
                    <div class="cinema-orbit orbit-one"></div><div class="cinema-orbit orbit-two"></div>
                    <div class="cinema-shockwave"></div>
                    <div class="cinema-sparks">${Array.from({ length: 36 }, (_, index) => `<i style="--angle:${index * 137.5}deg;--distance:${160 + index % 7 * 29}px;--delay:${index % 6 * 55}ms"></i>`).join('')}</div>
                    <div class="cinema-heading"><span>ASHΛ // UNDERGROUND DROP</span><strong>${rarity === 'legendaire' ? 'LÉGENDAIRE' : 'SPÉCIAL'}</strong></div>
                    <article class="cinema-card"><img src="${coverUrl(card.cover)}" alt=""><div class="cinema-foil"></div>
                        <div class="cinema-card-info"><span>${escapeHtml(card.rarity)}</span><h2>${escapeHtml(card.name)}</h2><p>${escapeHtml(card.artist)}</p></div></article>
                </div><button class="cinema-skip" type="button">Passer l’animation <span>Échap</span></button>`;
                cinematic.querySelector('.cinema-skip').addEventListener('click', clearRevealEffect);
                cinematic.addEventListener('cancel', (event) => { event.preventDefault(); clearRevealEffect(); });
                document.body.appendChild(cinematic);
                cinematic.showModal();
            }
            unlockTimer = setTimeout(() => { revealLocked = false; closeCinematic(); }, duration);
            effectTimer = setTimeout(() => effect.remove(), reducedMotion ? 1200 : duration + 850);
        };

        const sortedPack = [...pack].sort((firstCard, secondCard) => {
            const firstRarity = rarityClass(firstCard.rarity);
            const secondRarity = rarityClass(secondCard.rarity);

            return rarityOrder[secondRarity] - rarityOrder[firstRarity];
        });

        const cardElements = sortedPack.map((card, index) => {

            const cardElement = document.createElement('div');
            cardElement.className = `card ${rarityClass(card.rarity)} pack-card`;

            // La dernière carte créée est au-dessus de la pile.
            cardElement.style.zIndex = `${index + 1}`;
            cardElement.previewUrl = card.previewUrl;
            cardElement.spotifyUrl = card.spotifyUrl;

            cardElement.innerHTML = `
                <div class="card-flip">
                    <div class="card-flip-inner">

                        <div class="card-face card-back"></div>

                        <div class="card-face card-front">
                            <img src="${coverUrl(card.cover)}" alt="${escapeHtml(card.name)}">

                            <div class="card-info">
                                <div class="card-name">${escapeHtml(card.name)}</div>
                                <div class="card-artist">${escapeHtml(card.artist)}</div>
                                <span class="rarity">${escapeHtml(card.rarity)}</span>

                                ${
                                    safeUrl(card.spotifyUrl)
                                    ? `<a class="spotify-link" href="${safeUrl(card.spotifyUrl)}" target="_blank" rel="noopener noreferrer" tabindex="-1">Écouter sur Spotify →</a>`
                                    : ''
                                }
                            </div>
                        </div>

                    </div>
                </div>
            `;

            packContainer.appendChild(cardElement);

            return cardElement;

        });

        cardElements.forEach((cardElement) => {
            cardElement.classList.add('in');
        });

        const handleTopCardClick = (event) => {
            if (event.target.closest('a')) return;
            const cardElement = event.target.closest('.pack-card');

            if (
                !cardElement ||
                cardElement !== cardElements[cardElements.length - 1] ||
                cardElement.classList.contains('flying-away')
            ) {
                return;
            }

            if (!cardElement.classList.contains('revealed')) {
                animateRarity(sortedPack[cardElements.length - 1], cardElement);
                cardElement.classList.add('revealed');
                cardElement.setAttribute('aria-label', `${sortedPack[cardElements.length - 1].name}. Carte suivante`);
                const link = cardElement.querySelector('a');
                if (link) link.tabIndex = 0;
                statusText.textContent = `Carte ${pack.length - cardElements.length + 1} sur ${pack.length} · Clique à nouveau pour continuer.`;

                if (rarityClass(sortedPack[cardElements.length - 1].rarity) === 'legendaire') {
                    playLegendaryPreview({
                        previewUrl: cardElement.previewUrl,
                        spotifyUrl: cardElement.spotifyUrl,
                    });
                }

                return;
            }

            clearRevealEffect();
            cardElement.classList.add('flying-away');
            let cardRemoved = false;

            const finishCardRemoval = () => {
                if (cardRemoved || completed) {
                    return;
                }

                cardRemoved = true;
                cardElement.remove();
                cardElements.pop();

                if (cardElements.length === 0) {
                    complete();
                } else activateTopCard();
            };

            cardElement.addEventListener('animationend', (animationEvent) => {
                if (animationEvent.target === cardElement && animationEvent.animationName === 'card-fly-away') finishCardRemoval();
            });
            setTimeout(finishCardRemoval, 250);

            // Fallback for reduced-motion modes where the animation may be skipped.
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                finishCardRemoval();
            }
        };

        const activateTopCard = () => {
            cardElements.forEach((element, index) => {
                const active = index === cardElements.length - 1;
                element.tabIndex = active ? 0 : -1;
                element.inert = !active;
                element.setAttribute('role', 'button');
                element.setAttribute('aria-label', 'Révéler la carte');
            });
            cardElements.at(-1)?.focus({ preventScroll: true });
        };
        const handleKey = (event) => {
            if (event.target.closest('a')) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleTopCardClick(event);
            }
        };
        let completed = false;
        const complete = () => {
            if (completed) return;
            completed = true;
            clearRevealEffect();
            packContainer.removeEventListener('click', handleTopCardClick);
            packContainer.removeEventListener('keydown', handleKey);
            packContainer.innerHTML = buildPlaceholder();
            revealAllButton.hidden = true;
            finishReveal = null;
            packSummary.innerHTML = `<p class="section-kicker">TON DERNIER DROP // ${pack.length} CARTES</p><div class="summary-grid">${pack.map((card) => `
                <article><img src="${coverUrl(card.cover)}" alt="${escapeHtml(card.name)}">
                <strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.artist)}</span>
                <span class="rarity">${escapeHtml(card.rarity)}</span></article>`).join('')}</div>`;
            packSummary.hidden = false;
            openPackButton.focus({ preventScroll: true });
            resolve();
        };
        finishReveal = complete;
        revealAllButton.hidden = false;
        activateTopCard();
        packContainer.addEventListener('keydown', handleKey);

        packContainer.addEventListener('click', handleTopCardClick);

    });

};


// =========================
// COLLECTION
// =========================

const loadCollection = async () => {
    const currentSession = sessionVersion;

    try {

        const response = await apiFetch(`${API_URL}/api/collection`);

        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}`);
        }

        const data = await response.json();
        if (currentSession !== sessionVersion) return;
        collectionCards = data.collection || [];
        displayCollection(collectionCards);
        if (!artistCatalog) {
            try {
                const catalogResponse = await apiFetch(`${API_URL}/api/cards`);
                const catalogData = await catalogResponse.json();
                if (currentSession !== sessionVersion) return;
                if (!catalogResponse.ok || !catalogData.success) throw new Error();
                artistCatalog = catalogData.cards;
                renderArtistAlbum();
            } catch {
                if (currentSession === sessionVersion) document.getElementById('artist-progress').textContent = 'Catalogue indisponible. Utilise Actualiser pour réessayer.';
            }
        }

    } catch (error) {
        if (currentSession === sessionVersion) notify('Collection indisponible. Réessaie avec Actualiser.');
        console.error('Erreur collection :', error);
    }

};


// =========================
// AFFICHER COLLECTION
// =========================

const displayCollection = (collection) => {
    document.dispatchEvent(new Event('collection-updated'));
    renderArtistAlbum();
    collection = collection || [];
    const search = rarityClass(document.getElementById('collection-search').value.trim());
    const filter = document.getElementById('collection-rarity').value;
    const sort = document.getElementById('collection-sort').value;
    const total = collection.reduce((sum, card) => sum + (card.quantity || 1), 0);
    const artists = new Set(collection.map((card) => card.artist)).size;
    document.getElementById('collection-stats').innerHTML = `
        <div><strong>${collection.length}</strong><span>Titres uniques</span></div>
        <div><strong>${total}</strong><span>Cartes collectées</span></div>
        <div><strong>${artists}</strong><span>Artistes découverts</span></div>
        <div><strong>${total - collection.length}</strong><span>Doublons</span></div>`;
    const filtered = collection.filter((card) => (!document.getElementById('favorites-only').checked || window.collectionPreferences?.favorites.includes(card.id)) && (!filter || rarityClass(card.rarity) === filter)
        && (!search || rarityClass(`${card.name} ${card.artist}`).includes(search)));
    document.getElementById('collection-count').textContent = `${filtered.length} / ${collection.length} titres affichés`;

    collectionContainer.innerHTML = '';

    if (filtered.length === 0) {
        collectionContainer.innerHTML = `
            <p class="empty">${collection.length ? 'Aucun morceau ne correspond. Essaie un autre titre ou une autre rareté.' : 'Ton premier drop t’attend. Ouvre un pack pour commencer ta collection.'}</p>
        `;
        return;
    }

    const sortedCollection = [...filtered].sort((firstCard, secondCard) => {
        if (sort === 'name' || sort === 'artist') return firstCard[sort].localeCompare(secondCard[sort], 'fr');
        if (sort === 'quantity') return (secondCard.quantity || 1) - (firstCard.quantity || 1);
        const firstRarity = rarityClass(firstCard.rarity);
        const secondRarity = rarityClass(secondCard.rarity);

        return rarityOrder[secondRarity] - rarityOrder[firstRarity];
    });

    sortedCollection.forEach((card) => {

        const element = document.createElement('div');
        element.className = `collection-card ${rarityClass(card.rarity)}`;
        element.dataset.cardId = card.id;

        element.innerHTML = `
            <img src="${coverUrl(card.cover)}" alt="${escapeHtml(card.name)}" loading="lazy">
            <span class="quantity-badge" aria-label="${card.quantity || 1} exemplaires">×${card.quantity || 1}</span>

            <div class="collection-info">
                <h3 title="${escapeHtml(card.name)}">${escapeHtml(card.name)}</h3>
                <p>${escapeHtml(card.artist)}</p>
                <span class="rarity">${escapeHtml(card.rarity)}</span>
                <div class="card-actions">
                    <button type="button" data-action="details">Voir la fiche</button>
                    <button type="button" data-action="favorite" aria-pressed="${window.collectionPreferences?.favorites.includes(card.id) || false}">${window.collectionPreferences?.favorites.includes(card.id) ? '♥ Favori' : '♡ Favori'}</button>
                    <button type="button" data-action="showcase" aria-pressed="${window.collectionPreferences?.showcase.includes(card.id) || false}">${window.collectionPreferences?.showcase.includes(card.id) ? 'Retirer de la vitrine' : 'Exposer'}</button>
                    <button type="button" data-action="sell" ${card.salePrice ? '' : 'disabled'}>Vendre · +${formatPoints(card.salePrice || 0)} pts</button>
                </div>
                ${safeUrl(card.spotifyUrl) ? `<a class="spotify-link" href="${safeUrl(card.spotifyUrl)}" target="_blank" rel="noopener noreferrer">Écouter sur Spotify ↗</a>` : ''}
            </div>
        `;

        collectionContainer.appendChild(element);

    });

};


// =========================
// EVENTS
// =========================

openPackButton.addEventListener('click', () => openPack());
revealAllButton.addEventListener('click', () => finishReveal?.());
['collection-search', 'collection-rarity', 'collection-sort'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => displayCollection(collectionCards));
});
document.addEventListener('error', (event) => {
    if (event.target instanceof HTMLImageElement && !event.target.src.endsWith('/asha-logo.png')) {
        event.target.src = 'asha-logo.png';
    }
}, true);

boosterShop.addEventListener('click', (event) => {
    const button = event.target.closest('.buy-booster');
    const cardId = button?.dataset.cardId;
    const price = Number(button?.dataset.cardPrice);

    if (cardId && price) {
        buyCard(cardId, price, button);
    }
});

packContainer.addEventListener('click', (event) => {
    if (!openPackButton.disabled && event.target.closest('.pack-placeholder')) {
        openPack();
    }
});

refreshCollectionButton.addEventListener('click', loadCollection);

navigationButtons.forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.view));
});

authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    authStatus.textContent = 'Connexion...';
    try {
        await authenticate('/api/auth/login');
    } catch (error) {
        authStatus.textContent = error.message;
    }
});

registerButton.addEventListener('click', async () => {
    if (!authForm.reportValidity()) return;
    authStatus.textContent = 'Création du compte...';
    try {
        await authenticate('/api/auth/register');
    } catch (error) {
        authStatus.textContent = error.message;
    }
});

logoutButton.addEventListener('click', async () => {
    try {
        const response = await apiFetch(`${API_URL}/api/auth/logout`, { method: 'POST' });
        if (!response.ok && response.status !== 401) throw new Error();
    } catch {
        notify('Déconnexion impossible. Vérifie ta connexion puis réessaie.');
        return;
    }
    authToken = null;
    localStorage.removeItem('asha-auth-token');
    setLoggedOut('Déconnecté.');
});

profileLogout.addEventListener('click', () => logoutButton.click());


// =========================
// INITIALISATION
// =========================

updatePoints();
showView('packs');
restoreSession();
