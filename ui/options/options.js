import { MESSAGE_TYPES } from '../../src/utils/constants.js';
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

        const loginResponse = await fetchDoli(`${apiUrl}/login?login=${encodeURIComponent(login)}&password=${encodeURIComponent(passwordOrToken)}`, {
            method: 'POST',
            headers: baseHeaders
        });

        if (loginResponse.ok) {
            const data = await loginResponse.json();
            apiTokenFinal = data.success ? data.success.token : null;
            authSuccess = Boolean(apiTokenFinal);
        } else {
            const testKeyResponse = await fetchDoli(`${apiUrl}/status`, {
                headers: { ...baseHeaders, 'DOLAPIKEY': passwordOrToken }
            });
            if (testKeyResponse.ok) {
                authSuccess = true;
            }
        }

        if (!authSuccess) {
            return { success: false, error: new DoliError('ReedCRM-1002') };
        }

        let canReadUsers = false;
        let canReadProjects = false;
        try {
            const usersResponse = await fetchDoli(`${apiUrl}/users?limit=1`, {
                method: 'GET',
                headers: { ...baseHeaders, 'DOLAPIKEY': apiTokenFinal }
            });
            if (usersResponse.status !== 403 && usersResponse.status !== 401) {
                canReadUsers = true;
            }

            const projectsResponse = await fetchDoli(`${apiUrl}/projects?limit=1`, {
                method: 'GET',
                headers: { ...baseHeaders, 'DOLAPIKEY': apiTokenFinal }
            });
            if (projectsResponse.status !== 403 && projectsResponse.status !== 401) {
                canReadProjects = true;
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
                projects: canReadProjects
            },
            entityName: entityName
        };
    } catch (e) {
        return { success: false, error: new DoliError('ReedCRM-1001', e) };
    }
}

