import { MESSAGE_TYPES } from '../../src/utils/constants.js';
import { getDoliApiCandidates } from '../../src/utils/doli-url.js';
import { CustomSelect } from '../components/custom-select.js';
import { CustomMultiSelect } from '../components/custom-multiselect.js';

async function fetchDoli(url, options = {}) {
    return new Promise((resolve, reject) => {
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
        } catch (e) {}

        apiKey = options.headers?.DOLAPIKEY || options.headers?.['DOLAPIKEY'];
        const entity = options.headers?.DOLAPIENTITY || options.headers?.['DOLAPIENTITY'] || '';

        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.API_CALL,
            payload: { method, doliUrl, apiKey, entity, endpoint, body }
        }, response => {
            if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
            }
            if (response && response.error) {
                const statusMatch = String(response.error).match(/Erreur HTTP (\d+)/i);
                const parsedStatus = statusMatch ? parseInt(statusMatch[1], 10) : 500;
                return resolve({
                    ok: false,
                    status: parsedStatus,
                    statusText: response.error,
                    json: async () => { throw new Error(response.error); }
                });
            }
            resolve({
                ok: true,
                status: 200,
                json: async () => response.data
            });
        });
    });
}

async function testDolibarrConnection(apiUrl, login, passwordOrToken, entity) {
    try {
        let authSuccess = false;
        let apiTokenFinal = passwordOrToken;

        const baseHeaders = { 'Accept': 'application/json' };
        if (entity && entity.trim() !== '') {
            baseHeaders['DOLAPIENTITY'] = entity.trim();
        }

        const testKeyResponse = await fetchDoli(`${apiUrl}/status`, {
            headers: { ...baseHeaders, 'DOLAPIKEY': passwordOrToken }
        });
        if (testKeyResponse.ok) {
            try {
                const statusData = await testKeyResponse.json();
                if (statusData && statusData.success && (statusData.success.code === 200 || statusData.success.dolibarr_version)) {
                    authSuccess = true;
                }
            } catch (_) {}
        } else if (String(testKeyResponse.statusText || '').includes('API_DISABLED')) {
            return { success: false, apiDisabled: true, error: new DoliError('ReedCRM-1002') };
        }

        if (!authSuccess) {
            const loginResponse = await fetchDoli(`${apiUrl}/login?login=${encodeURIComponent(login)}&password=${encodeURIComponent(passwordOrToken)}`, {
                method: 'POST',
                headers: baseHeaders
            });
            if (loginResponse.ok) {
                const data = await loginResponse.json();
                apiTokenFinal = data && data.success ? data.success.token : null;
                authSuccess = Boolean(apiTokenFinal);
            } else if (String(loginResponse.statusText || '').includes('API_DISABLED')) {
                return { success: false, apiDisabled: true, error: new DoliError('ReedCRM-1002') };
            }
        }

        if (!authSuccess) {
            return { success: false, error: new DoliError('ReedCRM-1002') };
        }

        let canReadUsers = false;
        let canReadProjects = false;
        let hasDoliSirh = false;
        let doliSirhChecked = false;
        try {
            const usersResponse = await fetchDoli(`${apiUrl}/users?limit=1`, {
                method: 'GET',
                headers: { ...baseHeaders, 'DOLAPIKEY': apiTokenFinal }
            });
            if (usersResponse.ok || usersResponse.status === 404) {
                canReadUsers = true;
            }

            const projectsResponse = await fetchDoli(`${apiUrl}/projects?limit=100`, {
                method: 'GET',
                headers: { ...baseHeaders, 'DOLAPIKEY': apiTokenFinal }
            });
            if (projectsResponse.ok || projectsResponse.status === 404) {
                canReadProjects = true;
            }

            try {
                const modulesResponse = await fetchDoli(`${apiUrl}/setup/modules`, {
                    method: 'GET',
                    headers: { ...baseHeaders, 'DOLAPIKEY': apiTokenFinal }
                });
                if (modulesResponse.ok) {
                    const modulesList = await modulesResponse.json();
                    if (Array.isArray(modulesList)) {
                        doliSirhChecked = true;
                        hasDoliSirh = modulesList.some(m => String(m || '').toLowerCase().includes('dolisirh'));
                    }
                }
            } catch (_) {}

            if (!doliSirhChecked && projectsResponse.ok) {
                try {
                    const projList = await projectsResponse.json();
                    if (Array.isArray(projList)) {
                        hasDoliSirh = Boolean(findDefaultHrProject(projList));
                    }
                } catch (_) {}
            }
        } catch (err) {
            console.warn("Erreur lors de la vérification des droits API:", err);
        }

        let entityName = "Inconnue";
        try {
            const companyResponse = await fetchDoli(`${apiUrl}/setup/company`, {
                method: 'GET',
                headers: { ...baseHeaders, 'DOLAPIKEY': apiTokenFinal }
            });
            if (companyResponse.ok) {
                const companyData = await companyResponse.json();
                if (companyData.name) {
                    entityName = companyData.name;
                }
            }
        } catch (err) {
            console.warn("Erreur chargement nom entreprise:", err);
        }

        return {
            success: true,
            apiToken: apiTokenFinal,
            permissions: {
                users: canReadUsers,
                projects: canReadProjects,
                dolisirh: hasDoliSirh
            },
            entityName: entityName
        };
    } catch (e) {
        return { success: false, error: new DoliError('ReedCRM-1001', e) };
    }
}

const DOLISIRH_DOLISTORE_URL = 'https://www.dolistore.com/product.php?id=597&l=fr';
let profiles = [];

/**
 * Construit un élément d'avertissement DoliSIRH manquant avec lien vers le DoliStore.
 * @returns {HTMLDivElement}
 */
function createDoliSirhMissingBanner() {
    const warnLine = document.createElement('div');
    warnLine.className = 'dolisirh-missing-warn';
    warnLine.style.color = '#e67e22';
    warnLine.style.marginTop = '6px';
    warnLine.style.fontSize = '12px';

    const txt = document.createElement('span');
    txt.textContent = (chrome.i18n.getMessage('dolisirh_missing_msg') || "Le module API est d\u00e9sactiv\u00e9 ou DoliSIRH n'est pas pr\u00e9sent et/ou activ\u00e9. Vous pouvez l'acheter sur :") + ' ';

    const link = document.createElement('a');
    link.href = DOLISIRH_DOLISTORE_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = chrome.i18n.getMessage('dolisirh_dolistore_link_label') || 'Dolistore';
    link.style.color = '#d35400';
    link.style.fontWeight = '700';
    link.style.textDecoration = 'underline';

    warnLine.appendChild(txt);
    warnLine.appendChild(link);
    return warnLine;
}

/**
 * Met à jour la section "Pointage & Ressources Humaines" selon la présence/activation du module DoliSIRH :
 * - Affiche ou retire le rappel sous la description de la section (5)
 * - Grise et désactive les champs spécifiques à DoliSIRH (Projet RH, bouton API (4), Présences (3), Absences (2), Planning (1))
 * @param {boolean} isMissing
 */
