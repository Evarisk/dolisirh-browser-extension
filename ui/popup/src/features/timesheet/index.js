import { fetchDoli } from '../../api/dolibarr.js';
import { CustomSelect } from '../../../../components/custom-select.js';
// DoliError et showDoliError sont des globales chargées via <script src="errors.js"> dans popup.html

let doliUrl = '';
let apiToken = '';
let doliEntity = '';
let profileConfig = null;
let currentMode = 'rh'; // 'standard' or 'rh' — RH est le mode par défaut
let selectedHrTask = null;
let isTimesheetInitialized = false;
let selectedDate = new Date(); // date courante sélectionnée dans le picker
let globalCurrentUserId = null;

// ─── Utilitaire : formate une date en YYYY-MM-DD ────────────────────────────
function toLocalDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Retourne la clé de planning ('lun'|'mar'|...) pour une date donnée.
 * @param {Date} date
 * @returns {string}
 */
function getDayKeyFromDate(date) {
    const keys = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
    return keys[date.getDay()];
}

// ─── Sélecteur de semaine ────────────────────────────────────────────────────
/**
 * Retourne le lundi de la semaine contenant `date`.
 * @param {Date} date
 * @returns {Date}
 */
function getMondayOf(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=dim, 1=lun...
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Construit les boutons Lu-Ma-Me-Je-Ve de la semaine courante.
 * Lors d'un changement de jour, met à jour les inputs time des cartes
 * avec la valeur du planning pour ce jour.
 */
function buildWeekPicker() {
    const container = document.getElementById('ts-week-days');
    if (!container) return;
    container.innerHTML = '';

    const monday = getMondayOf(selectedDate);
    const DAY_NAMES = ['LUN', 'MAR', 'MER', 'JEU', 'VEN'];
    const DAY_KEYS  = ['lun', 'mar', 'mer', 'jeu', 'ven'];

    for (let i = 0; i < 5; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ts-day-btn';

        const isActive = toLocalDateStr(d) === toLocalDateStr(selectedDate);
        if (isActive) btn.classList.add('ts-day-active');

        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();

        const nameSpan  = document.createElement('span'); nameSpan.className  = 'ts-day-name';  nameSpan.textContent = DAY_NAMES[i];
        const numSpan   = document.createElement('span'); numSpan.className   = 'ts-day-num';   numSpan.textContent  = String(d.getDate()).padStart(2, '0');
        const monthSpan = document.createElement('span'); monthSpan.className = 'ts-day-month'; monthSpan.textContent = `${month}/${year}`;
        btn.appendChild(nameSpan); btn.appendChild(numSpan); btn.appendChild(monthSpan);

        btn.addEventListener('click', () => {
            selectedDate = new Date(d);
            // Synchronise l'input date caché
            const dateInput = document.getElementById('time-date');
            if (dateInput) dateInput.value = toLocalDateStr(selectedDate);
            // Met à jour la valeur par défaut des cartes pour ce nouveau jour
            updateCardsDefaultTime(DAY_KEYS[i]);
            buildWeekPicker(); // re-render pour mettre à jour active
            updateDailyTimespentStats(); // Recalcul des totaux
        });

        container.appendChild(btn);
    }
}

/**
 * Pré-remplit le champ temps des cartes RH avec la valeur du planning
 * du profil pour le jour donné.
 * @param {string} dayKey - 'lun'|'mar'|'mer'|'jeu'|'ven'|'sam'|'dim'
 */
function updateCardsDefaultTime(dayKey) {
    const schedule = profileConfig?.doliHrSchedule || {};
    const defaultTime = schedule[dayKey] || '00:00';
    // Met à jour uniquement les cartes qui n'ont pas encore été enregistrées
    document.querySelectorAll('.ts-hr-card:not(.ts-hr-card-done)').forEach(card => {
        const inp = card.querySelector('.ts-hr-time-input');
        if (inp) inp.value = defaultTime;
    });
}

/**
 * Affiche les infos du projet RH et le compteur mensuel.
 */
function updateHrProjectInfo() {
    const label = document.getElementById('ts-hr-project-label');
    const monthName = document.getElementById('ts-month-name');
    const monthlyHours = document.getElementById('ts-monthly-hours');
    const infoBlock = document.getElementById('ts-hr-project-info');
    const counterBlock = document.getElementById('ts-monthly-counter');

    if (!profileConfig || !profileConfig.doliHrProject) {
        if (infoBlock) infoBlock.style.display = 'none';
        if (counterBlock) counterBlock.style.display = 'none';
        return;
    }

    if (infoBlock) infoBlock.style.display = '';
    if (counterBlock) counterBlock.style.display = '';

    // Afficher la référence du projet RH
    if (label) {
        label.textContent = profileConfig.doliHrProjectRef
            ? `${profileConfig.doliHrProjectRef} -  ${profileConfig.doliHrProjectTitle || ''}`
            : `Projet RH #${profileConfig.doliHrProject}`;
    }

    // Mois courant en français
    const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    if (monthName) monthName.textContent = `${months[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;
    if (monthlyHours) monthlyHours.textContent = '—'; // sera mis à jour par fetchMonthlyHours
}

async function updateDailyTimespentStats() {
    const presSpan = document.getElementById('ts-pres-stats');
    const absSpan = document.getElementById('ts-abs-stats');
    if (!presSpan && !absSpan) return;

    if (!globalCurrentUserId || !profileConfig) {
        return;
    }

    if (presSpan) presSpan.textContent = 'Calcul en cours...';
    if (absSpan) absSpan.textContent = 'Calcul en cours...';

    const dayKey = getDayKeyFromDate(selectedDate);
    const schedule = profileConfig?.doliHrSchedule || {};
    const defaultTimeStr = schedule[dayKey] || '0:00';

    const presIds = profileConfig.doliHrPresenceTasks || [];
    const absIds  = profileConfig.doliHrAbsenceTasks  || [];
    const allIds = [...new Set([...presIds, ...absIds])];

    const renderStats = (span, defaultTime, logged, stateLabel, stateVal, status) => {
        if (!span) return;
        span.innerHTML = '';
        span.appendChild(document.createTextNode(`attendue : ${defaultTime} | Pointé : ${logged} | ${stateLabel} : ${stateVal} - `));
        const stSpan = document.createElement('span');
        stSpan.textContent = status;
        if (status === 'KO') stSpan.style.color = '#ef4444';
        else if (status === 'OK') stSpan.style.color = '#10b981';
        else stSpan.style.color = '#f59e0b';
        span.appendChild(stSpan);
    };

    if (allIds.length === 0) {
        if (defaultTimeStr === '0:00' || defaultTimeStr === '00:00') {
            renderStats(presSpan, defaultTimeStr, '0:00', 'Etat', '00:00', 'OK');
            renderStats(absSpan, defaultTimeStr, '0:00', 'Etat', '00:00', 'OK');
        } else {
            // Check if defaultTimeStr has 1 or 2 digit hour for padding
            let pTime = defaultTimeStr.split(':');
            let padTime = `${String(pTime[0]).padStart(2,'0')}:${pTime[1]}`;
            renderStats(presSpan, defaultTimeStr, '0:00', 'Manque', `- ${padTime}`, 'KO');
            renderStats(absSpan, defaultTimeStr, '0:00', 'Manque', `- ${padTime}`, 'KO');
        }
        return;
    }

    const dateVal = document.getElementById('time-date')?.value || toLocalDateStr(selectedDate);
    const dayStart = Math.floor(new Date(dateVal + 'T00:00:00').getTime() / 1000);
    const dayEnd   = dayStart + 86399;

    const reqHeaders = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) reqHeaders['DOLAPIENTITY'] = doliEntity;

    let totalSec = 0;

    try {
        const fetchPromises = allIds.map(async (taskId) => {
            try {
                const res = await fetchDoli(`${doliUrl}/tasks/${taskId}?includetimespent=2`, { headers: reqHeaders });
                if (res.ok) {
                    const task = await res.json();
                    const allLines = Array.isArray(task.lines) ? task.lines : [];
                    const myLines = allLines.filter(e => String(e.timespent_line_fk_user || '') === globalCurrentUserId);
                    
                    let taskTodaySec = 0;
                    let lastNote = '';
                    myLines.forEach(e => {
                        const ts = parseInt(e.timespent_line_datehour || e.timespent_line_date || 0, 10);
                        if (ts >= dayStart && ts <= dayEnd) {
                            taskTodaySec += parseInt(e.timespent_line_duration || 0, 10);
                            if (e.timespent_line_note) lastNote = e.timespent_line_note;
                        }
                    });
                    totalSec += taskTodaySec;

                    // Mettre à jour la carte dans le DOM
                    const card = document.querySelector(`.ts-hr-card[data-task-id="${taskId}"]`);
                    if (card) {
                        const noteInput = card.querySelector('.ts-hr-note-input');
                        if (noteInput && !noteInput.value && lastNote) noteInput.value = lastNote;
                        
                        if (taskTodaySec > 0) {
                            card.classList.add('ts-hr-card-active', 'ts-hr-card-done');
                            const starBtn = card.querySelector('.ts-hr-star-btn');
                            if (starBtn) starBtn.classList.add('ts-star-active');
                        } else {
                            card.classList.remove('ts-hr-card-done');
                            const starBtn = card.querySelector('.ts-hr-star-btn');
                            if (starBtn) starBtn.classList.remove('ts-star-active');
                            if (!defaultTimeStr) card.classList.remove('ts-hr-card-active');
                        }

                        // Champ Total supprimé à la demande de l'utilisateur

                        // Remplir historyDiv avec Ligne 3..X
                        const historyDiv = card.querySelector('.ts-hr-hist-container');
                        if (historyDiv) {
                            historyDiv.innerHTML = '';
                            if (myLines.length === 0) {
                                // Aucun historique
                            } else {
                                // Tri décroissant et filtrage sur le jour sélectionné
                                const sorted = [...myLines]
                                    .filter(e => {
                                        const ts = parseInt(e.timespent_line_datehour || e.timespent_line_date || 0, 10);
                                        return ts >= dayStart && ts <= dayEnd;
                                    })
                                    .sort((a, b) =>
                                        (parseInt(b.timespent_line_datehour || b.timespent_line_date || 0, 10)) -
                                        (parseInt(a.timespent_line_datehour || a.timespent_line_date || 0, 10))
                                    );
                                sorted.forEach(e => {
                                    const ts = parseInt(e.timespent_line_datehour || e.timespent_line_date || 0, 10);
                                    const dateObj = ts > 0 ? new Date(ts * 1000) : null;
                                    const dateStr = dateObj
                                        ? `${String(dateObj.getDate()).padStart(2,'0')}/${String(dateObj.getMonth()+1).padStart(2,'0')}/${dateObj.getFullYear()}`
                                        : '—';
                                    const dur = parseInt(e.timespent_line_duration || 0, 10);
                                    const hh = String(Math.floor(dur/3600)).padStart(2,'0');
                                    const mm = String(Math.floor((dur%3600)/60)).padStart(2,'0');
                                    const noteVal = e.timespent_line_note || '';

                                    const row = document.createElement('div');
                                    row.className = 'ts-hr-hist-row';
                                    row.style.fontSize = '12px';
                                    row.style.color = '#475569';
                                    row.style.padding = '4px 10px';
                                    row.style.borderTop = '1px solid #e2e8f0';
                                    row.style.display = 'grid';
                                    row.style.gridTemplateColumns = '1fr auto';
                                    row.style.gap = '8px';
                                    row.style.alignItems = 'center';
                                    row.style.width = '100%';
                                    row.style.boxSizing = 'border-box';

                                    let text = `${dateStr}`;
                                    if (noteVal) text += ` - ${noteVal}`;
                                    text += ` - ${hh}:${mm}`;
                                    
                                    const textSpan = document.createElement('span');
                                    textSpan.textContent = text;
                                    textSpan.style.wordBreak = 'break-word';
                                    row.appendChild(textSpan);

                                    // Trash icon
                                    const lineId = e.timespent_line_id || e.id;
                                    if (lineId) {
                                        const trashBtn = document.createElement('button');
                                        trashBtn.type = 'button';
                                        trashBtn.title = 'Supprimer ce temps';
                                        trashBtn.style.background = 'none';
                                        trashBtn.style.border = 'none';
                                        trashBtn.style.color = '#ef4444';
                                        trashBtn.style.cursor = 'pointer';
                                        trashBtn.style.padding = '2px';
                                        
                                        const trashSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                                        trashSvg.setAttribute('width', '14'); trashSvg.setAttribute('height', '14');
                                        trashSvg.setAttribute('viewBox', '0 0 24 24'); trashSvg.setAttribute('fill', 'none');
                                        trashSvg.setAttribute('stroke', 'currentColor'); trashSvg.setAttribute('stroke-width', '2');
                                        trashSvg.setAttribute('stroke-linecap', 'round'); trashSvg.setAttribute('stroke-linejoin', 'round');
                                        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                                        polyline.setAttribute('points', '3 6 5 6 21 6');
                                        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                                        path.setAttribute('d', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2');
                                        trashSvg.appendChild(polyline);
                                        trashSvg.appendChild(path);
                                        trashBtn.appendChild(trashSvg);

                                        trashBtn.addEventListener('click', async (evt) => {
                                            evt.stopPropagation();
                                            trashBtn.style.opacity = '0.5';
                                            trashBtn.disabled = true;
                                            try {
                                                const endpoints = [
                                                    `${doliUrl}/tasks/${taskId}/timespent/${lineId}`,
                                                    `${doliUrl}/tasks/timespent/${lineId}`,
                                                    `${doliUrl}/timespents/${lineId}`,
                                                    `${doliUrl}/timespent/${lineId}`
                                                ];
                                                let success = false;
                                                for (const ep of endpoints) {
                                                    const delRes = await fetchDoli(ep, { method: 'DELETE', headers: reqHeaders });
                                                    if (delRes.ok) {
                                                        success = true;
                                                        break;
                                                    }
                                                }

                                                if (success) {
                                                    updateDailyTimespentStats(); // Recharge
                                                } else {
                                                    console.warn('Echec suppression sur tous les endpoints');
                                                    trashBtn.style.opacity = '1';
                                                    trashBtn.disabled = false;
                                                }
                                            } catch(err) {
                                                console.error('Erreur suppression', err);
                                                trashBtn.style.opacity = '1';
                                                trashBtn.disabled = false;
                                            }
                                        });
                                        row.appendChild(trashBtn);
                                    }

                                    historyDiv.appendChild(row);
                                });
                            }
                        }
                    }
                }
            } catch(e) {
                console.warn('[ReedCRM] Erreur stat task', taskId, e);
            }
        });

        await Promise.all(fetchPromises);

        const hT = Math.floor(totalSec / 3600);
        const mT = Math.floor((totalSec % 3600) / 60);
        const loggedStr = `${hT}:${String(mT).padStart(2,'0')}`;

        // Calcul status
        const parts = defaultTimeStr.split(':');
        const expectedSec = ((parseInt(parts[0], 10) || 0) * 3600) + ((parseInt(parts[1], 10) || 0) * 60);

        // Calcul du temps restant pour les inputs
        const remainingSec = Math.max(0, expectedSec - totalSec);
        const rH = Math.floor(remainingSec / 3600);
        const rM = Math.floor((remainingSec % 3600) / 60);
        const remainingStr = `${String(rH).padStart(2,'0')}:${String(rM).padStart(2,'0')}`;

        // Calcul du status formaté
        const diffSec = totalSec - expectedSec;
        const absDiff = Math.abs(diffSec);
        const diffH = Math.floor(absDiff / 3600);
        const diffM = Math.floor((absDiff % 3600) / 60);
        const diffStr = `${String(diffH).padStart(2,'0')}:${String(diffM).padStart(2,'0')}`;

        let status = "OK";
        let stateLabel = "Etat";
        let stateVal = "00:00";

        if (diffSec > 0) {
            status = "KO";
            stateLabel = "Etat";
            stateVal = `+ ${diffStr}`;
        } else if (diffSec < 0) {
            status = "KO";
            stateLabel = "Manque";
            stateVal = `- ${diffStr}`;
        } else {
            status = "OK";
            stateLabel = "Etat";
            stateVal = "00:00";
        }

        renderStats(presSpan, defaultTimeStr, loggedStr, stateLabel, stateVal, status);
        renderStats(absSpan, defaultTimeStr, loggedStr, stateLabel, stateVal, status);

        allIds.forEach(taskId => {
            const card = document.querySelector(`.ts-hr-card[data-task-id="${taskId}"]`);
            if (card) {
                const timeInput = card.querySelector('.ts-hr-time-input');
                if (timeInput && document.activeElement !== timeInput) {
                    timeInput.value = remainingStr;
                }
            }
        });
    } catch(e) {
        if (presSpan) presSpan.textContent = "Erreur de calcul";
        if (absSpan) absSpan.textContent = "Erreur de calcul";
    }
}

export function initTimesheet(url, token, entity, profile) {
    doliUrl = url;
    apiToken = token;
    doliEntity = entity;
    profileConfig = profile;

    if (!globalCurrentUserId) {
        (async () => {
            try {
                const reqHeaders = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
                if (doliEntity) reqHeaders['DOLAPIENTITY'] = doliEntity;
                const userRes = await fetchDoli(`${doliUrl}/users/info`, { headers: reqHeaders });
                if (userRes.ok) {
                    const userInfo = await userRes.json();
                    globalCurrentUserId = String(userInfo.id || userInfo.rowid || '');
                    updateDailyTimespentStats();
                }
            } catch(_) {}
        })();
    } else {
        updateDailyTimespentStats();
    }

    const setupContainer = document.getElementById('timesheet-setup-container');
    const mainContainer = document.getElementById('timesheet-main-container');

    if (!profileConfig || !profileConfig.doliHrProject) {
        if (setupContainer) setupContainer.classList.remove('hidden');
        if (mainContainer) mainContainer.classList.add('hidden');
        loadSetupProjects();
    } else {
        if (setupContainer) setupContainer.classList.add('hidden');
        if (mainContainer) mainContainer.classList.remove('hidden');
        loadStandardProjects();
        buildHrUi();
    }

    // Initialiser la date d'aujourd'hui
    selectedDate = new Date();
    const dateInput = document.getElementById('time-date');
    if (dateInput) dateInput.value = toLocalDateStr(selectedDate);

    // Construire le picker de semaine
    buildWeekPicker();
    updateHrProjectInfo();

    // Navigation semaine précédente / suivante
    document.getElementById('ts-week-prev')?.addEventListener('click', () => {
        selectedDate.setDate(selectedDate.getDate() - 7);
        buildWeekPicker();
        if (dateInput) dateInput.value = toLocalDateStr(selectedDate);
        updateHrProjectInfo();
    });
    document.getElementById('ts-week-next')?.addEventListener('click', () => {
        selectedDate.setDate(selectedDate.getDate() + 7);
        buildWeekPicker();
        if (dateInput) dateInput.value = toLocalDateStr(selectedDate);
        updateHrProjectInfo();
    });

    if (isTimesheetInitialized) return;
    isTimesheetInitialized = true;

    // SETUP LISTENERS
    const setupProjSelect = document.getElementById('time-setup-project');
    if (setupProjSelect) {
        setupProjSelect.addEventListener('change', (e) => {
            loadSetupTasks(e.target.value);
        });
    }
    const saveBtn = document.getElementById('btn-save-time-setup');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveSetup);
    }

    // Tabs mode RH / Standard
    const btnStandard = document.getElementById('btn-mode-standard');
    const btnRh = document.getElementById('btn-mode-rh');
    const modeStandard = document.getElementById('timesheet-mode-standard');
    const modeRh = document.getElementById('timesheet-mode-rh');

    if (btnStandard && btnRh) {
        btnRh.addEventListener('click', () => {
            currentMode = 'rh';
            btnRh.classList.add('ts-tab-active');
            btnStandard.classList.remove('ts-tab-active');
            modeRh.classList.remove('hidden');
            modeStandard.classList.add('hidden');
            document.getElementById('ts-hr-project-info')?.style.setProperty('display', '');
            document.getElementById('ts-monthly-counter')?.style.setProperty('display', '');
            checkSubmitStatus();
            buildHrUi();
        });

        btnStandard.addEventListener('click', () => {
            currentMode = 'standard';
            btnStandard.classList.add('ts-tab-active');
            btnRh.classList.remove('ts-tab-active');
            modeStandard.classList.remove('hidden');
            modeRh.classList.add('hidden');
            document.getElementById('ts-hr-project-info')?.style.setProperty('display', 'none');
            document.getElementById('ts-monthly-counter')?.style.setProperty('display', 'none');
            checkSubmitStatus();
        });
    }

    // Activer le mode RH par défaut si configuré
    if (profileConfig && profileConfig.doliHrProject) {
        currentMode = 'rh';
        btnRh?.classList.add('ts-tab-active');
        btnStandard?.classList.remove('ts-tab-active');
        modeRh?.classList.remove('hidden');
        modeStandard?.classList.add('hidden');
    } else {
        currentMode = 'standard';
        btnStandard?.classList.add('ts-tab-active');
        btnRh?.classList.remove('ts-tab-active');
        modeStandard?.classList.remove('hidden');
        modeRh?.classList.add('hidden');
        document.getElementById('ts-hr-project-info')?.style.setProperty('display', 'none');
        document.getElementById('ts-monthly-counter')?.style.setProperty('display', 'none');
    }

    const projSelect = document.getElementById('time-project');
    if (projSelect) {
        projSelect.addEventListener('change', (e) => {
            loadStandardTasks(e.target.value);
            checkSubmitStatus();
        });
    }

    const taskSelect = document.getElementById('time-task');
    if (taskSelect) taskSelect.addEventListener('change', checkSubmitStatus);

    const durationInput = document.getElementById('time-duration');
    if (durationInput) durationInput.addEventListener('input', checkSubmitStatus);

    const btnSubmit = document.getElementById('btn-submit-time');
    if (btnSubmit) btnSubmit.addEventListener('click', submitTime);
}


function checkSubmitStatus() {
    const btnSubmit = document.getElementById('btn-submit-time');
    if (!btnSubmit) return;

    let isValid = false;
    const duration = document.getElementById('time-duration')?.value;
    const date = document.getElementById('time-date')?.value;
    
    if (duration && date) {
        if (currentMode === 'standard') {
            const task = document.getElementById('time-task')?.value;
            if (task && task !== '') isValid = true;
        } else {
            if (selectedHrTask) isValid = true;
        }
    }

    btnSubmit.disabled = !isValid;
}

async function loadStandardProjects() {
    const select = document.getElementById('time-project');
    if (!select) return;

    const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    try {
        const res = await fetchDoli(`${doliUrl}/projects?limit=10000&status=1&sortfield=t.rowid&sortorder=DESC`, { headers });
        if (res.ok) {
            const projects = await res.json();
            if (Array.isArray(projects)) {
                projects.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = `${p.ref} - ${p.title}`;
                    select.appendChild(opt);
                });
                
                // Init Custom Select
                if (!window.timeProjectSelect) {
                    window.timeProjectSelect = new CustomSelect(select);
                } else {
                    window.timeProjectSelect.update();
                }
            }
        }
    } catch(e) {
        console.error('Error fetching standard projects', e);
    }
}

async function loadStandardTasks(projectId) {
    const select = document.getElementById('time-task');
    if (!select) return;

    select.innerHTML = '<option value="">Sélectionner une tâche</option>';
    select.disabled = true;

    if (!projectId) {
        if (window.timeTaskSelect) window.timeTaskSelect.update();
        return;
    }

    const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    try {
        const res = await fetchDoli(`${doliUrl}/tasks?sqlfilters=(t.fk_projet:=:${projectId})&limit=100`, { headers });
        if (res.ok) {
            const tasks = await res.json();
            if (Array.isArray(tasks)) {
                tasks.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = `${t.ref} - ${t.label}`;
                    select.appendChild(opt);
                });
                select.disabled = false;
            }
        }
    } catch(e) {
        console.error('Error fetching standard tasks', e);
    }

    if (!window.timeTaskSelect) {
        window.timeTaskSelect = new CustomSelect(select);
    } else {
        window.timeTaskSelect.update();
    }
}

async function buildHrUi() {
    const presContainer = document.getElementById('hr-presence-container');
    const absContainer  = document.getElementById('hr-absence-container');
    if (!presContainer || !absContainer) return;

    if (presContainer.dataset.loaded === 'true') return;

    presContainer.innerHTML = '<span style="font-size:11px;color:#999;">Chargement...</span>';
    absContainer.innerHTML  = '<span style="font-size:11px;color:#999;">Chargement...</span>';

    const projectId = profileConfig?.doliHrProject;
    if (!projectId) {
        showDoliError(new DoliError('ReedCRM-5004', null, {}), presContainer);
        absContainer.innerHTML = '';
        return;
    }

    const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    try {
        const res = await fetchDoli(`${doliUrl}/tasks?sqlfilters=(t.fk_projet:=:${projectId})&limit=100`, { headers });
        if (res.ok) {
            const tasks = await res.json();
            presContainer.innerHTML = '';
            absContainer.innerHTML  = '';

            const presIds = profileConfig.doliHrPresenceTasks || [];
            const absIds  = profileConfig.doliHrAbsenceTasks  || [];

            let presFound = false;
            let absFound  = false;

            if (Array.isArray(tasks)) {
                tasks.forEach(t => {
                    const idStr = String(t.id);
                    if (presIds.includes(idStr)) {
                        presContainer.appendChild(createHrCard(t.id, t.ref, t.label, 'presence'));
                        presFound = true;
                    }
                    if (absIds.includes(idStr)) {
                        absContainer.appendChild(createHrCard(t.id, t.ref, t.label, 'absence'));
                        absFound = true;
                    }
                });
            }

            if (!presFound) presContainer.innerHTML = '<span style="font-size:11px;color:#94a3b8;font-style:italic;">Aucune tâche configurée</span>';
            if (!absFound)  absContainer.innerHTML  = '<span style="font-size:11px;color:#94a3b8;font-style:italic;">Aucune tâche configurée</span>';

            presContainer.dataset.loaded = 'true';
        } else {
            let errTxt = res.statusText;
            try { const body = await res.json(); errTxt = body.error || body.message || errTxt; } catch(_) {}
            showDoliError(new DoliError('ReedCRM-5005', new Error(errTxt), { projectId }), presContainer);
            absContainer.innerHTML = '';
        }
    } catch(e) {
        showDoliError(new DoliError('ReedCRM-5005', e, { projectId }), presContainer);
        absContainer.innerHTML = '';
    }
}

/**
 * Crée une carte de tâche RH avec input durée, bouton étoile, et note inline.
 * Conforme AGENTS.md : createElement/textContent uniquement, pas d'innerHTML avec données API.
 * @param {string|number} taskId
 * @param {string} ref   - Référence Dolibarr ex: "TK2301-0268"
 * @param {string} label - Libellé de la tâche ex: "Formation externe"
 * @param {'presence'|'absence'} type
 * @returns {HTMLElement}
 */
function createHrCard(taskId, ref, label, type) {
    // ── Carte racine ──────────────────────────────────────────────────────────
    const card = document.createElement('div');
    card.className = 'ts-hr-card';
    card.dataset.taskId = String(taskId);
    card.dataset.type   = type;

    // ── Ligne principale ──────────────────────────────────────────────────────
    const mainRow = document.createElement('div');
    mainRow.className = 'ts-hr-card-main';

    // -- Info (icône + ref + label) -------------------------------------------
    const info = document.createElement('div');
    info.className = 'ts-hr-card-info';

    const refSpan = document.createElement('span');
    refSpan.className = 'ts-hr-card-ref';

    // Icône SVG tâche (checklist — statique, aucune donnée utilisateur)
    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('width', '14'); iconSvg.setAttribute('height', '14');
    iconSvg.setAttribute('viewBox', '0 0 24 24'); iconSvg.setAttribute('fill', 'none');
    iconSvg.setAttribute('stroke', 'currentColor'); iconSvg.setAttribute('stroke-width', '2');
    iconSvg.setAttribute('stroke-linecap', 'round'); iconSvg.setAttribute('stroke-linejoin', 'round');
    iconSvg.classList.add('ts-card-icon');
    // Icône "clipboard-check" (tâche validée)
    const rectClip = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectClip.setAttribute('x', '9'); rectClip.setAttribute('y', '2');
    rectClip.setAttribute('width', '6'); rectClip.setAttribute('height', '4');
    rectClip.setAttribute('rx', '1');
    const pathClip = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathClip.setAttribute('d', 'M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2');
    const polyCheck = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyCheck.setAttribute('points', '9 12 11 14 15 10');
    iconSvg.appendChild(rectClip); iconSvg.appendChild(pathClip); iconSvg.appendChild(polyCheck);

    // Ref cliquable → ouvre la tâche dans Dolibarr
    const refLink = document.createElement('a');
    refLink.className = 'ts-hr-card-ref-link';
    refLink.textContent = '\u00a0' + (ref || '');
    refLink.title = chrome.i18n.getMessage('time_card_open_doli_title') || 'Ouvrir dans Dolibarr';
    refLink.href = '#';
    refLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // Ne pas déclencher le click "charger timespent"
        const baseUrl = doliUrl.replace('/api/index.php', '');
        const taskUrl = `${baseUrl}/projet/tasks/task.php?id=${taskId}`;
        chrome.tabs.create({ url: taskUrl });
    });

    refSpan.appendChild(iconSvg);
    refSpan.appendChild(refLink);

    // Tiret séparateur entre ref et label
    const separatorSpan = document.createElement('span');
    separatorSpan.className = 'ts-hr-card-sep';
    separatorSpan.textContent = ' — ';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'ts-hr-card-label';
    labelSpan.textContent = label;   // donnée API via textContent
    labelSpan.title = label;         // tooltip pour voir le texte complet si tronqué

    info.appendChild(refSpan);
    info.appendChild(separatorSpan);
    info.appendChild(labelSpan);

    // -- Input temps : pré-rempli avec la valeur du planning pour le jour courant ----
    const timeInput = document.createElement('input');
    timeInput.type      = 'time';
    timeInput.className = 'ts-hr-time-input';
    timeInput.title     = chrome.i18n.getMessage('time_card_duration_title');

    // Pré-remplir avec la valeur du planning si disponible
    const dayKey = getDayKeyFromDate(selectedDate);
    const schedule = profileConfig?.doliHrSchedule || {};
    const defaultTime = schedule[dayKey] || '';
    if (defaultTime) timeInput.value = defaultTime;

    // ── Colonne droite : timeInput uniquement ──────────────────────────────
    const rightCol = document.createElement('div');
    rightCol.className = 'ts-hr-right-col';
    rightCol.appendChild(timeInput);

    // -- Bouton étoile (disquette) --------------------------------------------
    const starBtn = document.createElement('button');
    starBtn.type      = 'button';
    starBtn.className = 'ts-hr-star-btn';
    starBtn.title     = chrome.i18n.getMessage('time_card_save_title');

    // SVG disquette (sauvegarde)
    const starSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    starSvg.setAttribute('width', '24'); starSvg.setAttribute('height', '24');
    starSvg.setAttribute('viewBox', '0 0 24 24'); starSvg.setAttribute('fill', 'none');
    starSvg.setAttribute('stroke', 'currentColor'); starSvg.setAttribute('stroke-width', '1.5');
    starSvg.setAttribute('stroke-linecap', 'round'); starSvg.setAttribute('stroke-linejoin', 'round');
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z');
    const polyline1 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline1.setAttribute('points', '17 21 17 13 7 13 7 21');
    const polyline2 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline2.setAttribute('points', '7 3 7 8 15 8');
    starSvg.appendChild(path1);
    starSvg.appendChild(polyline1);
    starSvg.appendChild(polyline2);
    starBtn.appendChild(starSvg);

    mainRow.appendChild(info);
    mainRow.appendChild(rightCol);

    // ── Zone note (Ligne 2) ───────────────────────────────────────────────────
    const noteRow = document.createElement('div');
    noteRow.className = 'ts-hr-card-note-row'; // Toujours visible selon la demande
    noteRow.style.display = 'flex';
    noteRow.style.alignItems = 'center';
    noteRow.style.gap = '8px';
    noteRow.style.padding = '0 10px 10px 10px';

    const noteInput = document.createElement('textarea');
    noteInput.className   = 'ts-hr-note-input';
    noteInput.rows        = 1;
    noteInput.placeholder = chrome.i18n.getMessage('time_card_note_placeholder');
    noteInput.removeAttribute('readonly');
    noteInput.removeAttribute('disabled');
    noteInput.style.flex = '1';
    
    noteRow.appendChild(noteInput);
    noteRow.appendChild(starBtn); // Disquette à droite du commentaire

    // ── Div statut par carte ──────────────────────────────────────────────────
    const statusDiv = document.createElement('div');
    statusDiv.className = 'ts-hr-card-status hidden';

    // ── Historique timespent (affiché automatiquement sous la note) ───────────────
    const historyDiv = document.createElement('div');
    historyDiv.className = 'ts-hr-hist-container'; // Plus de hidden, et utilise la bonne classe

    card.appendChild(mainRow);
    card.appendChild(noteRow);
    card.appendChild(statusDiv);
    card.appendChild(historyDiv);

    // ── Interactions ──────────────────────────────────────────────────────────

    // Révéler la note quand l'utilisateur MODIFIE manuellement la durée
    timeInput.addEventListener('change', () => {
        if (timeInput.value) {
            noteRow.classList.remove('hidden');
            card.classList.add('ts-hr-card-active');
        } else {
            noteRow.classList.add('hidden');
            card.classList.remove('ts-hr-card-active', 'ts-hr-card-done');
            starBtn.classList.remove('ts-star-active');
        }
    });


    // Si le temps est pré-rempli : card active mais note cachée jusqu'à interaction
    if (defaultTime) {
        card.classList.add('ts-hr-card-active');
    }

    // Étoile = soumettre ce temps via l'API
    starBtn.addEventListener('click', async () => {
        const duration = timeInput.value;
        if (!duration) {
            timeInput.focus();
            timeInput.style.borderColor = '#e74c3c';
            setTimeout(() => { timeInput.style.borderColor = ''; }, 1500);
            return;
        }

        const dateVal = document.getElementById('time-date')?.value || toLocalDateStr(selectedDate);
        const note    = noteInput.value || '';

        // Parse HH:MM → secondes
        const [h, m] = duration.split(':').map(Number);
        const durationInSeconds = (h * 3600) + (m * 60);

        // Format date Dolibarr "YYYY-MM-DD HH:MM:SS"
        const d = new Date(dateVal + 'T00:00:00');
        const pad = n => String(n).padStart(2, '0');
        const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} 00:00:00`;

        // Feedback UI
        starBtn.disabled = true;
        starBtn.classList.add('ts-star-loading');
        statusDiv.classList.add('hidden');

        const reqHeaders = {
            'DOLAPIKEY': apiToken,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
        if (doliEntity) reqHeaders['DOLAPIENTITY'] = doliEntity;

        try {
            // L'API Dolibarr attend la date au format string "YYYY-MM-DD HH:MM:SS"
            const dateObj = new Date(dateVal + 'T00:00:00');
            const pad = n => String(n).padStart(2, '0');
            const dateStr = `${dateObj.getFullYear()}-${pad(dateObj.getMonth()+1)}-${pad(dateObj.getDate())} 00:00:00`;

            const res = await fetchDoli(`${doliUrl}/tasks/${taskId}/addtimespent`, {
                method: 'POST',
                headers: reqHeaders,
                body: JSON.stringify({
                    date:     dateStr,
                    duration: durationInSeconds,
                    note:     note,
                    user_id:  0
                })
            });

            starBtn.classList.remove('ts-star-loading');

            if (res.ok) {
                // État success : étoile pleine bleue (présence de donnée)
                card.classList.add('ts-hr-card-done');
                starBtn.classList.add('ts-star-active');
                
                // Animation temporaire verte pour confirmer l'enregistrement
                card.classList.add('ts-hr-card-success');
                starBtn.classList.add('ts-star-success');
                setTimeout(() => {
                    card.classList.remove('ts-hr-card-success');
                    starBtn.classList.remove('ts-star-success');
                }, 2000);

                starBtn.disabled = false;
                statusDiv.classList.remove('hidden');
                statusDiv.style.color = '#22c55e';
                statusDiv.textContent = chrome.i18n.getMessage('time_card_saved');
                if (note) noteRow.classList.remove('hidden');

                // Mettre à jour l'historique de la carte et les statistiques globales
                updateDailyTimespentStats();

                // Après 3 secondes : masquer le statut, conserver l'état "noté"
                setTimeout(() => {
                    statusDiv.classList.add('hidden');
                    statusDiv.textContent = '';
                }, 3000);
            } else {
                let errTxt = res.statusText;
                try { const body = await res.json(); errTxt = body.error || body.message || errTxt; } catch(_) {}
                starBtn.disabled = false;
                statusDiv.classList.remove('hidden');
                // Affichage standardisé ReedCRM-5002
                showDoliError(
                    new DoliError('ReedCRM-5002', new Error(`HTTP ${res.status}: ${errTxt}`), { taskId, dateVal, durationInSeconds }),
                    statusDiv
                );
            }
        } catch(e) {
            starBtn.disabled = false;
            starBtn.classList.remove('ts-star-loading');
            statusDiv.classList.remove('hidden');
            // Affichage standardisé ReedCRM-5003
            showDoliError(
                new DoliError('ReedCRM-5003', e, { taskId, dateVal }),
                statusDiv
            );
        }
    });

    return card;
}


