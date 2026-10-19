import { MESSAGE_TYPES } from '../../../../src/utils/constants.js';

/**
 * Proxy vers le Service Worker pour tous les appels API Dolibarr.
 * Conforme AGENTS.md règle 3 (CORS) — timeout 12s pour gérer l'endormissement MV3.
 * @param {string} url - URL complète de l'endpoint Dolibarr
 * @param {Object} [options={}] - Options fetch (method, headers, body)
 * @returns {Promise<Response>}
 */
export async function fetchDoli(url, options = {}) {
    let method = options.method || 'GET';
    let body = options.body ? JSON.parse(options.body) : null;
    let doliUrl = '', endpoint = '', apiKey = '';

    try {
        const urlObj = new URL(url);
        doliUrl = urlObj.origin + (urlObj.pathname.includes('/api/index.php') ? urlObj.pathname.split('/api/index.php')[0] : '');
        endpoint = url.replace(doliUrl + '/api/index.php', '');
        if (!endpoint.startsWith('/')) {
            endpoint = url.replace(doliUrl, '');
        }
    } catch(e) {}

    apiKey = options.headers?.DOLAPIKEY || options.headers?.['DOLAPIKEY'];

    // Promesse principale via messagerie SW
    const swPromise = new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.API_CALL,
            payload: { method, doliUrl, apiKey, endpoint, body }
        }, response => {
            if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
            }
            if (response && response.error) {
                return resolve({
                    ok: false,
                    status: 500,
                    statusText: response.error,
                    json: async () => { throw new Error(response.error); },
                    text: async () => response.error
                });
            }
            resolve({
                ok: true,
                status: 200,
                json: async () => response.data,
                text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
                blob: async () => {
                    if (response.data) {
                        const bstr = atob(response.data);
                        const n = bstr.length;
                        const u8arr = new Uint8Array(n);
                        for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
                        return new Blob([u8arr], { type: response.mime || 'application/octet-stream' });
                    }
                    return null;
                }
            });
        });
    });

    // Timeout 12s — évite les promesses bloquées quand le SW est endormi (MV3)
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('[ReedCRM-5001] Service worker timeout (12s) — réessayez dans un instant.')), 12000)
    );

    return Promise.race([swPromise, timeoutPromise]);
}