function updateOptionsDoliSirhSectionState(isMissing) {
    const descSpan = document.querySelector('[data-i18n="opt_pointage_desc"]');
    const descP = descSpan ? descSpan.closest('p') : null;
    let banner = document.getElementById('opt-hr-dolisirh-warning');

    if (isMissing && descP && descP.parentElement) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'opt-hr-dolisirh-warning';
            banner.style.cssText = 'margin-bottom:14px;padding:8px 10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;font-size:12px;color:#9a3412;line-height:1.4;';
            const warnContent = createDoliSirhMissingBanner();
            warnContent.style.marginTop = '0';
            warnContent.style.color = '#9a3412';
            banner.appendChild(warnContent);
        }
        descP.insertAdjacentElement('afterend', banner);
    } else if (!isMissing && banner) {
        banner.remove();
    }

    const pSel = document.getElementById('doli-hr-project');
    const prSel = document.getElementById('doli-hr-presence-tasks');
    const abSel = document.getElementById('doli-hr-absence-tasks');
    const fetchBtn = document.getElementById('btn-fetch-hr-projects');
    const scheduleTable = document.getElementById('hr-schedule-table');

    if (pSel) {
        pSel.disabled = Boolean(isMissing);
        if (window.optionsHrProjectSelect) window.optionsHrProjectSelect.update();
        const lbl = document.querySelector('label[for="doli-hr-project"]');
        if (lbl) lbl.style.color = isMissing ? '#94a3b8' : '';
    }
    if (fetchBtn) {
        fetchBtn.classList.toggle('is-disabled-dolisirh', Boolean(isMissing));
        fetchBtn.disabled = Boolean(isMissing);
    }
    if (prSel) {
        prSel.disabled = Boolean(isMissing);
        if (window.optionsHrPresenceSelect) window.optionsHrPresenceSelect.update();
        const lbl = document.querySelector('label[for="doli-hr-presence-tasks"]');
        if (lbl) lbl.style.color = isMissing ? '#94a3b8' : '';
    }
    if (abSel) {
        abSel.disabled = Boolean(isMissing);
        if (window.optionsHrAbsenceSelect) window.optionsHrAbsenceSelect.update();
        const lbl = document.querySelector('label[for="doli-hr-absence-tasks"]');
        if (lbl) lbl.style.color = isMissing ? '#94a3b8' : '';
    }
    if (scheduleTable) {
        scheduleTable.classList.toggle('is-disabled', Boolean(isMissing));
        scheduleTable.querySelectorAll('.hr-schedule-input').forEach(inp => {
            inp.disabled = Boolean(isMissing);
        });
        const schedGroup = scheduleTable.closest('.form-group');
        const schedLbl = schedGroup ? schedGroup.querySelector('label') : null;
        if (schedLbl) schedLbl.style.color = isMissing ? '#94a3b8' : '';
    }
}
let activeProfileId = null;

function getActiveProfile() {
    return profiles.find(p => p.id === activeProfileId) || profiles[0];
}

function generateId() {
    return 'prof_' + Math.random().toString(36).substr(2, 9);
}

function loadProfileIntoForm(p) {
    if (!p) return;
    document.getElementById('doli-profile-name').value = p.name || '';
    document.getElementById('doli-url').value = p.doliUrl || '';
    document.getElementById('doli-login').value = p.doliLogin || '';
    document.getElementById('doli-password').value = p.doliApiToken || '';
    document.getElementById('doli-entity').value = p.doliEntity || '';

    if (p.doliStatus) {
        renderPermissions(p.doliStatus, p.doliUrl);
    } else {
        renderPermissions({ connection: 'pending', dolisirh: 'pending', users: 'pending', projects: 'pending' }, p.doliUrl);
    }

    const _pSel = document.getElementById('doli-hr-project');
    const _prSel = document.getElementById('doli-hr-presence-tasks');
    const _abSel = document.getElementById('doli-hr-absence-tasks');
    if (_pSel) { _pSel.innerHTML = '<option value="">-- Sélectionner un projet --</option>'; }
    if (_prSel) { _prSel.innerHTML = ''; }
    if (_abSel) { _abSel.innerHTML = ''; }
    const _pw = _pSel && _pSel.parentElement ? _pSel.parentElement.querySelector('.custom-select-wrapper') : null;
    if (_pw) { _pw.remove(); }
    if (_pSel) _pSel.classList.remove('hidden');
    const _prw = _prSel && _prSel.parentElement ? _prSel.parentElement.querySelector('.custom-multiselect-wrapper') : null;
    if (_prw) _prw.remove();
    const _abw = _abSel && _abSel.parentElement ? _abSel.parentElement.querySelector('.custom-multiselect-wrapper') : null;
    if (_abw) _abw.remove();
    window.optionsHrProjectSelect = null;
    window.optionsHrPresenceSelect = null;
    window.optionsHrAbsenceSelect = null;

    if (_pSel && p.doliHrProject) {
        _pSel.dataset.selectedValue = p.doliHrProject;
    }
    if (_prSel) {
        _prSel.dataset.selectedValues = JSON.stringify(p.doliHrPresenceTasks || []);
    }
    if (_abSel) {
        _abSel.dataset.selectedValues = JSON.stringify(p.doliHrAbsenceTasks || []);
    }

    if (_pSel) {
        window.optionsHrProjectSelect = new CustomSelect(_pSel);
    }
    if (_prSel) {
        window.optionsHrPresenceSelect = new CustomMultiSelect(_prSel);
    }
    if (_abSel) {
        window.optionsHrAbsenceSelect = new CustomMultiSelect(_abSel);
    }

    const defaultMode = p.doliDefaultMode || 'rh';
    const modeRadio = document.querySelector(`input[name="doli-default-mode"][value="${defaultMode}"]`);
    if (modeRadio) modeRadio.checked = true;

    const autoSpjCb = document.getElementById('doli-auto-create-spj');
    if (autoSpjCb) {
        autoSpjCb.checked = p.doliAutoCreateSpjTask !== undefined ? Boolean(p.doliAutoCreateSpjTask) : true;
    }
    const reqNoteCb = document.getElementById('doli-require-note');
    if (reqNoteCb) {
        reqNoteCb.checked = p.doliRequireNote !== undefined ? Boolean(p.doliRequireNote) : true;
    }

    function toHHMM(val) {
        if (typeof val === 'string' && /^\d{1,2}:\d{2}$/.test(val)) return val;
        const num = parseFloat(val) || 0;
        const h = Math.floor(num);
        const m = Math.round((num - h) * 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const weekendDefault = '00:00';
    const weekdayDefault = '07:00';
    const startDefault = '09:00';
    const schedule = p.doliHrSchedule || {};
    const startTime = p.doliHrStartTime || {};
    const days = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
    days.forEach(d => {
        const inp = document.getElementById(`hr-schedule-${d}`);
        if (inp) {
            const isWeekend = (d === 'sam' || d === 'dim');
            const raw = schedule[d];
            inp.value = raw !== undefined ? toHHMM(raw) : (isWeekend ? weekendDefault : weekdayDefault);
        }
        const startInp = document.getElementById(`hr-start-${d}`);
        if (startInp) {
            const isWeekend = (d === 'sam' || d === 'dim');
            const rawStart = startTime[d];
            startInp.value = rawStart !== undefined ? toHHMM(rawStart) : (isWeekend ? weekendDefault : startDefault);
        }
    });

    const isDoliSirhMissing = (p.doliStatus && p.doliStatus.dolisirh === 'ko')
        || (p.permissions && p.permissions.dolisirh === false);
    updateOptionsDoliSirhSectionState(Boolean(isDoliSirhMissing));
}

function renderProfileSelect() {
    const select = document.getElementById('doli-profile-select');
    select.innerHTML = '';
    profiles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name || 'Nouveau Profil';
        if (p.id === activeProfileId) opt.selected = true;
        select.appendChild(opt);
    });
}

