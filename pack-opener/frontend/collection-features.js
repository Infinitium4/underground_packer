window.collectionPreferences = { favorites: [], showcase: [], theme: 'gold' };
let preferencesReady = false;
let preferencesBusy = false;
let detailDialog = null;
let saleBusy = false;

const sellCard = async (id) => {
    if (saleBusy || preferencesBusy) { notify('Une sauvegarde est en cours. Réessaie dans un instant.'); return; }
    const card = collectionCards.find((item) => item.id === id);
    if (!card?.salePrice) return;
    const lastCopy = card.quantity === 1;
    if (!window.confirm(`Vendre un exemplaire de « ${card.name} » pour ${card.salePrice} points ?\n${lastCopy ? 'C’est ton dernier exemplaire : il sera retiré de ta collection, de tes favoris et de ta vitrine.' : `Il te restera ${card.quantity - 1} exemplaire(s).`}`)) return;
    const version = sessionVersion;
    saleBusy = true;
    try {
        const response = await apiFetch(`${API_URL}/api/cards/sell`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
        if (response.status === 404 && !(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Redémarre le serveur pour activer la vente.');
        const data = await response.json();
        if (version !== sessionVersion) return;
        if (!response.ok) throw new Error(data.error || 'Vente impossible');
        points = data.points;
        updatePoints();
        if (data.quantity === 0) {
            collectionCards = collectionCards.filter((item) => item.id !== id);
            for (const field of ['favorites', 'showcase']) window.collectionPreferences[field] = window.collectionPreferences[field].filter((item) => item !== id);
        } else card.quantity = data.quantity;
        displayCollection(collectionCards);
        notify(`${data.name} vendu : +${data.earned} points.`);
    } catch (error) { if (version === sessionVersion) notify(error.message); }
    finally { if (version === sessionVersion) saleBusy = false; }
};

const renderShowcase = () => {
    const preferences = window.collectionPreferences;
    const showcase = document.getElementById('showcase');
    showcase.dataset.theme = preferences.theme;
    document.getElementById('showcase-theme').value = preferences.theme;
    document.getElementById('showcase-cards').innerHTML = preferences.showcase.map((id) => {
        const card = collectionCards.find((item) => item.id === id);
        if (!card) return '';
        return `<button type="button" class="showcase-card" data-detail-id="${escapeHtml(id)}">
            <img src="${coverUrl(card.cover)}" alt="${escapeHtml(card.name)}"><strong>${escapeHtml(card.name)}</strong>
            <span>${escapeHtml(card.artist)}</span><span class="rarity">${escapeHtml(card.rarity)}</span></button>`;
    }).join('') || '<p class="empty">Ta scène est prête. Choisis « Exposer » sur tes meilleures cartes.</p>';
};

const loadCollectionFeatures = async () => {
    const version = sessionVersion;
    try {
        const response = await apiFetch(`${API_URL}/api/preferences`);
        if (!response.ok) throw new Error(response.status === 404
            ? 'Le serveur doit être redémarré pour activer les favoris et la vitrine.'
            : 'Favoris et vitrine indisponibles. Clique sur Actualiser pour réessayer.');
        const data = await response.json();
        if (version !== sessionVersion || preferencesBusy) return;
        window.collectionPreferences = data;
        preferencesReady = true;
        displayCollection(collectionCards);
    } catch (error) {
        if (version === sessionVersion) notify(error.message);
    }
};

const savePreferences = async (next) => {
    if (!preferencesReady || preferencesBusy || saleBusy) {
        notify(preferencesBusy ? 'Sauvegarde en cours…' : 'Utilise Actualiser pour charger tes préférences.');
        renderShowcase();
        return;
    }
    const version = sessionVersion;
    preferencesBusy = true;
    try {
        const response = await apiFetch(`${API_URL}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
        if (response.status === 404) throw new Error('Redémarre le serveur pour activer la sauvegarde des favoris et de la vitrine.');
        const data = await response.json();
        if (version !== sessionVersion) return;
        if (!response.ok) throw new Error(data.error || 'Sauvegarde impossible');
        window.collectionPreferences = data;
        displayCollection(collectionCards);
        notify('Sélection sauvegardée.');
    } catch (error) {
        if (version === sessionVersion) { notify(error.message); renderShowcase(); }
    } finally { if (version === sessionVersion) preferencesBusy = false; }
};

const openCardDetails = async (id) => {
    detailDialog?.close();
    const dialog = document.createElement('dialog');
    detailDialog = dialog;
    dialog.className = 'track-dialog';
    dialog.setAttribute('aria-label', 'Fiche du morceau');
    dialog.innerHTML = '<button type="button" class="detail-close" aria-label="Fermer la fiche">✕</button><div class="detail-content" role="status">Chargement du morceau…</div>';
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        dialog.querySelector('audio')?.pause();
        dialog.remove();
        if (detailDialog === dialog) detailDialog = null;
    }, { once: true });
    document.body.appendChild(dialog);
    dialog.showModal();
    previewAudio?.pause();
    try {
        const response = await apiFetch(`${API_URL}/api/cards/${encodeURIComponent(id)}/details`);
        const data = await response.json();
        if (!dialog.open) return;
        if (!response.ok) throw new Error(data.error || 'Fiche indisponible');
        const card = data.card;
        const duration = card.durationMs ? `${Math.floor(card.durationMs / 60000)}:${String(Math.floor(card.durationMs / 1000) % 60).padStart(2, '0')}` : 'Non renseignée';
        dialog.querySelector('.detail-content').innerHTML = `<img class="detail-cover" src="${coverUrl(card.cover)}" alt="${escapeHtml(card.name)}">
            <span class="rarity">${escapeHtml(card.rarity)}</span><h2>${escapeHtml(card.name)}</h2><p>${escapeHtml(card.artist)}</p>
            <dl><dt>Album</dt><dd>${escapeHtml(card.album || 'Non renseigné dans le catalogue disponible')}</dd><dt>Sortie</dt><dd>${escapeHtml(card.releaseDate || 'Non renseignée')}</dd><dt>Durée</dt><dd>${duration}</dd><dt>Exemplaires</dt><dd>${card.quantity}</dd></dl>
            ${safeUrl(card.previewUrl) ? `<audio controls preload="none" src="${safeUrl(card.previewUrl)}" aria-label="Extrait du morceau"></audio>` : '<p class="album-hint">Aucun extrait disponible pour ce morceau.</p>'}
            ${safeUrl(card.spotifyUrl) ? `<a class="detail-spotify" href="${safeUrl(card.spotifyUrl)}" target="_blank" rel="noopener noreferrer">Écouter sur Spotify ↗</a>` : ''}`;
    } catch (error) { if (dialog.open) dialog.querySelector('.detail-content').textContent = error.message; }
};

document.addEventListener('account-ready', loadCollectionFeatures);
document.addEventListener('account-cleared', () => {
    preferencesReady = false;
    preferencesBusy = false;
    saleBusy = false;
    window.collectionPreferences = { favorites: [], showcase: [], theme: 'gold' };
    document.getElementById('favorites-only').checked = false;
    detailDialog?.close();
    renderShowcase();
});
document.addEventListener('collection-updated', renderShowcase);
document.getElementById('refresh-collection').addEventListener('click', loadCollectionFeatures);
document.getElementById('favorites-only').addEventListener('change', () => displayCollection(collectionCards));
document.getElementById('showcase-theme').addEventListener('change', (event) => savePreferences({ ...window.collectionPreferences, theme: event.target.value }));
document.getElementById('showcase-cards').addEventListener('click', (event) => {
    const button = event.target.closest('[data-detail-id]');
    if (button) openCardDetails(button.dataset.detailId);
});
collectionContainer.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const id = button?.closest('[data-card-id]')?.dataset.cardId;
    if (!id) return;
    if (button.dataset.action === 'sell') { sellCard(id); return; }
    if (button.dataset.action === 'details') { openCardDetails(id); return; }
    const field = button.dataset.action === 'favorite' ? 'favorites' : 'showcase';
    const current = window.collectionPreferences[field];
    if (field === 'showcase' && current.length >= 5 && !current.includes(id)) { notify('Ta vitrine contient déjà 5 cartes. Retires-en une avant d’en ajouter une autre.'); return; }
    savePreferences({ ...window.collectionPreferences, [field]: current.includes(id) ? current.filter((value) => value !== id) : [...current, id] });
});
renderShowcase();
if (document.body.classList.contains('authenticated')) loadCollectionFeatures();
