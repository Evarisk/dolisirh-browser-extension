# AGENTS.md - Instructions IA pour l'Extension ReedCRM

Ce fichier est la référence absolue pour toute IA intervenant sur le dépôt `reedcrm-browser-extension`.

## 1. Philosophie & Priorités
- **Simplicité** : Vanilla JS exclusif (pas de jQuery/React). Des fonctions courtes et ciblées.
- **Conformité Manifest V3** : Sécurité stricte, pas de code inline, Service Workers éphémères.
- **Performance** : UI fluide (< 300ms), mise en cache agressive via `chrome.storage.local`.

## 2. Règles IA
- Privilégier les patterns existants avant d'en créer de nouveaux.
- Proposer des diffs minimaux et fonctionnels.
- JSDoc obligatoire pour toute nouvelle fonction métier.
- Chaque nouvelle chaîne de texte UI **doit** utiliser `chrome.i18n.getMessage` et inclure sa définition JSON.
- Code asynchrone systématique (async/await) wrappé dans des `try/catch`.
- Vérifier systématiquement `chrome.runtime.lastError` lors des callbacks d'API Chrome.

## 3. Conventions Critiques & Patterns Universels
- **I18n** : Aucune chaîne de caractères codée en dur. Tout passe par `_locales/*/messages.json`.
- **Stockage** :
  - `storage.sync` = Configuration durable (URL API, Token, langue).
  - `storage.local` = Données éphémères / cache (brouillons, liste de tickets).
- **Communication inter-scripts** : `chrome.runtime.sendMessage` avec `{ type: "CONSTANTE", payload: {} }`.
- **Gestion API** : Tous les fetchs transitent par le service worker (`fetchDoli` dans `api.js`) via messagerie, afin de contourner les règles CORS strictes des pages web.

## 4. Anti-Patterns & Sécurité
- **JAMAIS** d'`eval()` ni de scripts inline.
- **JAMAIS** de `innerHTML` avec des données entrantes (utiliser `textContent` ou `createElement`).
- **JAMAIS** de variables globales d'état persistantes dans le Service Worker (il s'éteint après 30s).
- **JAMAIS** de permissions globales (`*://*/*`) si des host_permissions ciblées suffisent.
- **JAMAIS** de credentials stockés en clair en local storage (utiliser `sync`).
- **JAMAIS** de `alert()` pour l'affichage d'erreurs UI. Utiliser des notifications inline discrètes (ex: `showErrorInline`).
