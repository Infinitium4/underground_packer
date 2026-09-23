const API_URL = 'http://localhost:3000';


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

    if (viewName === 'shop' && shopCards.length === 0) {
        loadCardShop();
    }

    if (viewName === 'collection') {
        loadCollection();
    }
};

const buildPlaceholder = () => `
    <div class="pack-placeholder">
        <span class="pack-clip"></span>
        <p class="pack-label">ASHΛ // SERIES 01</p>
        <img class="pack-logo" src="asha-logo.png" alt="ASHΛ">
        <span class="pack-edition">UNDERGROUND PACK</span>
        <p class="pack-hint">Ouvre un pack</p>
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
    return fetch(url, { ...options, headers });
};

const setAuthenticated = (user) => {
    document.body.classList.add('authenticated');
    points = user.points ?? points;
    updatePoints();
    accountPanel.hidden = true;
    profileMenu.hidden = false;
    profileEmail.textContent = user.email;
    authForm.hidden = true;
    logoutButton.hidden = false;
    authStatus.textContent = `Connecté : ${user.email}`;
};

const setLoggedOut = (message = 'Connecte-toi pour sauvegarder ta collection.') => {
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
        const price = 150 + (index % 5) * 100;

        return `
        <article class="booster-card card-shop-item" style="--delay: ${index * 55}ms">
            <div class="booster-art">
                <img src="${card.cover || 'asha-logo.png'}" alt="${card.name}" loading="lazy">
                <span class="booster-stamp">CARTE 0${index + 1}</span>
                <span class="booster-count">${card.artist}</span>
            </div>
            <div class="booster-copy">
                <div>
                    <h3>${card.name}</h3>
                    <p>${card.artist} // carte artiste</p>
                </div>
                <button class="buy-booster" type="button" data-card-id="${card.id}" data-card-price="${price}">
                    <span>ACHETER</span>
                    <strong>◆ ${formatPoints(price)}</strong>
                </button>
            </div>
        </article>
    `;
    }).join('');
};

const loadCardShop = async () => {
    try {
        const response = await apiFetch(`${API_URL}/api/cards`);
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Impossible de charger les cartes');
        }

        shopCards = data.cards.slice(0, 6);
        renderCardShop();
    } catch (error) {
        boosterShop.innerHTML = '<p class="empty">La boutique est indisponible pour le moment.</p>';
        console.error('Erreur boutique :', error);
    }
};

const buyCard = async (cardId, price, button) => {
    if (points < price) {
        statusText.textContent = 'Pas assez de points pour cette carte.';
        return;
    }

    button.disabled = true;

    try {
        const response = await apiFetch(`${API_URL}/api/cards/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: cardId }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Achat impossible');
        }

        points = data.points;
        updatePoints();
        statusText.textContent = `${data.card.name} ajouté à ta collection.`;
        loadCollection();
    } catch (error) {
        statusText.textContent = error.message;
    } finally {
        button.disabled = false;
    }
};


// =========================
// OUVRIR UN PACK
// =========================

