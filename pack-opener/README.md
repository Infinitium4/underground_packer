# ASHΛ — Underground Packs

Ouvre des packs de morceaux de la scène underground, collectionne les cartes par rareté et retrouve les artistes sur Spotify.

## Lancer l’application

Depuis `pack-opener/backend`, avec Node.js 24 :

```powershell
npm.cmd install
npm.cmd start
```

Le fichier `backend/.env` doit contenir `SPOTIFY_CLIENT_ID` et `SPOTIFY_CLIENT_SECRET`, obtenus pour ton application Spotify. Ne partage pas ces valeurs.

Ouvre ensuite http://localhost:3000/app. Le catalogue charge en arrière-plan. Les recherches et le catalogue complet sont mis en cache pendant 24 heures. Si Spotify est indisponible, le dernier catalogue reste utilisable ; en l’absence de cache complet, les morceaux déjà enregistrés servent de catalogue de secours, potentiellement incomplet.

En cas de réponse 429, le serveur respecte `Retry-After` et conserve ce délai en base, même après un redémarrage. Sans délai fourni, l’attente commence à cinq minutes et augmente en cas d’échecs répétés. Les pages déjà chargées sont réutilisées. Les requêtes réseau sont espacées d’au moins 500 ms.

## Utilisation


- **Vendre une carte** : dans la collection, « Vendre » échange un exemplaire contre des points après confirmation. Prix : commun 25, rare 40, épique 60, légendaire 80, spécial 100, exclu 120 points. La vente du dernier exemplaire le retire également des favoris et de la vitrine. Les prix sont calculés par le serveur.

- **Packs généraux** : chaque ouverture pioche jusqu’à 5 titres distincts dans toute la scène underground. La déchirure démarre au clic, dure une demi-seconde et accompagne la requête. Un second clic sur une carte révélée permet de passer immédiatement à la suivante.
- **Favoris** : utilise le cœur sur une carte, puis coche « Mes favoris uniquement » pour les retrouver.
- **Ma vitrine** : sélectionne jusqu’à 5 cartes avec « Exposer » et choisis une ambiance Or, Violet ou Menthe. Favoris, vitrine et thème sont sauvegardés dans ton compte.
- **Fiche du morceau** : ouvre « Voir la fiche » depuis la collection ou clique sur une carte de ta vitrine. Tu y retrouves l’album, la date de sortie et la durée si présents dans le catalogue Spotify chargé, tes exemplaires, un extrait lorsqu’il est disponible et le lien Spotify. Les extraits s’arrêtent à la fermeture de la fiche.

- Révèle chaque carte au clic ou avec Entrée/Espace, ou utilise **Tout révéler**. Le dernier pack reste visible dans un récapitulatif.
- Dans **Collection**, recherche un titre ou un artiste, filtre les raretés et trie les cartes. Les exemplaires et doublons sont comptabilisés.
- L’album de progression indique, pour chaque artiste du catalogue chargé, le nombre de titres uniques possédés et ceux restant à découvrir. Les doublons ne modifient pas le pourcentage ; un album terminé reçoit la mention **COMPLET**.
- Les cartes légendaires et spéciales déclenchent une cinématique plein écran de 3,6 secondes, avec deux mises en scène distinctes. Utilise **Passer l’animation** ou Échap pour revenir immédiatement à la carte. Le mode système de réduction des mouvements conserve une révélation simple.
- La boutique conserve les prix existants et confirme les achats par notification.
- Chaque carte de la boutique du jour ne peut être achetée qu’une fois par joueur. Le bouton affiche « DÉJÀ ACHETÉE », y compris après rechargement ; revendre la carte ne permet pas de racheter la même offre.
- La boutique propose jusqu’à six cartes communes à tous les joueurs, renouvelées à minuit (Europe/Paris). Les offres et leurs prix sont conservés en base pendant la journée, même après un redémarrage. Les titres absents de la sélection précédente sont prioritaires ; la page actualise automatiquement les offres à minuit.
- Les comptes et cartes sont conservés dans `backend/pack-opener.sqlite`. Les ouvertures restent gratuites et les nouveaux comptes reçoivent les 1 200 points prévus par le projet.

## Vérifications

```powershell
npm.cmd run check
npm.cmd test
```

Les tests utilisent un catalogue Spotify simulé et une base temporaire. Ils vérifient les comptes, les packs sauvegardés, les achats concurrents et le démarrage sans Spotify, sans modifier la collection réelle.
