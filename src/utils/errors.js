// Dictionnaire standardisé des erreurs Doli-ReedCRM (Métadonnées uniquement)
const ERROR_DICTIONARY = {
    // ---- Catégorie : API & Réseau (Série 1000) ----
    'ReedCRM-1001': { category: 'Réseau', key: 'error_1001', file: 'options.js', line: 155 },
    'ReedCRM-1002': { category: 'Authentification', key: 'error_1002', file: 'options.js', line: 35 },
    'ReedCRM-1003': { category: 'Permissions', key: 'error_1003', file: 'popup.js', line: 1276 },
    'ReedCRM-1004': { category: 'Ressource Introuvable', key: 'error_1004', file: 'popup.js', line: 1279 },
    'ReedCRM-1500': { category: 'Serveur Dolibarr (Erreur Interne)', key: 'error_1500', file: 'popup.js', line: 1282 },
    
    // ---- Catégorie : Configuration (Série 2000) ----
    'ReedCRM-2001': { category: 'Configuration Manquante', key: 'error_2001', file: 'popup.js', line: 1216 },
    'ReedCRM-2002': { category: 'Configuration Manquante', key: 'error_2002', file: 'background.js', line: 'multiple' },

    // ---- Catégorie : Performance (Série 2500) ----
    'ReedCRM-2003': { category: 'Performance: Miniature Manquante', key: 'error_2003', file: 'popup.js', line: 950 },

    // ---- Catégorie : Validation Formulaire (Série 3000) ----
    'ReedCRM-3001': { category: 'Validation', key: 'error_3001', file: 'popup.js', line: '1190-1200' },
    'ReedCRM-3002': { category: 'Validation', key: 'error_3002', file: 'popup.js', line: '950-960' },

    // ---- Catégorie : Traitement Métier / Création Entités (Série 4000) ----
    'ReedCRM-4001': { category: 'Affectation Contact', key: 'error_4001', file: 'popup.js', line: 1056 },
    'ReedCRM-4002': { category: 'Sauvegarde API', key: 'error_4002', file: 'popup.js', line: 1023 },
    'ReedCRM-4003': { category: 'Erreur Réseau (Contact)', key: 'error_4003', file: 'popup.js', line: 1067 },
    'ReedCRM-4004': { category: 'Sauvegarde API', key: 'error_4004', file: 'popup.js', line: 1341 },
    'ReedCRM-4005': { category: 'Envoi PJ Opportunité', key: 'error_4005', file: 'popup.js', line: 'auto' },
    'ReedCRM-4006': { category: 'Envoi PJ Ticket', key: 'error_4006', file: 'popup.js', line: 'auto' },

    // ---- Catégorie : Timesheet / Pointage RH (Série 5000) ----
    'ReedCRM-5001': { category: 'Pointage RH - Validation', key: 'error_5001', file: 'timesheet/index.js', line: 'auto' },
    'ReedCRM-5002': { category: 'Pointage RH - Enregistrement API', key: 'error_5002', file: 'timesheet/index.js', line: 'auto' },
    'ReedCRM-5003': { category: 'Pointage RH - Erreur Réseau', key: 'error_5003', file: 'timesheet/index.js', line: 'auto' },
    'ReedCRM-5004': { category: 'Pointage RH - Projet Non Configuré', key: 'error_5004', file: 'timesheet/index.js', line: 'auto' },
    'ReedCRM-5005': { category: 'Pointage RH - Chargement Tâches', key: 'error_5005', file: 'timesheet/index.js', line: 'auto' },
    'ReedCRM-5006': { category: 'Assignation Commercial', key: 'error_5006', file: 'inline-edit/index.js', line: 'auto' },

    // ---- Défaut ----
    'ReedCRM-9999': { category: 'Erreur Inconnue', key: 'error_9999', file: 'Partout', line: 'auto' }
};

