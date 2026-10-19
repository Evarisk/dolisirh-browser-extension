export class CustomMultiSelect {
    constructor(selectElement, options = {}) {
        this.selectElement = selectElement;
        this.container = selectElement.parentElement;
        this.onChangeCallback = options.onChange || null;
        
        this.wrapper = null;
        this.tagsContainer = null;
        this.searchInput = null;
        this.optionsContainer = null;
        this.optionsList = null;

        this.init();
    }

    init() {
        if (!this.container.classList.contains('searchable-multiselect-container')) return;

        // Remove existing wrapper if re-initializing
        const existingWrapper = this.container.querySelector('.custom-multiselect-wrapper');
        if (existingWrapper) {
            this.container.removeChild(existingWrapper);
        }

        this.selectElement.classList.add('hidden'); // Ensure original select is hidden

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'custom-multiselect-wrapper';

        this.tagsContainer = document.createElement('div');
        this.tagsContainer.className = 'custom-multiselect-tags';
        
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.className = 'custom-multiselect-input';
        this.searchInput.placeholder = this.selectElement.dataset.placeholder || 'Sélectionner...';
        
        this.tagsContainer.appendChild(this.searchInput);

        this.optionsContainer = document.createElement('div');
        this.optionsContainer.className = 'custom-options-container';

        this.optionsList = document.createElement('div');
        this.optionsList.className = 'custom-options';

        this.optionsContainer.appendChild(this.optionsList);

        this.wrapper.appendChild(this.tagsContainer);
        this.wrapper.appendChild(this.optionsContainer);
        this.container.appendChild(this.wrapper);

        this.renderTags();
        this.renderOptions();
        this.bindEvents();
    }

    renderTags() {
        // Remove existing tags
        const existingTags = this.tagsContainer.querySelectorAll('.custom-tag');
        existingTags.forEach(tag => tag.remove());

        // Create tag for each selected option
        Array.from(this.selectElement.options).forEach(option => {
            if (option.selected) {
                const tag = document.createElement('span');
                tag.className = 'custom-tag';
                tag.innerHTML = `
                    <span class="tag-text">${option.textContent}</span>
                    <span class="tag-remove" data-value="${option.value}">&times;</span>
                `;
                this.tagsContainer.insertBefore(tag, this.searchInput);
                
                tag.querySelector('.tag-remove').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.unselectOption(option.value);
                });
            }
        });
        
        // Hide placeholder if there are tags
        const selectedCount = Array.from(this.selectElement.selectedOptions).length;
        if (selectedCount > 0) {
            this.searchInput.placeholder = '';
        } else {
            this.searchInput.placeholder = this.selectElement.dataset.placeholder || 'Sélectionner...';
        }
    }

    renderOptions(filter = '') {
        this.optionsList.innerHTML = '';
        const lowercaseFilter = filter.toLowerCase();
        let matchCount = 0;

        Array.from(this.selectElement.options).forEach((option) => {
            if (option.selected) return; // Don't show already selected options

            const text = option.textContent;
            const searchContext = text.toLowerCase();
            if (searchContext.includes(lowercaseFilter)) {
                const customOption = document.createElement('div');
                customOption.className = 'custom-option';
                if (option.disabled) customOption.classList.add('disabled');
                
                customOption.textContent = text;
                customOption.dataset.value = option.value;

                customOption.addEventListener('click', (e) => {
                    if (option.disabled) return;
                    e.stopPropagation();
                    this.selectOption(option.value);
                });

                this.optionsList.appendChild(customOption);
                matchCount++;
            }
        });

        if (matchCount === 0) {
            const noMatch = document.createElement('div');
            noMatch.className = 'custom-option disabled';
            noMatch.textContent = 'Aucun résultat';
            this.optionsList.appendChild(noMatch);
        }
    }

    selectOption(value) {
        const option = Array.from(this.selectElement.options).find(opt => opt.value === value);
        if (option) {
            option.selected = true;
            this.searchInput.value = '';
            this.renderTags();
            this.renderOptions();
            this.triggerChange();
            this.searchInput.focus();
        }
    }

    unselectOption(value) {
        const option = Array.from(this.selectElement.options).find(opt => opt.value === value);
        if (option) {
            option.selected = false;
            this.renderTags();
            this.renderOptions(this.searchInput.value);
            this.triggerChange();
        }
    }

    triggerChange() {
        this.selectElement.dispatchEvent(new Event('change'));
        if (this.onChangeCallback) {
            this.onChangeCallback();
        }
    }

    bindEvents() {
        this.tagsContainer.addEventListener('click', () => {
            this.searchInput.focus();
        });

        this.searchInput.addEventListener('focus', () => {
            this.wrapper.classList.add('open');
            this.renderOptions(this.searchInput.value);
        });

        this.searchInput.addEventListener('input', (e) => {
            this.wrapper.classList.add('open');
            this.renderOptions(e.target.value);
        });
        
        // Handle backspace to delete last tag
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && this.searchInput.value === '') {
                const selectedOptions = Array.from(this.selectElement.selectedOptions);
                if (selectedOptions.length > 0) {
                    const lastSelected = selectedOptions[selectedOptions.length - 1];
                    this.unselectOption(lastSelected.value);
                }
            }
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.wrapper.contains(e.target)) {
                this.close();
            }
        });
    }

    close() {
        this.wrapper.classList.remove('open');
        this.searchInput.value = '';
        this.renderOptions(); // Reset list for next open
    }

    update() {
        this.init();
    }
}
