export class CustomSelect {
    /**
     * @param {HTMLSelectElement} selectElement
     * @param {object} [options]
     * @param {function(string): Promise<void>} [options.onSearch] - Async callback appelé quand l'utilisateur tape.
     *        Reçoit la chaîne de recherche. Doit repeupler les options du <select>, puis le composant re-rend.
     * @param {function(string): Promise<void>} [options.onCreate] - Async callback appelé au clic sur le bouton '+' quand un texte est saisi.
     * @param {string} [options.createButtonTitle] - Infobulle du bouton '+'.
     */
    constructor(selectElement, options = {}) {
        this.selectElement = selectElement;
        this.container = selectElement.parentElement;
        this.onSearch = options.onSearch || null;
        this.onCreate = options.onCreate || null;
        this.createButtonTitle = options.createButtonTitle || '';
        this._searchDebounce = null;

        this.wrapper = null;
        this.trigger = null;
        this.optionsContainer = null;
        this.searchInput = null;
        this.createBtn = null;
        this.optionsList = null;

        this.init();
    }

    init() {
        if (!this.container.classList.contains('searchable-select-container')) return;

        // Remove existing wrapper if re-initializing
        const existingWrapper = this.container.querySelector('.custom-select-wrapper');
        if (existingWrapper) {
            this.container.removeChild(existingWrapper);
        }

        this.selectElement.classList.add('hidden');

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'custom-select-wrapper';

        this.trigger = document.createElement('div');
        this.trigger.className = 'custom-select-trigger';
        if (this.selectElement.disabled) {
            this.wrapper.classList.add('disabled');
            this.trigger.classList.add('disabled');
        }

        const selectedOption = this.selectElement.options[this.selectElement.selectedIndex] || this.selectElement.options[0];
        let triggerText = selectedOption ? selectedOption.textContent : '-- Sélectionnez --';

        this.trigger.innerHTML = `<span>${triggerText}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

        this.optionsContainer = document.createElement('div');
        this.optionsContainer.className = 'custom-options-container';

        const searchBox = document.createElement('div');
        searchBox.className = 'custom-search-box';
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.id = 'search_' + this.selectElement.id;
        this.searchInput.name = 'search_' + this.selectElement.id;
        this.searchInput.placeholder = (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage)
            ? (chrome.i18n.getMessage('popup_jsph_134') || 'Rechercher...')
            : 'Rechercher...';
        searchBox.appendChild(this.searchInput);

        if (this.onCreate) {
            this.createBtn = document.createElement('button');
            this.createBtn.type = 'button';
            this.createBtn.className = 'custom-search-create-btn hidden';
            this.createBtn.title = this.createButtonTitle || 'Cr\u00e9er';

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '14');
            svg.setAttribute('height', '14');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2.5');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            l1.setAttribute('x1', '12'); l1.setAttribute('y1', '5');
            l1.setAttribute('x2', '12'); l1.setAttribute('y2', '19');
            const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            l2.setAttribute('x1', '5'); l2.setAttribute('y1', '12');
            l2.setAttribute('x2', '19'); l2.setAttribute('y2', '12');
            svg.appendChild(l1);
            svg.appendChild(l2);
            this.createBtn.appendChild(svg);
            searchBox.appendChild(this.createBtn);
        }

        this.optionsList = document.createElement('div');
        this.optionsList.className = 'custom-options';

        this.optionsContainer.appendChild(searchBox);
        this.optionsContainer.appendChild(this.optionsList);

        this.wrapper.appendChild(this.trigger);
        this.wrapper.appendChild(this.optionsContainer);
        this.container.appendChild(this.wrapper);

        this.renderOptions();
        this.bindEvents();
    }

    renderOptions(filter = '') {
        this.optionsList.innerHTML = '';
        const lowercaseFilter = filter.toLowerCase();
        let matchCount = 0;

        Array.from(this.selectElement.options).forEach((option, index) => {
            const text = option.textContent;
            const searchContext = (text + ' ' + (option.dataset.search || '')).toLowerCase();

            // En mode onSearch, on affiche tout (le filtre serveur a déjà été appliqué)
            // En mode local, on filtre ici
            if (!this.onSearch && !searchContext.includes(lowercaseFilter)) return;

            const customOption = document.createElement('div');
            customOption.className = 'custom-option';
            if (option.disabled) customOption.classList.add('disabled');
            if (option.selected) customOption.classList.add('selected');
            customOption.textContent = text;
            customOption.dataset.value = option.value;
            customOption.dataset.index = index;

            customOption.addEventListener('click', (e) => {
                if (option.disabled) return;
                e.stopPropagation();
                this.selectOption(option.value, customOption);
            });

            this.optionsList.appendChild(customOption);
            matchCount++;
        });

        if (matchCount === 0) {
            const noMatch = document.createElement('div');
            noMatch.className = 'custom-option disabled';
            noMatch.textContent = (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage)
                ? (chrome.i18n.getMessage('popup_js_110') || 'Aucun résultat')
                : 'Aucun résultat';
            this.optionsList.appendChild(noMatch);
        }
    }

    showLoading() {
        this.optionsList.innerHTML = '<div class="custom-option disabled" style="color:#94a3b8;font-style:italic;">Recherche en cours...</div>';
    }

    selectOption(value, optionElement) {
        this.selectElement.value = value;
        this.selectElement.dispatchEvent(new Event('change'));
        this.trigger.querySelector('span').textContent = optionElement.textContent;

        const allOptions = this.optionsList.querySelectorAll('.custom-option');
        allOptions.forEach(opt => opt.classList.remove('selected'));
        optionElement.classList.add('selected');

        this.close();
    }

    bindEvents() {
        this.trigger.addEventListener('click', () => {
            if (this.selectElement.disabled) return;
            this.wrapper.classList.toggle('open');
            this.trigger.classList.toggle('open');
            if (this.wrapper.classList.contains('open')) {
                this.searchInput.value = '';
                if (this.createBtn) this.createBtn.classList.add('hidden');
                this.renderOptions();
                setTimeout(() => this.searchInput.focus(), 100);
            }
        });

        this.searchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            const trimmed = query.trim();

            if (this.createBtn) {
                if (trimmed.length > 0) {
                    this.createBtn.classList.remove('hidden');
                    const baseTitle = this.createButtonTitle || 'Cr\u00e9er';
                    this.createBtn.title = `${baseTitle} "${trimmed}"`;
                } else {
                    this.createBtn.classList.add('hidden');
                }
            }

            if (this.onSearch) {
                // Mode recherche serveur : debounce 400ms
                clearTimeout(this._searchDebounce);
                if (query.length === 0) {
                    this.renderOptions();
                    return;
                }
                this.showLoading();
                this._searchDebounce = setTimeout(async () => {
                    try {
                        await this.onSearch(query);
                        // Après que le callback a repeuplé le <select>, on re-rend
                        this.renderOptions();
                    } catch(err) {
                        this.optionsList.innerHTML = '<div class="custom-option disabled" style="color:#e74c3c;">Erreur de recherche</div>';
                    }
                }, 400);
            } else {
                // Mode filtre local
                this.renderOptions(query);
            }
        });

        if (this.createBtn && this.onCreate) {
            this.createBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const trimmed = (this.searchInput.value || '').trim();
                if (!trimmed) return;
                this.createBtn.disabled = true;
                try {
                    await this.onCreate(trimmed);
                    this.close();
                } finally {
                    if (this.createBtn) this.createBtn.disabled = false;
                }
            });
        }

        document.addEventListener('click', (e) => {
            if (!this.wrapper.contains(e.target)) {
                this.close();
            }
        });
    }

    close() {
        this.wrapper.classList.remove('open');
        this.trigger.classList.remove('open');
    }

    update() {
        this.init();
    }
}
