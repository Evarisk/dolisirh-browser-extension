import { fetchDoli } from './src/api/dolibarr.js';
import { initTimesheet } from './src/features/timesheet/index.js';

/**
 * Génère les URLs API candidates à partir de l'URL saisie par l'utilisateur.
 * @param {string} rawUrl - URL brute saisie par l'utilisateur
 * @returns {string[]} Liste d'URLs normalisées se terminant par /api/index.php
 */
function getDoliApiCandidates(rawUrl) {
    let cleaned = rawUrl.trim();
    if (!/^https?:\/\//i.test(cleaned)) {
        cleaned = 'https://' + cleaned;
    }
    cleaned = cleaned.replace(/\/+$/, '');
    if (cleaned.endsWith('/api/index.php')) {
        return [cleaned];
    }
    if (cleaned.includes('/api/index.php/')) {
        return [cleaned.split('/api/index.php/')[0] + '/api/index.php'];
    }
    if (cleaned.endsWith('/htdocs')) {
        return [cleaned + '/api/index.php'];
    }
    return [
        cleaned + '/api/index.php',
        cleaned + '/htdocs/api/index.php'
    ];
}

/**
 * Teste la connexion à l'API Dolibarr et récupère le token ainsi que les permissions de base.
 * @param {string} apiUrl - URL de l'API Dolibarr (avec /api/index.php)
 * @param {string} login - Identifiant Dolibarr
 * @param {string} passwordOrToken - Mot de passe ou clé API Dolibarr
 * @returns {Promise<{success: boolean, apiUrl?: string, apiToken?: string, permissions?: Object, entityName?: string}>}
 */