let profiles = [];
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
        renderPermissions({ connection: 'pending', users: 'pending', projects: 'pending' }, p.doliUrl);
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
            if (baseDoli && right.id !== 'API') {
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

async function loadHrData(profile) {
    const projectSelect = document.getElementById('doli-hr-project');
    const presenceSelect = document.getElementById('doli-hr-presence-tasks');
    const absenceSelect = document.getElementById('doli-hr-absence-tasks');

    if (!profile || !profile.doliUrl || !profile.doliApiToken) return;

    const headers = { 'DOLAPIKEY': profile.doliApiToken, 'Accept': 'application/json' };
    if (profile.doliEntity) headers['DOLAPIENTITY'] = profile.doliEntity;

    const btn = document.getElementById('btn-fetch-hr-projects');
    if (btn) btn.disabled = true;

    try {
        const pRes = await fetchDoli(`${profile.doliUrl}/projects?limit=10000&status=1`, { headers });
        if (pRes.ok) {
            const projects = await pRes.json();
            projectSelect.innerHTML = '<option value="">-- Sélectionner un projet --</option>';
            if (Array.isArray(projects)) {
                projects.forEach(proj => {
                    const opt = document.createElement('option');
                    opt.value = proj.id;
                    opt.textContent = `${proj.ref} - ${proj.title}`;
                    if (profile.doliHrProject == proj.id || projectSelect.dataset.selectedValue == proj.id) {
                        opt.selected = true;
                    }
                    projectSelect.appendChild(opt);
                });

                if (!window.optionsHrProjectSelect) {
                    window.optionsHrProjectSelect = new CustomSelect(projectSelect);
                } else {
                    window.optionsHrProjectSelect.update();
                }
            }

            if (projectSelect.value) {
                await loadHrTasks(profile, projectSelect.value, presenceSelect, absenceSelect);
            }
        }
    } catch (e) {
        console.error("Error fetching HR projects", e);
    }

    if (btn) btn.disabled = false;
}

async function loadHrTasks(profile, projectId, presenceSelect, absenceSelect) {
    if (!projectId) {
        presenceSelect.innerHTML = '';
        absenceSelect.innerHTML = '';
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
            try { presenceSelected = JSON.parse(presenceSelect.dataset.selectedValues || "[]"); } catch (e) {}
            try { absenceSelected = JSON.parse(absenceSelect.dataset.selectedValues || "[]"); } catch (e) {}

            presenceSelect.innerHTML = '';
            absenceSelect.innerHTML = '';

            if (Array.isArray(tasks)) {
                tasks.forEach(task => {
                    const opt1 = document.createElement('option');
                    opt1.value = task.id;
                    opt1.textContent = `${task.ref} - ${task.label}`;
                    if (presenceSelected.includes(String(task.id))) opt1.selected = true;
                    presenceSelect.appendChild(opt1);

                    const opt2 = document.createElement('option');
                    opt2.value = task.id;
                    opt2.textContent = `${task.ref} - ${task.label}`;
                    if (absenceSelected.includes(String(task.id))) opt2.selected = true;
                    absenceSelect.appendChild(opt2);
                });

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

        let normalizedUrl = url.trim().replace(/\/+$/, '');
        if (!normalizedUrl.endsWith('/api/index.php')) {
            if (normalizedUrl.endsWith('/htdocs')) normalizedUrl += '/api/index.php';
            else if (!normalizedUrl.includes('/api/index.php')) normalizedUrl += '/htdocs/api/index.php';
        }

        btnTest.disabled = true;
        btnTest.textContent = chrome.i18n.getMessage('opt_js_136');
        testStatusDiv.textContent = "";

        statusDashboard.classList.remove('hidden');
        renderPermissions({ connection: 'warning', users: 'warning', projects: 'warning' }, normalizedUrl);

        const testResult = await testDolibarrConnection(normalizedUrl, login, password, entityVal);

        if (testResult.success) {
            testStatusDiv.style.color = "#27ae60";
            let msg = '✅ Connexion réussie !';
            if (testResult.entityName && testResult.entityName !== "Inconnue") {
                msg += ` (🏢 ${testResult.entityName})`;
            }
            testStatusDiv.textContent = msg;

            renderPermissions({
                connection: 'ok',
                users: testResult.permissions?.users ? 'ok' : 'ko',
                projects: testResult.permissions?.projects ? 'ok' : 'ko',
                date: new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
            }, normalizedUrl);

            const p = getActiveProfile();
            if (p) {
                if (testResult.apiToken) p.doliApiToken = testResult.apiToken;
                if (testResult.permissions) p.permissions = testResult.permissions;
                chrome.storage.sync.set({ doliProfiles: profiles });
            }
        } else {
            testStatusDiv.style.color = "#e74c3c";
            testStatusDiv.textContent = chrome.i18n.getMessage('opt_js_137');
            renderPermissions({ connection: 'ko', users: 'pending', projects: 'pending' }, normalizedUrl);
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

        let normalizedUrl = url.trim().replace(/\/+$/, '');
        if (!normalizedUrl.endsWith('/api/index.php')) {
            if (normalizedUrl.endsWith('/htdocs')) normalizedUrl += '/api/index.php';
            else if (!normalizedUrl.includes('/api/index.php')) normalizedUrl += '/htdocs/api/index.php';
            urlInput.value = normalizedUrl;
        }

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

        const saveToStorage = () => {
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

        try {
            const urlObj = new URL(p.doliUrl || 'https://example.com');
            const originPattern = urlObj.origin + "/*";
            chrome.permissions.request({ origins: [originPattern] }, (granted) => {
                if (!granted) {
                    statusDiv.style.color = "#f39c12";
                    statusDiv.textContent = '⚠️ ' + chrome.i18n.getMessage("error_permission_denied");
                }
                saveToStorage();
            });
        } catch (e) {
            saveToStorage();
        }
    });

    const btnFetchHr = document.getElementById('btn-fetch-hr-projects');
    const projectSelect = document.getElementById('doli-hr-project');

    if (btnFetchHr) {
        btnFetchHr.addEventListener('click', () => {
            loadHrData(getActiveProfile());
        });
    }

    if (projectSelect) {
        projectSelect.addEventListener('change', (e) => {
            window.markHrDirty();
            const p = getActiveProfile();
            const presenceSelect = document.getElementById('doli-hr-presence-tasks');
            const absenceSelect = document.getElementById('doli-hr-absence-tasks');
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

            p.doliHrProject = projectId;
            p.doliHrPresenceTasks = presenceTasks;
            p.doliHrAbsenceTasks = absenceTasks;
            p.doliHrSchedule = schedule;
            p.doliHrStartTime = startTime;

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
                        doliHrPresenceTasks: presenceTasks,
                        doliHrAbsenceTasks: absenceTasks,
                        doliHrSchedule: schedule,
                        doliHrStartTime: startTime
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