function renderPermissions(statusObj, baseUrl) {
    const dashboard = document.getElementById('permissions-dashboard');
    if (!dashboard) return;

    const st = statusObj || {};
    const baseDoli = baseUrl ? baseUrl.replace(/\/api\/index\.php$/, '') : '';

    const categories = [
        {
            name: chrome.i18n.getMessage('opt_perm_dolisirh_cat') || "Module DoliSIRH",
            rights: [
                { id: 'SIRH', title: chrome.i18n.getMessage('opt_perm_dolisirh_title') || "Module DoliSIRH installé et activé", key: "dolisirh" }
            ]
        },
        {
            name: "Utilisateurs & Groupes",
            rights: [
                { id: '251', title: "Lire les utilisateurs, les groupes et leurs permissions", key: "users" }
            ]
        },
        {
            name: "Projets & Tâches (Pointage RH)",
            rights: [
                { id: '41', title: "Lire les projets et les tâches (partagés / contact)", key: "projects" },
                { id: '44', title: "Saisir le temps consommé sur les tâches", key: "projects" }
            ]
        },
        {
            name: "API / Web services",
            rights: [
                { id: 'API', title: "Connexion API REST", key: "connection" }
            ]
        }
    ];

    let html = '';
    categories.forEach(cat => {
        html += `<div class="perm-category"><h4 class="perm-category-title">${cat.name}</h4>`;
        cat.rights.forEach(right => {
            let status = st[right.key];
            let statusText = 'Non testé';
            let statusClass = 'pending';

            if (status === 'ok') { statusText = 'OK'; statusClass = 'ok'; }
            else if (status === 'ko') { statusText = 'KO'; statusClass = 'ko'; }
            else if (status === 'warning') { statusText = 'Test...'; statusClass = 'warning'; }

            let rightLink = "#";
            if (baseDoli && right.id === 'SIRH') {
                rightLink = `${baseDoli}/admin/modules.php?search_keyword=dolisirh`;
            } else if (baseDoli && right.id !== 'API') {
                rightLink = `${baseDoli}/user/group/perms.php?id=58&rights=${right.id}`;
            } else if (baseDoli && right.id === 'API') {
                rightLink = `${baseDoli}/admin/modules.php?search_keyword=api`;
            }

            html += `
            <div class="perm-row">
                <span class="perm-id">${right.id}</span>
                <span class="perm-title">${right.title}</span>
                <span class="perm-link"><a href="${rightLink}" target="_blank" title="Voir la configuration API">🔗 Voir</a></span>
                <span class="perm-status ${statusClass}">${statusText}</span>
            </div>`;
        });
        html += `</div>`;
    });

    if (st.date) {
        html += `<div style="padding: 8px 12px; font-size: 11px; color: #7f8c8d; text-align: right; background: #fff;">Dernier contrôle : ${st.date}</div>`;
    }

    dashboard.innerHTML = html;
    dashboard.classList.remove('hidden');
}

/**
 * Normalise un texte (minuscules, sans accents, entites HTML decodees) pour la detection RH par defaut.
 * @param {string} str
 * @returns {string}
 */