const openPack = async (booster = null) => {

    if (booster && points < booster.price) {
        statusText.textContent = 'Pas assez de points pour ce booster.';
        return;
    }

    openPackButton.disabled = true;
    document.querySelectorAll('.buy-booster').forEach((button) => {
        button.disabled = true;
    });
    statusText.textContent = 'Ouverture du pack...';

    const placeholder = packContainer.querySelector('.pack-placeholder');
    placeholder?.classList.add('shaking');

    try {

        // On fait patienter l'anticipation (secousse) au moins 550ms,
        // même si la réponse de l'API arrive plus vite.
        const [response] = await Promise.all([
            apiFetch(`${API_URL}/api/pack/open`, { method: 'POST' }),
            wait(550),
        ]);


        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}`);
        }


        const data = await response.json();


        if (!data.success) {
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

        statusText.textContent = 'Pack terminé !';

        // Actualiser la collection
        loadCollection();


    } catch (error) {

        console.error(error);

        statusText.textContent = 'Impossible d’ouvrir le pack.';

        packContainer.innerHTML = buildPlaceholder();

        const errorLine = document.createElement('p');
        errorLine.style.color = '#ff8a8a';
        errorLine.style.fontSize = '13px';
        errorLine.style.marginTop = '10px';
        errorLine.textContent = error.message;
        statusText.after(errorLine);

    }

    openPackButton.disabled = false;
    document.querySelectorAll('.buy-booster').forEach((button) => {
        button.disabled = false;
    });

};


// =========================
// AFFICHER LE PACK (pile de cartes, une carte à la fois)
// =========================

const displayPack = (pack) => {

    return new Promise((resolve) => {

        packContainer.innerHTML = '';

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
                            <img src="${card.cover}" alt="${card.name}">

                            <div class="card-info">
                                <div class="card-name">${card.name}</div>
                                <div class="card-artist">${card.artist}</div>
                                <span class="rarity">${card.rarity}</span>

                                ${
                                    card.spotifyUrl
                                    ? `<a class="spotify-link" href="${card.spotifyUrl}" target="_blank">Écouter sur Spotify →</a>`
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
            const cardElement = event.target.closest('.pack-card');

            if (
                !cardElement ||
                cardElement !== cardElements[cardElements.length - 1] ||
                cardElement.classList.contains('flying-away')
            ) {
                return;
            }

            if (!cardElement.classList.contains('revealed')) {
                cardElement.classList.add('revealed');

                if (rarityClass(sortedPack[cardElements.length - 1].rarity) === 'legendaire') {
                    playLegendaryPreview({
                        previewUrl: cardElement.previewUrl,
                        spotifyUrl: cardElement.spotifyUrl,
                    });
                }

                return;
            }

            cardElement.classList.add('flying-away');
            let cardRemoved = false;

            const finishCardRemoval = () => {
                if (cardRemoved) {
                    return;
                }

                cardRemoved = true;
                cardElement.remove();
                cardElements.pop();

                if (cardElements.length === 0) {
                    packContainer.innerHTML = buildPlaceholder();
                    packContainer.removeEventListener('click', handleTopCardClick);
                    resolve();
                }
            };

            cardElement.addEventListener('animationend', finishCardRemoval, { once: true });

            // Fallback for reduced-motion modes where the animation may be skipped.
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                finishCardRemoval();
            }
        };

        packContainer.addEventListener('click', handleTopCardClick);

    });

};


// =========================
// COLLECTION
// =========================

const loadCollection = async () => {

    try {

        const response = await apiFetch(`${API_URL}/api/collection`);

        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}`);
        }

        const data = await response.json();

        displayCollection(data.collection);

    } catch (error) {
        console.error('Erreur collection :', error);
    }

};


// =========================
// AFFICHER COLLECTION
// =========================

const displayCollection = (collection) => {

    collectionContainer.innerHTML = '';

    if (!collection || collection.length === 0) {
        collectionContainer.innerHTML = `
            <p class="empty">Aucune carte dans ta collection.</p>
        `;
        return;
    }

    const sortedCollection = [...collection].sort((firstCard, secondCard) => {
        const firstRarity = rarityClass(firstCard.rarity);
        const secondRarity = rarityClass(secondCard.rarity);

        return rarityOrder[secondRarity] - rarityOrder[firstRarity];
    });

    sortedCollection.forEach((card) => {

        const element = document.createElement('div');
        element.className = `collection-card ${rarityClass(card.rarity)}`;

        element.innerHTML = `
            <img src="${card.cover}" alt="${card.name}">

            <div class="collection-info">
                <h3>${card.name}</h3>
                <p>${card.artist}</p>
                <span class="rarity">${card.rarity}</span>
            </div>
        `;

        collectionContainer.appendChild(element);

    });

};


// =========================
// EVENTS
// =========================

openPackButton.addEventListener('click', () => openPack());

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
    authStatus.textContent = 'Création du compte...';
    try {
        await authenticate('/api/auth/register');
    } catch (error) {
        authStatus.textContent = error.message;
    }
});

logoutButton.addEventListener('click', async () => {
    await apiFetch(`${API_URL}/api/auth/logout`, { method: 'POST' });
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