async function testOnboardingConnection(apiUrl, login, passwordOrToken) {
    try {
        const baseHeaders = { 'Accept': 'application/json' };
        let authSuccess = false;
        let apiTokenFinal = passwordOrToken;

        const loginResponse = await fetchDoli(
            `${apiUrl}/login?login=${encodeURIComponent(login)}&password=${encodeURIComponent(passwordOrToken)}`,
            { method: 'POST', headers: baseHeaders }
        );

        if (loginResponse.ok) {
            const data = await loginResponse.json();
            if (data && data.success && data.success.token) {
                apiTokenFinal = data.success.token;
                authSuccess = true;
            }
        }

        if (!authSuccess) {
            const testKeyResponse = await fetchDoli(`${apiUrl}/status`, {
                method: 'GET',
                headers: { ...baseHeaders, 'DOLAPIKEY': passwordOrToken }
            });
            if (testKeyResponse.ok) {
                authSuccess = true;
            }
        }

        if (!authSuccess) {
            return { success: false };
        }

        const authHeaders = { ...baseHeaders, 'DOLAPIKEY': apiTokenFinal };
        let canReadUsers = false;
        let canReadProjects = false;

        try {
            const [uRes, pRes] = await Promise.all([
                fetchDoli(`${apiUrl}/users?limit=1`, { method: 'GET', headers: authHeaders }),
                fetchDoli(`${apiUrl}/projects?limit=1`, { method: 'GET', headers: authHeaders })
            ]);
            canReadUsers = uRes.status !== 403 && uRes.status !== 401;
            canReadProjects = pRes.status !== 403 && pRes.status !== 401;
        } catch (permErr) {
            console.warn('Erreur lors de la vérification des droits API:', permErr);
        }

        let entityName = '';
        try {
            const compRes = await fetchDoli(`${apiUrl}/setup/company`, { method: 'GET', headers: authHeaders });
            if (compRes.ok) {
                const compData = await compRes.json();
                if (compData && compData.name) {
                    entityName = String(compData.name).trim();
                }
            }
        } catch (compErr) {
            console.warn('Erreur lecture société:', compErr);
        }

        return {
            success: true,
            apiUrl,
            apiToken: apiTokenFinal,
            permissions: {
                users: canReadUsers,
                projects: canReadProjects
            },
            entityName
        };
    } catch (err) {
        console.error('Erreur testOnboardingConnection:', err);
        return { success: false };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const setupWarning = document.getElementById('setup-warning');
        const viewTimesheet = document.getElementById('view-timesheet');
        const btnOpenOptions = document.getElementById('btn-open-options');
        const btnTopOptions = document.getElementById('btn-top-options');
        const topNav = document.querySelector('.top-nav');

        if (btnOpenOptions) {
            btnOpenOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
        }
        if (btnTopOptions) {
            btnTopOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
        }

        /**
         * Initialise la vue de première connexion (Onboarding) dans le popup.
         * @param {Array<Object>} existingProfiles - Liste des profils existants
         * @param {Object|undefined} currentProfile - Profil courant éventuel
         */
        function initOnboardingView(existingProfiles, currentProfile) {
            const onboardingForm = document.getElementById('onboarding-form');
            const urlInput = document.getElementById('onboarding-doli-url');
            const loginInput = document.getElementById('onboarding-doli-login');
            const passwordInput = document.getElementById('onboarding-doli-password');
            const statusBox = document.getElementById('onboarding-status');
            const btnConnect = document.getElementById('btn-onboarding-connect');
            const openDoliLink = document.getElementById('onboarding-open-doli-link');

            if (!onboardingForm || !urlInput || !loginInput || !passwordInput) return;

            if (currentProfile) {
                if (currentProfile.doliUrl) urlInput.value = currentProfile.doliUrl;
                if (currentProfile.doliLogin) loginInput.value = currentProfile.doliLogin;
            }

            const getSafeDoliWebUrl = () => {
                const raw = urlInput.value.trim();
                if (!raw) return null;
                try {
                    const candidate = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
                    const parsed = new URL(candidate);
                    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
                    parsed.pathname = parsed.pathname.replace(/\/api\/index\.php\/?$/i, '');
                    return parsed.href;
                } catch (e) {
                    return null;
                }
            };

            const updateDoliShortcut = () => {
                if (!openDoliLink) return;
                if (getSafeDoliWebUrl()) {
                    openDoliLink.classList.remove('hidden');
                } else {
                    openDoliLink.classList.add('hidden');
                }
            };

            if (openDoliLink) {
                openDoliLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    const safeUrl = getSafeDoliWebUrl();
                    if (safeUrl) {
                        chrome.tabs.create({ url: safeUrl });
                    }
                });
            }

            urlInput.addEventListener('input', updateDoliShortcut);
            updateDoliShortcut();

            const showStatus = (text, type) => {
                if (!statusBox) return;
                statusBox.textContent = text;
                statusBox.className = `onboarding-status status-${type}`;
            };

            onboardingForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                try {
                    const rawUrl = urlInput.value.trim();
                    const login = loginInput.value.trim();
                    const password = passwordInput.value.trim();

                    if (!rawUrl || !login || !password) {
                        showStatus(chrome.i18n.getMessage('opt_js_135'), 'error');
                        return;
                    }

                    const candidates = getDoliApiCandidates(rawUrl);
                    let originPattern = '';
                    try {
                        const urlObj = new URL(candidates[0]);
                        originPattern = urlObj.origin + '/*';
                    } catch (urlErr) {
                        showStatus(chrome.i18n.getMessage('opt_js_137'), 'error');
                        return;
                    }

                    btnConnect.disabled = true;
                    btnConnect.classList.add('btn-loading');
                    showStatus(chrome.i18n.getMessage('opt_js_136'), 'info');

                    await new Promise((resolve) => {
                        try {
                            chrome.permissions.request({ origins: [originPattern] }, (granted) => {
                                if (chrome.runtime.lastError) {
                                    console.warn('Permission error:', chrome.runtime.lastError.message);
                                }
                                if (!granted) {
                                    showStatus(chrome.i18n.getMessage('error_permission_denied'), 'error');
                                }
                                resolve(granted);
                            });
                        } catch (permEx) {
                            resolve(false);
                        }
                    });

                    let result = { success: false };
                    for (const candidateUrl of candidates) {
                        result = await testOnboardingConnection(candidateUrl, login, password);
                        if (result.success) break;
                    }

                    if (!result.success) {
                        showStatus(chrome.i18n.getMessage('opt_js_137'), 'error');
                        btnConnect.disabled = false;
                        btnConnect.classList.remove('btn-loading');
                        return;
                    }

                    const hostname = new URL(result.apiUrl).hostname;
                    const profileName = result.entityName || hostname || 'Profil 1';
                    const statusObj = {
                        connection: 'ok',
                        users: result.permissions.users ? 'ok' : 'ko',
                        projects: result.permissions.projects ? 'ok' : 'ko',
                        date: new Date().toLocaleString()
                    };

                    const targetProfile = currentProfile || {
                        id: 'prof_' + Math.random().toString(36).substring(2, 11)
                    };
                    targetProfile.name = profileName;
                    targetProfile.doliUrl = result.apiUrl;
                    targetProfile.doliLogin = login;
                    targetProfile.doliApiToken = result.apiToken;
                    targetProfile.permissions = result.permissions;
                    targetProfile.doliStatus = statusObj;

                    const updatedProfiles = existingProfiles.length > 0
                        ? existingProfiles.map(pr => pr.id === targetProfile.id ? targetProfile : pr)
                        : [targetProfile];

                    await new Promise((resolve) => {
                        chrome.storage.sync.set({
                            doliProfiles: updatedProfiles,
                            doliActiveProfileId: targetProfile.id
                        }, () => {
                            if (chrome.runtime.lastError) {
                                console.error('Storage sync error:', chrome.runtime.lastError.message);
                            }
                            resolve();
                        });
                    });

                    showStatus(chrome.i18n.getMessage('opt_js_145'), 'success');
                    setTimeout(() => {
                        window.location.reload();
                    }, 450);
                } catch (submitErr) {
                    console.error('Erreur onboarding submit:', submitErr);
                    showStatus(chrome.i18n.getMessage('opt_js_137'), 'error');
                    btnConnect.disabled = false;
                    btnConnect.classList.remove('btn-loading');
                }
            });
        }

        chrome.storage.sync.get(['doliProfiles', 'doliActiveProfileId'], (items) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                return;
            }
            const profiles = items.doliProfiles || [];
            const activeId = items.doliActiveProfileId;
            let p = profiles.find(prof => prof.id === activeId);

            if (!p && profiles.length > 0) {
                p = profiles[0];
                chrome.storage.sync.set({ doliActiveProfileId: p.id });
            }

            const profileSwitcher = document.getElementById('doli-active-profile');
            if (profiles.length > 1 && profileSwitcher) {
                profileSwitcher.classList.remove('hidden');
                profileSwitcher.innerHTML = '';
                profiles.forEach(prof => {
                    const opt = document.createElement('option');
                    opt.value = prof.id;
                    opt.textContent = prof.name || 'Profil';
                    if (prof.id === p?.id) opt.selected = true;
                    profileSwitcher.appendChild(opt);
                });
                profileSwitcher.addEventListener('change', (e) => {
                    chrome.storage.sync.set({ doliActiveProfileId: e.target.value }, () => {
                        window.location.reload();
                    });
                });
            }

            if (p && p.doliUrl && p.doliApiToken) {
                if (topNav) topNav.classList.remove('hidden');
                if (setupWarning) setupWarning.classList.add('hidden');
                if (viewTimesheet) viewTimesheet.classList.remove('hidden');
                initTimesheet(p.doliUrl, p.doliApiToken, p.doliEntity, p);
            } else {
                if (topNav) topNav.classList.add('hidden');
                if (viewTimesheet) viewTimesheet.classList.add('hidden');
                if (setupWarning) setupWarning.classList.remove('hidden');
                initOnboardingView(profiles, p);
            }
        });
    } catch (e) {
        console.error('Erreur initialisation popup DoliSIRH:', e);
    }
});