function normalizeHrText(str) {
    if (!str) return '';
    const doc = new DOMParser().parseFromString(String(str), 'text/html');
    const clean = doc.documentElement.textContent || String(str);
    return clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Determine si un projet Dolibarr est le projet Ressources Humaines par defaut de DoliSIRH.
 * @param {Object} proj
 * @returns {boolean}
 */
function isDefaultHrProject(proj) {
    if (!proj) return false;
    const title = normalizeHrText(proj.title || '');
    const desc = normalizeHrText(proj.description || '');
    return title.includes('ressources humaines') || title.includes('human resources') || title.includes('humanresources')
        || desc.includes('ressources humaines') || desc.includes('human resources');
}

/**
 * Recherche le meilleur projet RH par defaut : priorise la version "2.0.0" si elle existe,
 * sinon prend le projet "Ressources humaines" standard.
 * @param {Array<Object>} projectsList
 * @returns {Object|undefined}
 */
function findDefaultHrProject(projectsList) {
    if (!Array.isArray(projectsList)) return undefined;
    const hrProjects = projectsList.filter(isDefaultHrProject);
    const v200 = hrProjects.find(p => normalizeHrText(p.title || '').includes('2.0.0'));
    return v200 || hrProjects[0];
}

/**
 * Classe une tache du projet RH en 'presence' (WORK_TIME) ou 'absence' (NON_WORK_TIME) selon les libelles DoliSIRH.
 * @param {Object} task
 * @returns {'presence'|'absence'|null}
 */
function classifyDefaultHrTask(task) {
    if (!task) return null;
    const lbl = normalizeHrText(task.label || '');
    if (!lbl) return null;

    const absencePatterns = [
        'conges sans solde', 'holidays',
        'conges payes', 'paid holidays', 'paidholidays',
        'arret maladie', 'sick leave', 'sickleave', 'maladie',
        'jour ferie', 'jours feries', 'public holiday', 'publicholiday', 'ferie',
        'rtt',
        'recuperation', 'recovery',
        'repos compensateur', 'compensatory rest', 'compensatoryrest',
        'absence exceptionnelle', 'exceptional absence', 'exceptionalabsence',
        'conge', 'absence'
    ];
    if (absencePatterns.some(p => lbl === p || lbl.includes(p))) {
        return 'absence';
    }

    const presencePatterns = [
        'temps de travail effectif', 'travail effectif', 'effective work time', 'effectiveworktime',
        'formation professionnelle', 'professional training', 'professionaltraining',
        'deplacement professionnel', 'business travel', 'businesstravelmission', 'deplacement',
        'delegation cse', 'cse delegation', 'csedelegation',
        'reunion interne', 'internal meeting', 'internalmeeting', 'reunion',
        'formation interne', 'internal training', 'internaltraining',
        'formation externe', 'external training', 'externaltraining', 'formation',
        'auto-pointage', 'automatic time', 'automatictimespending',
        'divers', 'miscellaneous',
        'presence', 'teletravail'
    ];
    if (presencePatterns.some(p => lbl === p || lbl.includes(p))) {
        return 'presence';
    }

    return null;
}

/**
 * Retient, parmi les URLs candidates, la premiere qui repond comme une API Dolibarr.
 * Un 401 ou un 403 suffit : l'API est la, seule la cle est refusee (un mot de passe, par exemple).
 * @param {string} rawUrl - URL saisie dans le formulaire
 * @param {string} apiKey - Cle API ou mot de passe saisi
 * @returns {Promise<string>} URL se terminant par /api/index.php (la premiere candidate si aucune ne repond)
 */
async function resolveDoliApiUrl(rawUrl, apiKey) {
    const candidates = getDoliApiCandidates(rawUrl);
    if (candidates.length === 1) return candidates[0];
    for (const candidate of candidates) {
        try {
            const res = await fetchDoli(`${candidate}/status`, { headers: { 'DOLAPIKEY': apiKey || '' } });
            if (res.ok || res.status === 401 || res.status === 403 || String(res.statusText || '').includes('API_DISABLED')) {
                return candidate;
            }
        } catch (_) {}
    }
    return candidates[0];
}

async function loadHrData(profile, isManualClick = false) {
    const projectSelect = document.getElementById('doli-hr-project');
    const presenceSelect = document.getElementById('doli-hr-presence-tasks');
    const absenceSelect = document.getElementById('doli-hr-absence-tasks');
    const statusDiv = document.getElementById('hr-save-status');
    const btn = document.getElementById('btn-fetch-hr-projects');

    if (!profile) return;

    // Synchroniser avec les champs du formulaire si le profil n'a pas encore ete sauvegarde
    const formUrlRaw = document.getElementById('doli-url')?.value?.trim() || '';
    const formLogin = document.getElementById('doli-login')?.value?.trim() || '';
    const formPass = document.getElementById('doli-password')?.value?.trim() || '';
    const formEntity = document.getElementById('doli-entity')?.value?.trim() || '';

    if (formUrlRaw && !getDoliApiCandidates(formUrlRaw).includes(profile.doliUrl)) {
        profile.doliUrl = await resolveDoliApiUrl(formUrlRaw, formPass || profile.doliApiToken);
    }
    if (formLogin) {
        profile.doliLogin = formLogin;
    }
    if (formPass && !profile.doliApiToken) {
        profile.doliApiToken = formPass;
    }
    if (formEntity !== undefined) {
        profile.doliEntity = formEntity;
    }

    if (!profile.doliUrl || !profile.doliApiToken) {
        if (isManualClick && statusDiv) {
            statusDiv.style.color = '#e74c3c';
            statusDiv.textContent = chrome.i18n.getMessage('opt_js_135') || 'Veuillez renseigner l\'URL et les identifiants Dolibarr ci-dessus.';
        }
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.classList.add('is-loading');
    }
    if (isManualClick && statusDiv) {
        statusDiv.style.color = '#3498db';
        statusDiv.textContent = chrome.i18n.getMessage('popup_20') || 'Chargement...';
    }

    try {
        // Si le champ mot de passe contient un mot de passe (et non un token API valide), tenter une connexion pour obtenir le token
        let headers = { 'DOLAPIKEY': profile.doliApiToken, 'Accept': 'application/json' };
        if (profile.doliEntity) headers['DOLAPIENTITY'] = profile.doliEntity;

        let pRes = await fetchDoli(`${profile.doliUrl}/projects?sqlfilters=(t.fk_statut:=:1)&sortfield=t.rowid&sortorder=DESC&limit=10000`, { headers });

        if (!pRes.ok && profile.doliLogin && (formPass || profile.doliApiToken)) {
            const connRes = await testDolibarrConnection(profile.doliUrl, profile.doliLogin, formPass || profile.doliApiToken, profile.doliEntity || '');
            if (connRes.success && connRes.apiToken) {
                profile.doliApiToken = connRes.apiToken;
                const passInput = document.getElementById('doli-password');
                if (passInput) passInput.value = connRes.apiToken;
                chrome.storage.sync.set({ doliProfiles: profiles });
                headers = { 'DOLAPIKEY': profile.doliApiToken, 'Accept': 'application/json' };
                if (profile.doliEntity) headers['DOLAPIENTITY'] = profile.doliEntity;
                pRes = await fetchDoli(`${profile.doliUrl}/projects?sqlfilters=(t.fk_statut:=:1)&sortfield=t.rowid&sortorder=DESC&limit=10000`, { headers });
            }
        }

        // Fallback sans sqlfilters (ex: 404 si aucun projet au statut 1 ou filtre non supporte)
        if (!pRes.ok) {
            pRes = await fetchDoli(`${profile.doliUrl}/projects?sortfield=t.rowid&sortorder=DESC&limit=10000`, { headers });
        }

        let hasDoliSirh = false;
        let modChecked = false;
        try {
            const modRes = await fetchDoli(`${profile.doliUrl}/setup/modules`, { headers });
            if (modRes.ok) {
                const modList = await modRes.json();
                if (Array.isArray(modList)) {
                    modChecked = true;
                    hasDoliSirh = modList.some(m => String(m || '').toLowerCase().includes('dolisirh'));
                }
            }
        } catch (_) {}

        let defaultHrProj = null;
        let filteredProjectsCount = 0;

        if (pRes.ok) {
            let projects = [];
            try {
                const rawProjects = await pRes.json();
                if (Array.isArray(rawProjects)) projects = rawProjects;
            } catch (_) {}

            projectSelect.innerHTML = '<option value="">-- S\u00e9lectionner un projet --</option>';

            const targetEnt = profile.doliEntity ? String(profile.doliEntity).trim() : '';
            const openProjects = projects.filter(proj => String(proj.statut ?? proj.fk_statut ?? proj.status ?? '1') === '1');
            const baseList = openProjects.length > 0 ? openProjects : projects;
            let filteredProjects = targetEnt
                ? baseList.filter(proj => String(proj.entity || '1') === targetEnt)
                : baseList;
            if (filteredProjects.length === 0 && baseList.length > 0) {
                filteredProjects = baseList;
            }
            filteredProjectsCount = filteredProjects.length;

            defaultHrProj = findDefaultHrProject(filteredProjects);
            if (!modChecked) {
                hasDoliSirh = Boolean(defaultHrProj);
            }
            const savedProjId = String(profile.doliHrProject || projectSelect.dataset.selectedValue || '');
            const savedProj = filteredProjects.find(pr => String(pr.id) === savedProjId);
            const hasConfiguredTasks = (Array.isArray(profile.doliHrPresenceTasks) && profile.doliHrPresenceTasks.length > 0)
                || (Array.isArray(profile.doliHrAbsenceTasks) && profile.doliHrAbsenceTasks.length > 0);

            const defaultIs200 = defaultHrProj && normalizeHrText(defaultHrProj.title || '').includes('2.0.0');
            const savedIsOldHr = savedProj && isDefaultHrProject(savedProj) && !normalizeHrText(savedProj.title || '').includes('2.0.0');
            let targetProjectId = savedProj ? String(savedProj.id) : '';
            if (defaultHrProj && (!savedProj || (defaultIs200 && savedIsOldHr) || (!hasConfiguredTasks && !isDefaultHrProject(savedProj)))) {
                targetProjectId = String(defaultHrProj.id);
                projectSelect.dataset.selectedValue = targetProjectId;
                presenceSelect.dataset.selectedValues = '[]';
                absenceSelect.dataset.selectedValues = '[]';
            }

            filteredProjects.forEach(proj => {
                const opt = document.createElement('option');
                opt.value = proj.id;
                const doc = new DOMParser().parseFromString(`${proj.ref || ''} - ${proj.title || ''}`, 'text/html');
                opt.textContent = doc.documentElement.textContent || `${proj.ref} - ${proj.title}`;
                if (String(proj.id) === targetProjectId) {
                    opt.selected = true;
                }
                projectSelect.appendChild(opt);
            });

            if (targetProjectId) {
                projectSelect.value = targetProjectId;
            }

            if (!window.optionsHrProjectSelect) {
                window.optionsHrProjectSelect = new CustomSelect(projectSelect);
            } else {
                window.optionsHrProjectSelect.update();
            }

            if (projectSelect.value) {
                await loadHrTasks(profile, projectSelect.value, presenceSelect, absenceSelect);
            } else {
                if (!window.optionsHrPresenceSelect && presenceSelect) {
                    window.optionsHrPresenceSelect = new CustomMultiSelect(presenceSelect);
                } else if (window.optionsHrPresenceSelect) {
                    window.optionsHrPresenceSelect.update();
                }
                if (!window.optionsHrAbsenceSelect && absenceSelect) {
                    window.optionsHrAbsenceSelect = new CustomMultiSelect(absenceSelect);
                } else if (window.optionsHrAbsenceSelect) {
                    window.optionsHrAbsenceSelect.update();
                }
            }
        }

        const isApiDisabled = String(pRes.statusText || '').includes('API_DISABLED');
        if (isApiDisabled) {
            profile.permissions = { users: false, projects: false, dolisirh: false };
            profile.doliStatus = { connection: 'ko', dolisirh: 'ko', users: 'ko', projects: 'ko' };
            renderPermissions(profile.doliStatus, profile.doliUrl);
            updateOptionsDoliSirhSectionState(true);
            const testStatusDiv = document.getElementById('test-status-container');
            if (testStatusDiv && !testStatusDiv.querySelector('.dolisirh-missing-warn')) {
                testStatusDiv.appendChild(createDoliSirhMissingBanner());
            }
        } else if (modChecked || pRes.ok) {
            if (!profile.permissions) profile.permissions = {};
            profile.permissions.dolisirh = hasDoliSirh;
            if (!profile.doliStatus) {
                profile.doliStatus = { connection: 'ok', users: 'ok', projects: 'ok' };
            }
            profile.doliStatus.dolisirh = hasDoliSirh ? 'ok' : 'ko';
            renderPermissions(profile.doliStatus, profile.doliUrl);
            updateOptionsDoliSirhSectionState(!hasDoliSirh);

            if (!hasDoliSirh) {
                const testStatusDiv = document.getElementById('test-status-container');
                if (testStatusDiv && !testStatusDiv.querySelector('.dolisirh-missing-warn')) {
                    testStatusDiv.appendChild(createDoliSirhMissingBanner());
                }
            }
        }

        if (isManualClick && statusDiv) {
            if (!hasDoliSirh && (modChecked || pRes.ok)) {
                statusDiv.textContent = '';
                statusDiv.appendChild(createDoliSirhMissingBanner());
            } else if (pRes.ok) {
                statusDiv.style.color = '#22c55e';
                statusDiv.textContent = `\u2713 ${filteredProjectsCount} projet(s) charg\u00e9(s)`;
                setTimeout(() => { if (statusDiv) statusDiv.textContent = ''; }, 3000);
            } else {
                statusDiv.style.color = '#e74c3c';
                statusDiv.textContent = `\u2717 Impossible de charger les projets (${pRes.statusText || 'Erreur API'})`;
            }
        }
    } catch (e) {
        console.warn("Error fetching HR projects", e);
        if (isManualClick && statusDiv) {
            statusDiv.style.color = '#e74c3c';
            statusDiv.textContent = '\u2717 Erreur lors de la r\u00e9cup\u00e9ration des projets';
        }
    } finally {
        if (btn) {
            btn.classList.remove('is-loading');
            if (!btn.classList.contains('is-disabled-dolisirh')) {
                btn.disabled = false;
            }
        }
    }
}

async function loadHrTasks(profile, projectId, presenceSelect, absenceSelect) {
    if (!projectId) {
        presenceSelect.innerHTML = '';
        absenceSelect.innerHTML = '';
        if (window.optionsHrPresenceSelect) window.optionsHrPresenceSelect.update();
        if (window.optionsHrAbsenceSelect) window.optionsHrAbsenceSelect.update();
        return;
    }

    const headers = { 'DOLAPIKEY': profile.doliApiToken, 'Accept': 'application/json' };
    if (profile.doliEntity) headers['DOLAPIENTITY'] = profile.doliEntity;

    try {
        const tRes = await fetchDoli(`${profile.doliUrl}/tasks?sqlfilters=(t.fk_projet:=:${projectId})&limit=100`, { headers });
        if (tRes.ok) {
            const tasks = await tRes.json();

            let presenceSelected = [];
            let absenceSelected = [];
            try { presenceSelected = JSON.parse(presenceSelect.dataset.selectedValues || "[]").map(String); } catch (e) {}
            try { absenceSelected = JSON.parse(absenceSelect.dataset.selectedValues || "[]").map(String); } catch (e) {}

            presenceSelect.innerHTML = '';
            absenceSelect.innerHTML = '';

            if (Array.isArray(tasks)) {
                const taskIdsSet = new Set(tasks.map(t => String(t.id)));
                presenceSelected = presenceSelected.filter(id => taskIdsSet.has(String(id)));
                absenceSelected = absenceSelected.filter(id => taskIdsSet.has(String(id)));

                let autoFilledDefaults = false;
                if (presenceSelected.length === 0 && absenceSelected.length === 0) {
                    tasks.forEach(task => {
                        const kind = classifyDefaultHrTask(task);
                        if (kind === 'presence') presenceSelected.push(String(task.id));
                        else if (kind === 'absence') absenceSelected.push(String(task.id));
                    });
                    if (presenceSelected.length > 0 || absenceSelected.length > 0) {
                        autoFilledDefaults = true;
                        presenceSelect.dataset.selectedValues = JSON.stringify(presenceSelected);
                        absenceSelect.dataset.selectedValues = JSON.stringify(absenceSelected);
                    }
                }

                tasks.forEach(task => {
                    const doc = new DOMParser().parseFromString(task.label || '', 'text/html');
                    const cleanLabel = doc.documentElement.textContent || task.label || '';

                    const opt1 = document.createElement('option');
                    opt1.value = task.id;
                    opt1.textContent = `${task.ref} - ${cleanLabel}`;
                    if (presenceSelected.includes(String(task.id))) opt1.selected = true;
                    presenceSelect.appendChild(opt1);

                    const opt2 = document.createElement('option');
                    opt2.value = task.id;
                    opt2.textContent = `${task.ref} - ${cleanLabel}`;
                    if (absenceSelected.includes(String(task.id))) opt2.selected = true;
                    absenceSelect.appendChild(opt2);
                });

                if (autoFilledDefaults && profile) {
                    profile.doliHrProject = String(projectId);
                    profile.doliHrPresenceTasks = presenceSelected;
                    profile.doliHrAbsenceTasks = absenceSelected;
                    const projSelectEl = document.getElementById('doli-hr-project');
                    const selOpt = projSelectEl ? projSelectEl.options[projSelectEl.selectedIndex] : null;
                    if (selOpt && selOpt.text) {
                        const parts = selOpt.text.split(' - ');
                        profile.doliHrProjectRef = parts[0] || '';
                        profile.doliHrProjectTitle = parts.slice(1).join(' - ') || '';
                    }
                    chrome.storage.sync.set({ doliProfiles: profiles });
                }

                const updateExclusions = () => {
                    const presSelected = Array.from(presenceSelect.selectedOptions).map(opt => opt.value);
                    const absSelected = Array.from(absenceSelect.selectedOptions).map(opt => opt.value);

                    Array.from(presenceSelect.options).forEach(opt => {
                        opt.disabled = absSelected.includes(opt.value);
                    });
                    Array.from(absenceSelect.options).forEach(opt => {
                        opt.disabled = presSelected.includes(opt.value);
                    });

                    if (window.optionsHrPresenceSelect) window.optionsHrPresenceSelect.update();
                    if (window.optionsHrAbsenceSelect) window.optionsHrAbsenceSelect.update();
                };

                if (!presenceSelect.dataset.listenerAdded) {
                    presenceSelect.addEventListener('change', () => {
                        updateExclusions();
                        if (window.markHrDirty) window.markHrDirty();
                    });
                    absenceSelect.addEventListener('change', () => {
                        updateExclusions();
                        if (window.markHrDirty) window.markHrDirty();
                    });
                    presenceSelect.dataset.listenerAdded = 'true';
                }

                if (!window.optionsHrPresenceSelect) {
                    window.optionsHrPresenceSelect = new CustomMultiSelect(presenceSelect);
                }
                if (!window.optionsHrAbsenceSelect) {
                    window.optionsHrAbsenceSelect = new CustomMultiSelect(absenceSelect);
                }

                updateExclusions();
            }
        } else {
            presenceSelect.innerHTML = '';
            absenceSelect.innerHTML = '';
            if (window.optionsHrPresenceSelect) window.optionsHrPresenceSelect.update();
            if (window.optionsHrAbsenceSelect) window.optionsHrAbsenceSelect.update();
        }
    } catch (e) {
        console.error("Error fetching HR tasks", e);
    }
    if (window.markHrClean) window.markHrClean();
}

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(null, (items) => {
        profiles = items.doliProfiles || [];
        activeProfileId = items.doliActiveProfileId;

        if (profiles.length === 0) {
            const initialProfile = { id: generateId(), name: 'Profil 1' };
            profiles.push(initialProfile);
            activeProfileId = initialProfile.id;
            chrome.storage.sync.set({ doliProfiles: profiles, doliActiveProfileId: activeProfileId });
        }

        if (!activeProfileId || !profiles.find(p => p.id === activeProfileId)) {
            activeProfileId = profiles[0].id;
        }

        renderProfileSelect();
        loadProfileIntoForm(getActiveProfile());
    });

    document.getElementById('doli-profile-select').addEventListener('change', (e) => {
        activeProfileId = e.target.value;
        chrome.storage.sync.set({ doliActiveProfileId: activeProfileId });
        loadProfileIntoForm(getActiveProfile());
        setTimeout(() => {
            const newP = getActiveProfile();
            if (newP && newP.doliUrl && newP.doliApiToken) {
                loadHrData(newP);
            }
        }, 100);
    });

    document.getElementById('doli-profile-name').addEventListener('input', (e) => {
        const p = getActiveProfile();
        if (p) {
            p.name = e.target.value;
            const opt = document.querySelector(`#doli-profile-select option[value="${p.id}"]`);
            if (opt) opt.textContent = p.name || 'Sans nom';
            chrome.storage.sync.set({ doliProfiles: profiles });
        }
    });

    document.getElementById('btn-new-profile').addEventListener('click', () => {
        const newProfile = { id: generateId(), name: 'Nouveau Profil' };
        profiles.push(newProfile);
        activeProfileId = newProfile.id;
        chrome.storage.sync.set({ doliProfiles: profiles, doliActiveProfileId: activeProfileId });
        renderProfileSelect();
        loadProfileIntoForm(newProfile);
    });

    document.getElementById('btn-delete-profile').addEventListener('click', () => {
        if (confirm(chrome.i18n.getMessage("opt_js_confirm") || "Supprimer ce profil ?")) {
            profiles = profiles.filter(p => p.id !== activeProfileId);
            if (profiles.length === 0) {
                profiles.push({ id: generateId(), name: 'Profil 1' });
            }
            activeProfileId = profiles[0].id;
            chrome.storage.sync.set({ doliProfiles: profiles, doliActiveProfileId: activeProfileId });
            renderProfileSelect();
            loadProfileIntoForm(getActiveProfile());
        }
    });

    document.getElementById('btn-test-profile').addEventListener('click', async () => {
        const url = document.getElementById('doli-url').value;
        const login = document.getElementById('doli-login').value;
        const password = document.getElementById('doli-password').value;
        const entityVal = document.getElementById('doli-entity').value.trim();
        const testStatusDiv = document.getElementById('test-status-container');
        const btnTest = document.getElementById('btn-test-profile');
        const statusDashboard = document.getElementById('permissions-dashboard');

        if (!url || !login || !password) {
            testStatusDiv.style.color = "#e74c3c";
            testStatusDiv.textContent = chrome.i18n.getMessage('opt_js_135');
            return;
        }

        const candidates = getDoliApiCandidates(url);
        let normalizedUrl = candidates[0];

        btnTest.disabled = true;
        btnTest.textContent = chrome.i18n.getMessage('opt_js_136');
        testStatusDiv.textContent = "";

        statusDashboard.classList.remove('hidden');
        renderPermissions({ connection: 'warning', dolisirh: 'warning', users: 'warning', projects: 'warning' }, normalizedUrl);

        let testResult = { success: false };
        for (const candidate of candidates) {
            testResult = await testDolibarrConnection(candidate, login, password, entityVal);
            if (testResult.success || testResult.apiDisabled) {
                normalizedUrl = candidate;
                break;
            }
        }

        if (testResult.success) {
            testStatusDiv.textContent = '';
            let msg = '✅ Connexion réussie !';
            if (testResult.entityName && testResult.entityName !== "Inconnue") {
                msg += ` (🏢 ${testResult.entityName})`;
            }
            const mainLine = document.createElement('div');
            mainLine.style.color = '#27ae60';
            mainLine.textContent = msg;
            testStatusDiv.appendChild(mainLine);

            if (!testResult.permissions?.dolisirh) {
                testStatusDiv.appendChild(createDoliSirhMissingBanner());
            }

            const statusState = {
                connection: 'ok',
                dolisirh: testResult.permissions?.dolisirh ? 'ok' : 'ko',
                users: testResult.permissions?.users ? 'ok' : 'ko',
                projects: testResult.permissions?.projects ? 'ok' : 'ko',
                date: new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
            };
            renderPermissions(statusState, normalizedUrl);
            updateOptionsDoliSirhSectionState(!testResult.permissions?.dolisirh);

            const p = getActiveProfile();
            if (p) {
                p.doliUrl = normalizedUrl;
                p.doliLogin = login;
                p.doliEntity = entityVal;
                p.doliStatus = statusState;
                if (testResult.apiToken) {
                    p.doliApiToken = testResult.apiToken;
                    const passEl = document.getElementById('doli-password');
                    if (passEl) passEl.value = testResult.apiToken;
                }
                const urlEl = document.getElementById('doli-url');
                if (urlEl) urlEl.value = normalizedUrl;
                if (testResult.permissions) p.permissions = testResult.permissions;
                chrome.storage.sync.set({ doliProfiles: profiles });
                await loadHrData(p);
            }
        } else {
            testStatusDiv.style.color = "#e74c3c";
            testStatusDiv.textContent = testResult.apiDisabled
                ? (chrome.i18n.getMessage('opt_api_disabled_err') || '✗ Le module API/Web services est désactivé sur ce Dolibarr.')
                : chrome.i18n.getMessage('opt_js_137');
            const koState = {
                connection: 'ko',
                dolisirh: 'ko',
                users: 'ko',
                projects: 'ko',
                date: new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
            };
            renderPermissions(koState, normalizedUrl);
            updateOptionsDoliSirhSectionState(true);
            const p = getActiveProfile();
            if (p) {
                p.doliStatus = koState;
                p.permissions = { users: false, projects: false, dolisirh: false };
                chrome.storage.sync.set({ doliProfiles: profiles });
            }
        }

        btnTest.disabled = false;
        btnTest.textContent = chrome.i18n.getMessage('opt_js_138');
    });

    document.getElementById('save-btn').addEventListener('click', () => {
        const urlInput = document.getElementById('doli-url');
        let url = urlInput.value;
        const login = document.getElementById('doli-login').value;
        const password = document.getElementById('doli-password').value;
        const statusDiv = document.getElementById('status');
        const btn = document.getElementById('save-btn');

        if (!url || !login || !password) {
            statusDiv.style.color = "#e74c3c";
            statusDiv.textContent = chrome.i18n.getMessage('opt_js_143');
            return;
        }

        const candidates = getDoliApiCandidates(url);
        const normalizedUrl = candidates[0];
        urlInput.value = normalizedUrl;

        btn.disabled = true;
        btn.textContent = chrome.i18n.getMessage('opt_js_144');
        statusDiv.textContent = "";

        const entityVal = document.getElementById('doli-entity').value.trim();
        const p = getActiveProfile();
        if (!p) return;

        p.doliUrl = normalizedUrl;
        p.doliLogin = login;
        if (password && password.trim() !== '') {
            p.doliApiToken = password;
        }
        p.doliEntity = entityVal;
        p.doliHrProject = document.getElementById('doli-hr-project') ? document.getElementById('doli-hr-project').value : '';
        if (document.getElementById('doli-hr-presence-tasks')) {
            p.doliHrPresenceTasks = Array.from(document.getElementById('doli-hr-presence-tasks').selectedOptions).map(opt => opt.value);
        }
        if (document.getElementById('doli-hr-absence-tasks')) {
            p.doliHrAbsenceTasks = Array.from(document.getElementById('doli-hr-absence-tasks').selectedOptions).map(opt => opt.value);
        }
        const checkedMode = document.querySelector('input[name="doli-default-mode"]:checked');
        if (checkedMode) {
            p.doliDefaultMode = checkedMode.value;
        }
        const autoSpjCb = document.getElementById('doli-auto-create-spj');
        if (autoSpjCb) {
            p.doliAutoCreateSpjTask = autoSpjCb.checked;
        }
        const reqNoteCb = document.getElementById('doli-require-note');
        if (reqNoteCb) {
            p.doliRequireNote = reqNoteCb.checked;
        }

        const saveToStorage = () => {
            // Noms d'entites (absence de MultiCompany gardee 30 jours) et echec du logo relus a la
            // prochaine ouverture : un module ou un droit ajoute se voit tout de suite.
            try {
                chrome.storage.local.remove([`doliEntityNames_${p.id || p.doliUrl}`, `doliLogo_${p.id || 'default'}_failedAt`], () => void chrome.runtime.lastError);
            } catch (_) {}
            chrome.storage.sync.set({
                doliProfiles: profiles,
                doliActiveProfileId: activeProfileId
            }, () => {
                statusDiv.style.color = "#27ae60";
                statusDiv.textContent = chrome.i18n.getMessage('opt_js_145');
                setTimeout(() => { statusDiv.textContent = ''; }, 3000);
                btn.disabled = false;
                btn.textContent = chrome.i18n.getMessage('opt_js_146');
            });
        };

        // Une fois l'origine autorisee : avec ou sans /htdocs, garder l'URL ou l'API repond.
        const resolveAndSave = async () => {
            if (candidates.length > 1) {
                p.doliUrl = await resolveDoliApiUrl(url, p.doliApiToken);
                urlInput.value = p.doliUrl;
            }
            saveToStorage();
        };

        try {
            const urlObj = new URL(p.doliUrl || 'https://example.com');
            const originPattern = urlObj.origin + "/*";
            chrome.permissions.request({ origins: [originPattern] }, (granted) => {
                if (chrome.runtime.lastError) {
                    console.warn("Permission request info:", chrome.runtime.lastError.message);
                } else if (!granted) {
                    statusDiv.style.color = "#f39c12";
                    statusDiv.textContent = '⚠️ ' + chrome.i18n.getMessage("error_permission_denied");
                }
                resolveAndSave();
            });
        } catch (e) {
            resolveAndSave();
        }
    });

    const btnFetchHr = document.getElementById('btn-fetch-hr-projects');
    const projectSelect = document.getElementById('doli-hr-project');

    if (btnFetchHr) {
        btnFetchHr.addEventListener('click', () => {
            loadHrData(getActiveProfile(), true);
        });
    }

    if (projectSelect) {
        projectSelect.addEventListener('change', (e) => {
            window.markHrDirty();
            const p = getActiveProfile();
            const presenceSelect = document.getElementById('doli-hr-presence-tasks');
            const absenceSelect = document.getElementById('doli-hr-absence-tasks');
            if (presenceSelect) presenceSelect.dataset.selectedValues = "[]";
            if (absenceSelect) absenceSelect.dataset.selectedValues = "[]";
            loadHrTasks(p, e.target.value, presenceSelect, absenceSelect);
        });
    }

    window.markHrDirty = function markHrDirty() {
        const btn = document.getElementById('btn-save-hr');
        if (!btn) return;
        btn.disabled = false;
        btn.classList.remove('btn-save-hr-idle');
        btn.classList.add('btn-save-hr-dirty');
    };

    window.markHrClean = function markHrClean() {
        const btn = document.getElementById('btn-save-hr');
        if (!btn) return;
        btn.disabled = true;
        btn.classList.remove('btn-save-hr-dirty');
        btn.classList.add('btn-save-hr-idle');
    };

    ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].forEach(d => {
        const inp = document.getElementById(`hr-schedule-${d}`);
        const startInp = document.getElementById(`hr-start-${d}`);
        if (inp) inp.addEventListener('input', window.markHrDirty);
        if (startInp) startInp.addEventListener('input', window.markHrDirty);
    });

    document.getElementById('doli-hr-presence-tasks')?.addEventListener('change', window.markHrDirty);
    document.getElementById('doli-hr-absence-tasks')?.addEventListener('change', window.markHrDirty);
    document.querySelectorAll('input[name="doli-default-mode"]').forEach(r => r.addEventListener('change', window.markHrDirty));
    document.getElementById('doli-auto-create-spj')?.addEventListener('change', window.markHrDirty);
    document.getElementById('doli-require-note')?.addEventListener('change', window.markHrDirty);

    const btnSaveHr = document.getElementById('btn-save-hr');
    if (btnSaveHr) {
        btnSaveHr.addEventListener('click', () => {
            const p = getActiveProfile();
            if (!p) return;

            const statusDiv = document.getElementById('hr-save-status');
            const btnText = document.getElementById('btn-save-hr-text');

            const projectId = document.getElementById('doli-hr-project')?.value || '';
            const presenceEl = document.getElementById('doli-hr-presence-tasks');
            const absenceEl = document.getElementById('doli-hr-absence-tasks');
            const presenceTasks = presenceEl
                ? Array.from(presenceEl.selectedOptions).map(o => o.value)
                : (p.doliHrPresenceTasks || []);
            const absenceTasks = absenceEl
                ? Array.from(absenceEl.selectedOptions).map(o => o.value)
                : (p.doliHrAbsenceTasks || []);

            const days = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
            const schedule = {};
            const startTime = {};
            days.forEach(d => {
                const inp = document.getElementById(`hr-schedule-${d}`);
                const startInp = document.getElementById(`hr-start-${d}`);
                schedule[d] = inp ? (inp.value || '00:00') : '00:00';
                startTime[d] = startInp ? (startInp.value || '00:00') : '00:00';
            });

            const defaultMode = document.querySelector('input[name="doli-default-mode"]:checked')?.value || 'rh';
            const autoCreateSpj = document.getElementById('doli-auto-create-spj') ? document.getElementById('doli-auto-create-spj').checked : true;
            const requireNote = document.getElementById('doli-require-note') ? document.getElementById('doli-require-note').checked : true;
            p.doliHrProject = projectId;
            const projSelectEl = document.getElementById('doli-hr-project');
            const selOpt = projSelectEl ? projSelectEl.options[projSelectEl.selectedIndex] : null;
            if (selOpt && selOpt.text && projectId) {
                const parts = selOpt.text.split(' - ');
                p.doliHrProjectRef = parts[0] || '';
                p.doliHrProjectTitle = parts.slice(1).join(' - ') || '';
            }
            p.doliHrPresenceTasks = presenceTasks;
            p.doliHrAbsenceTasks = absenceTasks;
            p.doliHrSchedule = schedule;
            p.doliHrStartTime = startTime;
            p.doliDefaultMode = defaultMode;
            p.doliAutoCreateSpjTask = autoCreateSpj;
            p.doliRequireNote = requireNote;

            if (presenceEl) presenceEl.dataset.selectedValues = JSON.stringify(presenceTasks);
            if (absenceEl) absenceEl.dataset.selectedValues = JSON.stringify(absenceTasks);

            if (btnText) btnText.textContent = '…';
            btnSaveHr.disabled = true;

            chrome.storage.sync.get(['doliProfiles'], (items) => {
                if (chrome.runtime.lastError) {
                    if (statusDiv) { statusDiv.style.color = '#e74c3c'; statusDiv.textContent = '✗ Erreur de lecture'; }
                    btnSaveHr.disabled = false;
                    if (btnText) btnText.textContent = chrome.i18n.getMessage('opt_hr_save') || 'Enregistrer la configuration RH';
                    return;
                }
                let storedProfiles = items.doliProfiles || [];
                const idx = storedProfiles.findIndex(prof => prof.id === p.id);
                if (idx !== -1) {
                    storedProfiles[idx] = Object.assign(storedProfiles[idx], {
                        doliHrProject: projectId,
                        doliHrProjectRef: p.doliHrProjectRef || '',
                        doliHrProjectTitle: p.doliHrProjectTitle || '',
                        doliHrPresenceTasks: presenceTasks,
                        doliHrAbsenceTasks: absenceTasks,
                        doliHrSchedule: schedule,
                        doliHrStartTime: startTime,
                        doliDefaultMode: defaultMode,
                        doliAutoCreateSpjTask: autoCreateSpj,
                        doliRequireNote: requireNote
                    });
                }
                chrome.storage.sync.set({ doliProfiles: storedProfiles }, () => {
                    if (chrome.runtime.lastError) {
                        if (statusDiv) { statusDiv.style.color = '#e74c3c'; statusDiv.textContent = '✗ Erreur de sauvegarde'; }
                        btnSaveHr.disabled = false;
                        if (btnText) btnText.textContent = chrome.i18n.getMessage('opt_hr_save') || 'Enregistrer la configuration RH';
                    } else {
                        if (statusDiv) { statusDiv.style.color = '#22c55e'; statusDiv.textContent = '✓ Configuration RH enregistrée !'; }
                        setTimeout(() => { if (statusDiv) statusDiv.textContent = ''; }, 3000);
                        if (btnText) btnText.textContent = chrome.i18n.getMessage('opt_hr_save') || 'Enregistrer la configuration RH';
                        window.markHrClean();
                    }
                });
            });
        });
    }

    setTimeout(async () => {
        const p = getActiveProfile();
        if (p && p.doliUrl && p.doliApiToken) {
            await loadHrData(p);
        }
        window.markHrClean();
    }, 800);
});
