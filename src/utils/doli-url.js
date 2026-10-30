/**
 * URL de l'API Dolibarr - src/utils/doli-url.js
 * Partagé par l'assistant de connexion de la popup et par les options.
 */

/**
 * Génère les URLs API candidates à partir de l'URL saisie par l'utilisateur.
 * Sans /api/index.php ni /htdocs, la racine web peut être htdocs (la plupart des hébergements)
 * ou son dossier parent (une installation depuis les sources) : les deux sont proposées.
 * @param {string} rawUrl - URL brute saisie par l'utilisateur
 * @returns {string[]} Liste d'URLs normalisées se terminant par /api/index.php
 */
export function getDoliApiCandidates(rawUrl) {
    let cleaned = (rawUrl || '').trim();
    if (!/^https?:\/\//i.test(cleaned)) {
        cleaned = 'https://' + cleaned;
    }
    cleaned = cleaned.replace(/\/+$/, '');
    if (cleaned.endsWith('/api/index.php')) {
        return [cleaned];
    }
    if (cleaned.includes('/api/index.php/')) {
        return [cleaned.split('/api/index.php/')[0] + '/api/index.php'];
    }
    if (cleaned.endsWith('/htdocs')) {
        return [cleaned + '/api/index.php'];
    }
    return [
        cleaned + '/api/index.php',
        cleaned + '/htdocs/api/index.php'
    ];
}
