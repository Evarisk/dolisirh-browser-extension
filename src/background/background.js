import { apiService } from '../services/api.js';
import { MESSAGE_TYPES } from '../utils/constants.js';

// background.js - Gère les événements d'arrière-plan de l'extension
// Charte IA: Routeur centralisé (Middleware) ! Ne stocke aucune logique d'état global.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (!request.type && request.action) {
        // Redirection temporaire des vieux types (action -> type) pour compatibilité
        request.type = request.action;
    }

    if (request.type === MESSAGE_TYPES.OPEN_POPUP) {
        chrome.action.openPopup();
        sendResponse({ success: true });
        return true;
    } else if (request.type === MESSAGE_TYPES.OPEN_OPTIONS) {
        chrome.runtime.openOptionsPage();
        sendResponse({ success: true });
        return true;
    }
    
    // ---- Gestion Centralisée des Fetch API (Règle 12) ----
    if (request.type === MESSAGE_TYPES.API_CALL) {
        const payload = request.payload || {};
        const { method, doliUrl, apiKey, endpoint, body } = payload;

        if (!doliUrl || (!apiKey && !endpoint.startsWith('/login')) || !endpoint) {
            sendResponse({ error: "Configuration API incomplète reçue par le worker." });
            return true;
        }

        // Exécute l'appel API asynchrone côté background worker (isolé, stable)
        (async () => {
            try {
                let data;
                if (method === 'GET') {
                    data = await apiService.get(doliUrl, apiKey, endpoint);
                } else if (method === 'POST') {
                    data = await apiService.post(doliUrl, apiKey, endpoint, body);
                } else if (method === 'PUT') {
                    data = await apiService.put(doliUrl, apiKey, endpoint, body);
                } else if (method === 'DELETE') {
                    data = await apiService.del(doliUrl, apiKey, endpoint);
                } else if (method === 'UPLOAD') {
                    // Les formData bruts ne passent pas direct dans les messages. On le recrée.
                    // NOTE: FormData serialization strategy might be needed if uploading binary.
                    sendResponse({ error: "UPLOAD must be routed specifically if using Blobs over messaging." });
                    return;
                } else {
                    throw new Error(`Méthode ${method} non gérée.`);
                }
                
                sendResponse({ success: true, data });
            } catch (error) {
                // Ignore silencieusement l'erreur 404 (comportement de fallback normal pour champs manquants)
                if (!error.message.includes('404')) {
                    console.error(`[Background API Error] ${method} ${endpoint}:`, error);
                }
                sendResponse({ success: false, error: error.message });
            }
        })();

        // Indique que sendResponse sera appelé en asynchrone
        return true; 
    }

    // fallback
    return true;
});
