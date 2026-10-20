/**
 * Module API Centralisé (api.js)
 * Implémente le pattern Singleton pour envoyer les requêtes vers le CRM.
 * Conformité Charte: Règle 12 (Centralisation, Timeout, Retry) & Règle 7 (async/await, try/catch).
 */

const API_TIMEOUT = 10000; // 10 secondes
const MAX_RETRIES = 2; // 2 tentatives

/**
 * Fetch avec Timeout encapsulé
 */
const fetchWithTimeout = async (url, options) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        if (err.name === 'AbortError') {
            throw new Error(`Timeout de l'API dépassé (${API_TIMEOUT}ms) : ${url}`);
        }
        throw err;
    }
};

/**
 * Appel API générique avec Retry
 */
const apiCall = async (url, options = {}, retries = 0) => {
    try {
        const response = await fetchWithTimeout(url, options);
        
        if (!response.ok) {
            // Erreur HTTP != 2xx
            if (retries < MAX_RETRIES && (response.status >= 500 || response.status === 429)) {
                // Retry only on server errors or rate limiting
                console.warn(`[API] Echec ${response.status} sur ${url}. Tentative ${retries + 1}/${MAX_RETRIES}...`);
                await new Promise(res => setTimeout(res, 1000 * (retries + 1))); // backoff
                return await apiCall(url, options, retries + 1);
            }
            
            let errDetail = "";
            try {
                const errJson = await response.json();
                errDetail = errJson.error ? errJson.error.message : JSON.stringify(errJson);
            } catch(e) {}
            
            const errMsg = errDetail ? `Erreur HTTP ${response.status}: ${errDetail}` : `Erreur HTTP ${response.status}: ${response.statusText}`;
            throw new Error(errMsg);
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }
        // Pour le téléchargement de documents (blob) ou de text
        return response;
    } catch (err) {
        if (retries < MAX_RETRIES && err.message.includes('fetch')) {
            // Retry on network/DNS errors
            console.warn(`[API] Erreur Réseau sur ${url}. Tentative ${retries + 1}/${MAX_RETRIES}...`);
            await new Promise(res => setTimeout(res, 1000 * (retries + 1)));
            return await apiCall(url, options, retries + 1);
        }
        const isLoginFallback = url.includes('/login?') && err.message.includes('403');
        if (!err.message.includes('404') && !isLoginFallback) {
            console.error(`[API] Echoué après ${retries} tentatives :`, err);
        }
        throw err;
    }
};

export const apiService = {
    /**
     * @param {string} doliUrl
     * @param {string} apiKey
     * @param {string} endpoint
     * @param {string} [entity]
     */
    get: async (doliUrl, apiKey, endpoint, entity = '') => {
        const headers = {
            'DOLAPIKEY': apiKey,
            'Accept': 'application/json'
        };
        if (entity && String(entity).trim() !== '') {
            headers['DOLAPIENTITY'] = String(entity).trim();
        }
        return await apiCall(`${doliUrl}/api/index.php${endpoint}`, {
            method: 'GET',
            headers
        });
    },

    /**
     * @param {string} doliUrl
     * @param {string} apiKey
     * @param {string} endpoint
     * @param {object} payload
     * @param {string} [entity]
     */
    post: async (doliUrl, apiKey, endpoint, payload, entity = '') => {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (apiKey) {
            headers['DOLAPIKEY'] = apiKey;
        }
        if (entity && String(entity).trim() !== '') {
            headers['DOLAPIENTITY'] = String(entity).trim();
        }
        const fetchOpts = {
            method: 'POST',
            headers
        };
        if (payload !== null && payload !== undefined) {
            fetchOpts.body = JSON.stringify(payload);
        }
        return await apiCall(`${doliUrl}/api/index.php${endpoint}`, fetchOpts);
    },

    /**
     * @param {string} doliUrl
     * @param {string} apiKey
     * @param {string} endpoint
     * @param {object} payload
     * @param {string} [entity]
     */
    put: async (doliUrl, apiKey, endpoint, payload, entity = '') => {
        const headers = {
            'DOLAPIKEY': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (entity && String(entity).trim() !== '') {
            headers['DOLAPIENTITY'] = String(entity).trim();
        }
        return await apiCall(`${doliUrl}/api/index.php${endpoint}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload)
        });
    },

    /**
     * @param {string} doliUrl
     * @param {string} apiKey
     * @param {string} endpoint
     * @param {string} [entity]
     */
    del: async (doliUrl, apiKey, endpoint, entity = '') => {
        const headers = {
            'DOLAPIKEY': apiKey,
            'Accept': 'application/json'
        };
        if (entity && String(entity).trim() !== '') {
            headers['DOLAPIENTITY'] = String(entity).trim();
        }
        return await apiCall(`${doliUrl}/api/index.php${endpoint}`, {
            method: 'DELETE',
            headers
        });
    },

    /**
     * Utilitaire pour le t?l?versement de documents
     */
    upload: async (doliUrl, apiKey, endpoint, formData, entity = '') => {
        const headers = {
            'DOLAPIKEY': apiKey
        };
        if (entity && String(entity).trim() !== '') {
            headers['DOLAPIENTITY'] = String(entity).trim();
        }
        return await apiCall(`${doliUrl}/api/index.php${endpoint}`, {
            method: 'POST',
            headers,
            body: formData
        });
    }
};
