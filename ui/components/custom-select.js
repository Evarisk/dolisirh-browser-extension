export class CustomSelect {
    /**
     * @param {HTMLSelectElement} selectElement
     * @param {object} [options]
     * @param {function(string): Promise<void>} [options.onSearch] - Async callback appelé quand l'utilisateur tape.
     *        Reçoit la chaîne de recherche. Doit repeupler les options du <select>, puis le composant re-rend.
     */
    constructor(selectElement, options = {}) {
        this.selectElement = selectElement;
        this.container = selectElement.parentElement;
        this.onSearch = options.onSearch || null;
        this._searchDebounce = null;

        this.wrapper = null;
        this.trigger = null;
        this.optionsContainer = null;
        this.searchInput = null;
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
            this.wrapper.classList.toggle('open');
            this.trigger.classList.toggle('open');
            if (this.wrapper.classList.contains('open')) {
                this.searchInput.value = '';
                this.renderOptions();
                setTimeout(() => this.searchInput.focus(), 100);
            }
        });

        this.searchInput.addEventListener('input', (e) => {
            const query = e.target.value;

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