const ErrorManager = {
    getMessage(errorCode, fallbackString = "") {
        let msgKey = errorCode;
        
        // Si c'est un code du dictionnaire, on prend la clé associée
        if (ERROR_DICTIONARY[errorCode]) {
            msgKey = ERROR_DICTIONARY[errorCode].key;
        }

        // Tentative de récupération depuis chrome.i18n
        if (chrome && chrome.i18n) {
            const translatedMessage = chrome.i18n.getMessage(msgKey, fallbackString ? [fallbackString] : undefined);
            if (translatedMessage) {
                return translatedMessage;
            }
        }
        
        // Fallback si pas de traduction trouvée
        if (fallbackString) return `Erreur : ${fallbackString}`;
        return `Code d'erreur inconnu : ${errorCode}`;
    }
};

/**
 * Classe standardisée pour gérer toutes les erreurs de l'extension.
 */
class DoliError extends Error {
    constructor(code, originalError = null, context = {}) {
        const errorDef = ERROR_DICTIONARY[code] || ERROR_DICTIONARY['ReedCRM-9999'];
        
        // Récupération dynamique du message traduit
        const translatedMessage = ErrorManager.getMessage(code, context.substitution || "");
        super(translatedMessage);
        
        this.name = 'DoliError';
        this.code = code;
        this.category = errorDef.category;
        this.userMessage = translatedMessage;
        
        // Extraction des méta-données statiques du dictionnaire
        this.dictFile = errorDef.file || 'non défini';
        this.dictLine = errorDef.line || 'non défini';
        
        // Extraction du message technique si c'est un objet Error ou un texte brut (ex HTML d'erreur 500)
        if (originalError) {
            this.technicalMessage = (typeof originalError === 'object' && originalError.message) ? originalError.message : String(originalError);
        } else {
            this.technicalMessage = "Aucun détail technique fourni.";
        }
        
        this.context = context; 

        // Extraction du fichier et de la ligne depuis la Stack Trace
        this.callerInfo = "Origine inconnue";
        if (this.stack) {
            const stackLines = this.stack.split('\n');
            for (let i = 1; i < stackLines.length; i++) {
                // On cherche la première ligne de stack qui ne vient pas de 'errors.js'
                if (stackLines[i] && !stackLines[i].includes('errors.js')) {
                    // Regex pour extraire "nomfichier.js:Ligne" d'une URL chrome-extension://...
                    const match = stackLines[i].match(/\/([^\/]+\.js):(\d+):\d+/);
                    if (match) {
                        this.callerInfo = `${match[1]} - L${match[2]}`;
                    }
                    break;
                }
            }
        }
    }

    /**
     * Génère le bloc HTML standardisé pour afficher l'erreur à l'utilisateur.
     * @returns {string} Le code HTML de la boîte d'erreur
     */
    toHTML() {
        let detailsHtml = '';
        // Échapper l'HTML brut provenant du serveur pour éviter de casser l'affichage (XSS basique)
        const safeTechMessage = (this.technicalMessage || "Aucun message technique").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        detailsHtml = `
        <details class="doli-error-details">
            <summary>Voir les détails techniques</summary>
            <div style="margin-top: 8px; margin-bottom: 2px; font-weight: bold; font-size: 0.9em; color: #555;">📍 Dictionnaire : ${this.dictFile} / Ligne ${this.dictLine}</div>
            <div style="margin-bottom: 8px; font-size: 0.85em; color: #7f8c8d;">Trace exécution : ${this.callerInfo}</div>
            <pre>${safeTechMessage}</pre>
            ${this.context && Object.keys(this.context).length > 0 ? `<pre>Contexte: ${JSON.stringify(this.context, null, 2)}</pre>` : ''}
        </details>`;

        return `
        <div class="doli-error-box">
            <div class="doli-error-header">
                <strong>[${this.code}] ${this.category}</strong>
            </div>
            <div class="doli-error-body">
                ${this.userMessage}
            </div>
            ${detailsHtml}
        </div>`;
    }
}

// Fonction utilitaire pour faciliter l'affichage
function showDoliError(errorObject, domElement) {
    if (errorObject instanceof DoliError) {
        domElement.innerHTML = errorObject.toHTML();
    } else {
        // Fallback catch-all if a random Error is thrown instead of DoliError
        const fallback = new DoliError('ReedCRM-9999', errorObject);
        domElement.innerHTML = fallback.toHTML();
    }
}
