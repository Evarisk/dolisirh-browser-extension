/**
 * Utilitaire de localisation (I18n)
 * Parcours le DOM et remplace les attributs data-i18n* par les traductions correspondantes.
 */
function localizeHtmlPage() {
    // Remplacement des contenus HTML (textContent/innerHTML)
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            // Si c'est un tag injecté par le script d'extraction, 
            // on remplace le contenu du parent de manière sécurisée ou direct l'élément.
            el.innerHTML = message;
        }
    });

    // Remplacement des placeholders
    const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    placeholders.forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            el.placeholder = message;
        }
    });

    // Remplacement des titles
    const titles = document.querySelectorAll('[data-i18n-title]');
    titles.forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            el.title = message;
        }
    });
}

document.addEventListener('DOMContentLoaded', localizeHtmlPage);