async function submitTime() {
    const btn = document.getElementById('btn-submit-time');
    const statusDiv = document.getElementById('time-status');
    const date = document.getElementById('time-date').value;
    const duration = document.getElementById('time-duration').value;
    const note = document.getElementById('time-note').value;
    
    let taskId = null;
    if (currentMode === 'standard') {
        taskId = document.getElementById('time-task').value;
    } else {
        taskId = selectedHrTask;
    }

    if (!taskId) return;

    btn.disabled = true;
    btn.classList.add('loading');
    statusDiv.textContent = '';
    
    // Parse duration HH:MM
    const parts = duration.split(':');
    let h = parseInt(parts[0], 10) || 0;
    let m = parseInt(parts[1], 10) || 0;
    const durationInSeconds = (h * 3600) + (m * 60);

    // Date au format attendu par l'API Dolibarr : "YYYY-MM-DD HH:MM:SS"
    const dObj = new Date(date + 'T00:00:00');
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${dObj.getFullYear()}-${pad(dObj.getMonth()+1)}-${pad(dObj.getDate())} 00:00:00`;
    
    const payload = {
        date: dateStr,
        duration: durationInSeconds,
        note: note,
        user_id: 0  // 0 = utilisateur authentifié par défaut
    };

    const headers = { 
        'DOLAPIKEY': apiToken, 
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    try {
        const res = await fetchDoli(`${doliUrl}/tasks/${taskId}/addtimespent`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        btn.classList.remove('loading');

        if (res.ok) {
            statusDiv.style.color = '#2ecc71';
            statusDiv.textContent = 'Temps enregistré avec succès !';
            updateDailyTimespentStats(); // Recalcul des totaux après ajout
            setTimeout(() => {
                statusDiv.textContent = '';
                document.getElementById('time-note').value = '';
                btn.disabled = false;
            }, 3000);
        } else {
            statusDiv.style.color = '#e74c3c';
            statusDiv.textContent = "Erreur lors de l'enregistrement : " + res.statusText;
            btn.disabled = false;
        }
    } catch(e) {
        btn.classList.remove('loading');
        btn.disabled = false;
        statusDiv.style.color = '#e74c3c';
        statusDiv.textContent = 'Erreur réseau';
    }
}

// --- SETUP FUNCTIONS ---

async function loadSetupProjects() {
    const select = document.getElementById('time-setup-project');
    if (!select) return;

    const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    try {
        const res = await fetchDoli(`${doliUrl}/projects?limit=10000&status=1&sortfield=t.rowid&sortorder=DESC`, { headers });
        if (res.ok) {
            const projects = await res.json();
            select.innerHTML = '<option value="">Sélectionnez un projet RH</option>';
            if (Array.isArray(projects)) {
                projects.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = `${p.ref} - ${p.title}`;
                    select.appendChild(opt);
                });
                
                if (!window.timeSetupProjectSelect) {
                    window.timeSetupProjectSelect = new CustomSelect(select);
                } else {
                    window.timeSetupProjectSelect.update();
                }
            }
        }
    } catch(e) {
        select.innerHTML = '<option value="">Erreur de chargement</option>';
        console.error('Error fetching setup projects', e);
    }
}

async function loadSetupTasks(projectId) {
    const presContainer = document.getElementById('time-setup-presence-container');
    const absContainer = document.getElementById('time-setup-absence-container');
    const saveBtn = document.getElementById('btn-save-time-setup');
    
    if (!presContainer || !absContainer || !saveBtn) return;
    
    saveBtn.disabled = true;

    if (!projectId) {
        presContainer.innerHTML = "<span style='color: #94a3b8; font-style: italic;'>Sélectionnez le projet d'abord</span>";
        absContainer.innerHTML = "<span style='color: #94a3b8; font-style: italic;'>Sélectionnez le projet d'abord</span>";
        return;
    }

    presContainer.innerHTML = '<span style="color: #94a3b8; font-style: italic;">Chargement...</span>';
    absContainer.innerHTML = '<span style="color: #94a3b8; font-style: italic;">Chargement...</span>';

    const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    try {
        const res = await fetchDoli(`${doliUrl}/tasks?sqlfilters=(t.fk_projet:=:${projectId})&limit=100`, { headers });
        if (res.ok) {
            const tasks = await res.json();
            presContainer.innerHTML = '';
            absContainer.innerHTML = '';
            
            if (Array.isArray(tasks) && tasks.length > 0) {
                tasks.forEach(t => {
                    presContainer.appendChild(createSetupCheckbox(t.id, t.label, 'presence'));
                    absContainer.appendChild(createSetupCheckbox(t.id, t.label, 'absence'));
                });
                saveBtn.disabled = false;
            } else {
                presContainer.innerHTML = '<span style="color: #e74c3c;">Aucune tâche trouvée</span>';
                absContainer.innerHTML = '<span style="color: #e74c3c;">Aucune tâche trouvée</span>';
            }
        }
    } catch(e) {
        presContainer.innerHTML = '<span style="color: #e74c3c;">Erreur réseau</span>';
        absContainer.innerHTML = '<span style="color: #e74c3c;">Erreur réseau</span>';
    }
}

function createSetupCheckbox(taskId, label, type) {
    const labelEl = document.createElement('label');
    labelEl.style.display = 'flex';
    labelEl.style.alignItems = 'center';
    labelEl.style.gap = '8px';
    labelEl.style.cursor = 'pointer';
    labelEl.style.padding = '6px';
    labelEl.style.borderRadius = '4px';
    labelEl.style.transition = 'background 0.2s';
    
    labelEl.onmouseover = () => labelEl.style.background = '#f1f5f9';
    labelEl.onmouseout = () => labelEl.style.background = 'transparent';
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = taskId;
    input.className = `setup-cb-${type}`;
    input.style.accentColor = type === 'presence' ? '#2ecc71' : '#f39c12';
    input.style.width = '16px';
    input.style.height = '16px';
    input.style.cursor = 'pointer';
    
    const span = document.createElement('span');
    span.textContent = label;
    span.style.fontSize = '12px';
    span.style.color = '#334155';
    
    labelEl.appendChild(input);
    labelEl.appendChild(span);
    return labelEl;
}

function saveSetup() {
    const saveBtn = document.getElementById('btn-save-time-setup');
    const projectId = document.getElementById('time-setup-project').value;
    
    if (!projectId) return;
    
    const presTasks = Array.from(document.querySelectorAll('.setup-cb-presence:checked')).map(cb => cb.value);
    const absTasks = Array.from(document.querySelectorAll('.setup-cb-absence:checked')).map(cb => cb.value);
    
    if (saveBtn) {
        saveBtn.disabled = true;
        const textSpan = saveBtn.querySelector('.btn-text');
        if (textSpan) textSpan.innerHTML = 'Sauvegarde... <span class="spinner" style="margin-left: 8px;"></span>';
    }
    
    chrome.storage.sync.get(['doliProfiles', 'doliActiveProfileId'], (items) => {
        let profiles = items.doliProfiles || [];
        let pIdx = -1;
        if (items.doliActiveProfileId) {
            pIdx = profiles.findIndex(prof => prof.id === items.doliActiveProfileId);
        }
        if (pIdx === -1 && profiles.length > 0) pIdx = 0;
        
        if (pIdx !== -1) {
            profiles[pIdx].doliHrProject = projectId;
            profiles[pIdx].doliHrPresenceTasks = presTasks;
            profiles[pIdx].doliHrAbsenceTasks = absTasks;
            // Sauvegarder aussi la ref et le titre pour l'affichage dans le bloc info
            const projSelect = document.getElementById('time-setup-project');
            const selectedOption = projSelect ? projSelect.options[projSelect.selectedIndex] : null;
            if (selectedOption && selectedOption.text) {
                const parts = selectedOption.text.split(' - ');
                profiles[pIdx].doliHrProjectRef = parts[0] || '';
                profiles[pIdx].doliHrProjectTitle = parts.slice(1).join(' - ') || '';
            }
            
            chrome.storage.sync.set({ doliProfiles: profiles }, () => {
                // Update local profileConfig
                profileConfig = profiles[pIdx];
                
                // Re-init the UI by calling initTimesheet again which will now see doliHrProject
                initTimesheet(doliUrl, apiToken, doliEntity, profileConfig);
                
                // Switch to HR mode as they just configured it
                const btnRh = document.getElementById('btn-mode-rh');
                if (btnRh) btnRh.click();
                
                if (saveBtn) {
                    const textSpan = saveBtn.querySelector('.btn-text');
                    if (textSpan) textSpan.innerHTML = 'Enregistré !';
                }
            });
        }
    });
}
