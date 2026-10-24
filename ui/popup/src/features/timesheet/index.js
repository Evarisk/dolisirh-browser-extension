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
let globalCurrentUserInitials = '';
let usersInitialsMap = {};
let standardProjectsMap = {};
let standardTasksMap = {};
let allLoadedProjects = [];
let entitiesLabelMap = {};
let hrTaskLinesCache = {};
let projectTaskLinesCache = {};
let ensuredProjectContributors = new Set();
let ensuredTaskContributors = new Set();
let thirdpartiesNameMap = {};
let pendingProjectClientFetches = new Set();
let calendarMonthDate = new Date();

/**
 * Decode HTML entities safely via DOMParser.
 * @param {string} str
 * @returns {string}
 */
function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string' || !str.includes('&')) return str || '';
    try {
        const doc = new DOMParser().parseFromString(str, 'text/html');
        return doc.documentElement.textContent || str;
    } catch (_) {
        return str;
    }
}

/**
 * Extrait les initiales sur 2 lettres d'un objet utilisateur Dolibarr (ex: Laurent Mag -> LM).
 * @param {Object} u
 * @returns {string}
 */
function extractUserInitials(u) {
    if (!u) return '';
    const fn = (u.firstname || '').trim();
    const ln = (u.lastname || '').trim();
    if (fn && ln) return (fn[0] + ln[0]).toUpperCase();
    if (fn) return fn.slice(0, 2).toUpperCase();
    if (ln) return ln.slice(0, 2).toUpperCase();
    if (u.login) return String(u.login).trim().slice(0, 2).toUpperCase();
    return '';
}

/**
 * Formate une durée en secondes au format HH:MM.
 * @param {number|string} sec
 * @returns {string}
 */
function formatSecToHHMM(sec) {
    const total = Math.max(0, parseInt(sec, 10) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Crée une icône SVG (hourglass pour prévu, clock pour passé).
 * @param {'planned'|'spent'} type
 * @returns {SVGElement}
 */
function createStatIconSvg(type) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (type === 'planned') {
        const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p1.setAttribute('d', 'M5 22h14');
        const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p2.setAttribute('d', 'M5 2h14');
        const p3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p3.setAttribute('d', 'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22');
        const p4 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p4.setAttribute('d', 'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2');
        svg.appendChild(p1); svg.appendChild(p2); svg.appendChild(p3); svg.appendChild(p4);
    } else {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '10');
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly.setAttribute('points', '12 6 12 12 16 14');
        svg.appendChild(c); svg.appendChild(poly);
    }
    return svg;
}

/**
 * Extrait les 5 derniers temps pointés sur un ensemble de tâches sous forme d'objets structurés.
 * @param {Array<Object>} tasksList
 * @returns {Array<{dateShort: string, desc: string, durStr: string}>}
 */
function extractLastTimespentEntries(tasksList) {
    if (!Array.isArray(tasksList) || tasksList.length === 0) return [];

    const allLines = [];
    tasksList.forEach(t => {
        if (!t || !Array.isArray(t.lines)) return;
        const taskRef = decodeHtmlEntities(t.ref || '');
        const taskLabel = decodeHtmlEntities(t.label || '');
        t.lines.forEach(line => {
            const ts = parseInt(line.timespent_line_datehour || line.timespent_line_date || 0, 10);
            const dur = parseInt(line.timespent_line_duration || 0, 10);
            if (ts > 0 && dur > 0) {
                allLines.push({
                    ...line,
                    _ts: ts,
                    _dur: dur,
                    _taskRef: taskRef,
                    _taskLabel: taskLabel
                });
            }
        });
    });

    if (allLines.length === 0) return [];

    allLines.sort((a, b) => {
        if (b._ts !== a._ts) return b._ts - a._ts;
        const idA = parseInt(a.timespent_line_id || a.id || 0, 10);
        const idB = parseInt(b.timespent_line_id || b.id || 0, 10);
        return idB - idA;
    });

    return allLines.slice(0, 5).map(entry => {
        const d = new Date(entry._ts * 1000);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        const dateShort = `${dd}/${mm}/${yy}`;
        const durStr = formatSecToHHMM(entry._dur);
        const noteStr = decodeHtmlEntities((entry.timespent_line_note || '').trim());
        const rawDesc = noteStr || entry._taskLabel || entry._taskRef || '-';
        const desc = rawDesc.length > 35 ? `${rawDesc.slice(0, 35)}...` : rawDesc;
        return { dateShort, desc, durStr };
    });
}

/**
 * Attache ou met à jour l'infobulle structurée (avec durée alignée à droite) sur un élément .is-spent.
 * @param {HTMLElement|null} spentSpan
 * @param {Array<Object>} tasksList
 */
function attachLastTimespentHover(spentSpan, tasksList) {
    if (!spentSpan) return;
    const entries = extractLastTimespentEntries(tasksList);
    spentSpan._lastEntries = entries;

    const defaultTitle = chrome.i18n.getMessage('std_spent_time_title') || 'Temps pass\u00e9';
    if (entries.length === 0) {
        spentSpan.title = defaultTitle;
    } else {
        spentSpan.removeAttribute('title');
    }

    if (spentSpan.dataset.hoverBound === 'true') return;
    spentSpan.dataset.hoverBound = 'true';

    spentSpan.addEventListener('mouseenter', () => {
        const list = spentSpan._lastEntries || [];
        if (list.length === 0) return;

        let pop = document.getElementById('std-spent-popover');
        if (!pop) {
            pop = document.createElement('div');
            pop.id = 'std-spent-popover';
            pop.className = 'std-spent-popover hidden';
            document.body.appendChild(pop);
        }

        pop.textContent = '';
        const headerDiv = document.createElement('div');
        headerDiv.className = 'std-spent-popover-header';
        headerDiv.textContent = chrome.i18n.getMessage('std_spent_last_entries_title') || 'Temps pass\u00e9 (5 derniers pointages) :';
        pop.appendChild(headerDiv);

        list.forEach(item => {
            const row = document.createElement('div');
            row.className = 'std-spent-popover-row';

            const leftSpan = document.createElement('span');
            leftSpan.className = 'std-spent-popover-left';
            leftSpan.textContent = `\u2022 ${item.dateShort} | ${item.desc}`;

            const rightSpan = document.createElement('span');
            rightSpan.className = 'std-spent-popover-right';
            rightSpan.textContent = `| ${item.durStr}`;

            row.appendChild(leftSpan);
            row.appendChild(rightSpan);
            pop.appendChild(row);
        });

        pop.classList.remove('hidden');
        const rect = spentSpan.getBoundingClientRect();
        const popRect = pop.getBoundingClientRect();
        let left = rect.left;
        const maxLeft = Math.max(8, window.innerWidth - popRect.width - 8);
        if (left > maxLeft) left = maxLeft;
        pop.style.left = `${Math.max(8, left)}px`;
        pop.style.top = `${rect.bottom + 4}px`;
    });

    spentSpan.addEventListener('mouseleave', () => {
        const pop = document.getElementById('std-spent-popover');
        if (pop) pop.classList.add('hidden');
    });
}

/**
 * Affiche "- libellé | ⏳ Tps prévu | ⏱️ Tps passé | ↗" dans un conteneur inline.
 * @param {HTMLElement|null} container
 * @param {string} titleText
 * @param {number} plannedSec
 * @param {number} spentSec
 * @param {Array<Object>} [tasksForTooltip]
 * @param {string} [targetUrl]
 */
function renderInlineStats(container, titleText, plannedSec, spentSec, tasksForTooltip = [], targetUrl = '') {
    if (!container) return;
    container.innerHTML = '';
    if (!titleText && !plannedSec && !spentSec) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');

    const openTitle = chrome.i18n.getMessage('time_card_open_doli_title') || 'Ouvrir dans Dolibarr';

    const titleSpan = document.createElement(targetUrl ? 'a' : 'span');
    titleSpan.className = targetUrl ? 'std-stat-title is-link' : 'std-stat-title';
    titleSpan.textContent = `- ${titleText || ''}`;
    titleSpan.title = targetUrl ? `${titleText || ''} — ${openTitle}` : (titleText || '');
    if (targetUrl) {
        titleSpan.href = '#';
        titleSpan.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            chrome.tabs.create({ url: targetUrl });
        });
    }
    container.appendChild(titleSpan);

    const sep1 = document.createElement('span');
    sep1.className = 'std-stat-sep';
    sep1.textContent = '|';
    container.appendChild(sep1);

    const plannedSpan = document.createElement('span');
    plannedSpan.className = 'std-stat-item is-planned';
    plannedSpan.title = chrome.i18n.getMessage('std_planned_time_title') || 'Temps pr\u00e9vu';
    plannedSpan.appendChild(createStatIconSvg('planned'));
    const plannedTxt = document.createElement('span');
    plannedTxt.textContent = formatSecToHHMM(plannedSec);
    plannedSpan.appendChild(plannedTxt);
    container.appendChild(plannedSpan);

    const sep2 = document.createElement('span');
    sep2.className = 'std-stat-sep';
    sep2.textContent = '|';
    container.appendChild(sep2);

    const spentSpan = document.createElement('span');
    spentSpan.className = 'std-stat-item is-spent';
    spentSpan.appendChild(createStatIconSvg('spent'));
    const spentTxt = document.createElement('span');
    spentTxt.textContent = formatSecToHHMM(spentSec);
    spentSpan.appendChild(spentTxt);
    attachLastTimespentHover(spentSpan, tasksForTooltip);
    container.appendChild(spentSpan);

    if (targetUrl) {
        const sep3 = document.createElement('span');
        sep3.className = 'std-stat-sep';
        sep3.textContent = '|';
        container.appendChild(sep3);

        const openLink = document.createElement('a');
        openLink.className = 'std-stat-open-link';
        openLink.href = '#';
        openLink.title = openTitle;
        const extSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        extSvg.setAttribute('width', '12');
        extSvg.setAttribute('height', '12');
        extSvg.setAttribute('viewBox', '0 0 24 24');
        extSvg.setAttribute('fill', 'none');
        extSvg.setAttribute('stroke', 'currentColor');
        extSvg.setAttribute('stroke-width', '2');
        extSvg.setAttribute('stroke-linecap', 'round');
        extSvg.setAttribute('stroke-linejoin', 'round');
        const pBox = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pBox.setAttribute('d', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6');
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly.setAttribute('points', '15 3 21 3 21 9');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '10'); line.setAttribute('y1', '14');
        line.setAttribute('x2', '21'); line.setAttribute('y2', '3');
        extSvg.appendChild(pBox);
        extSvg.appendChild(poly);
        extSvg.appendChild(line);
        openLink.appendChild(extSvg);
        openLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            chrome.tabs.create({ url: targetUrl });
        });
        container.appendChild(openLink);
    }
}

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
/**
 * Construit une map { 'YYYY-MM-DD': { presSec, absSec } } a partir de hrTaskLinesCache.
 * @returns {Object}
 */
function buildDailyLoggedMap() {
    const presIds = (profileConfig?.doliHrPresenceTasks || []).map(String);
    const absIds  = (profileConfig?.doliHrAbsenceTasks  || []).map(String);
    const dailyLogged = {};
    const accumulateLines = (taskId, isPresence) => {
        const lines = hrTaskLinesCache[String(taskId)] || [];
        lines.forEach(line => {
            const ts = parseInt(line.timespent_line_datehour || line.timespent_line_date || 0, 10);
            const dur = parseInt(line.timespent_line_duration || 0, 10);
            if (ts > 0 && dur > 0) {
                const dObj = new Date(ts * 1000);
                const dKey = toLocalDateStr(dObj);
                if (!dailyLogged[dKey]) dailyLogged[dKey] = { presSec: 0, absSec: 0 };
                if (isPresence) dailyLogged[dKey].presSec += dur;
                else dailyLogged[dKey].absSec += dur;
            }
        });
    };
    presIds.forEach(id => accumulateLines(id, true));
    absIds.forEach(id => {
        if (!presIds.includes(id)) accumulateLines(id, false);
    });
    return dailyLogged;
}

/**
 * Construit une map { 'YYYY-MM-DD': totalSeconds } du temps cumul\u00e9 point\u00e9 par l'utilisateur courant
 * sur l'ensemble des projets hors projet RH (doliHrProject).
 * @returns {Object<string, number>}
 */
/**
 * Retourne l'ensemble des IDs de projets RH a exclure (projet RH configure + projets RH DoliSIRH detectes).
 * @returns {Set<string>}
 */
function getExcludedHrProjectIds() {
    const ids = new Set();
    if (profileConfig?.doliHrProject) ids.add(String(profileConfig.doliHrProject));
    if (Array.isArray(allLoadedProjects)) {
        allLoadedProjects.forEach(p => {
            if (p && p.id && typeof isDefaultHrProject === 'function' && isDefaultHrProject(p)) {
                ids.add(String(p.id));
            }
        });
    }
    return ids;
}

function buildProjectDailyLoggedMap() {
    const hrProjIds = getExcludedHrProjectIds();
    const hrTaskIds = new Set([
        ...(profileConfig?.doliHrPresenceTasks || []).map(String),
        ...(profileConfig?.doliHrAbsenceTasks || []).map(String)
    ]);
    const dailyProjectSec = {};

    Object.entries(projectTaskLinesCache).forEach(([taskId, entry]) => {
        if (!entry || hrTaskIds.has(String(taskId))) return;
        if (entry.fkProject && hrProjIds.has(String(entry.fkProject))) return;
        const lines = Array.isArray(entry.lines) ? entry.lines : [];
        lines.forEach(line => {
            const ts = parseInt(line.timespent_line_datehour || line.timespent_line_date || 0, 10);
            const dur = parseInt(line.timespent_line_duration || 0, 10);
            if (ts > 0 && dur > 0) {
                const dKey = toLocalDateStr(new Date(ts * 1000));
                dailyProjectSec[dKey] = (dailyProjectSec[dKey] || 0) + dur;
            }
        });
    });

    return dailyProjectSec;
}

/**
 * R\u00e9cup\u00e8re et met en cache les temps point\u00e9s par l'utilisateur courant sur les t\u00e2ches
 * de tous les projets (hors projet RH), puis rafra\u00eechit le s\u00e9lecteur de semaine.
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<void>}
 */
let isFetchingProjectTimespent = false;

async function updateProjectTimespentStats(forceRefresh = false) {
    if (!globalCurrentUserId || !doliUrl || !apiToken) return;
    if (isFetchingProjectTimespent) return;
    if (!forceRefresh && Object.keys(projectTaskLinesCache).length > 0) {
        buildWeekPicker();
        renderStandardProjectHistory();
        return;
    }

    isFetchingProjectTimespent = true;
    const hrProjId = String(profileConfig?.doliHrProject || '');
    const hrTaskIds = new Set([
        ...(profileConfig?.doliHrPresenceTasks || []).map(String),
        ...(profileConfig?.doliHrAbsenceTasks || []).map(String)
    ]);

    const reqHeaders = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) reqHeaders['DOLAPIENTITY'] = doliEntity;

    try {
        const sqlFilter = hrProjId
            ? `(t.duration_effective:>:0) and (t.fk_projet:!=:${hrProjId})`
            : '(t.duration_effective:>:0)';
        let res = await fetchDoli(
            `${doliUrl}/tasks?sqlfilters=${encodeURIComponent(sqlFilter)}&sortfield=t.tms&sortorder=DESC&limit=100&includetimespent=2`,
            { headers: reqHeaders }
        );
        if (!res.ok) {
            res = await fetchDoli(
                `${doliUrl}/tasks?sortfield=t.rowid&sortorder=DESC&limit=100&includetimespent=2`,
                { headers: reqHeaders }
            );
        }
        if (!res.ok) return;

        const data = await res.json();
        const tasks = Array.isArray(data) ? data : [];

        const nonHrTasksWithTime = tasks.filter(t => {
            if (!t || !t.id) return false;
            const tid = String(t.id);
            if (hrTaskIds.has(tid)) return false;
            const fkProj = String(t.fk_project || t.fk_projet || '');
            if (hrProjId && fkProj === hrProjId) return false;
            const durEff = parseInt(t.duration_effective || 0, 10);
            return durEff > 0;
        });

        const tasksMissingLines = [];
        nonHrTasksWithTime.forEach(t => {
            const tid = String(t.id);
            const fkProj = String(t.fk_project || t.fk_projet || '');
            const durEff = parseInt(t.duration_effective || 0, 10);
            if (Array.isArray(t.lines)) {
                const myLines = t.lines.filter(e => String(e.timespent_line_fk_user || '') === String(globalCurrentUserId));
                projectTaskLinesCache[tid] = {
                    taskId: tid,
                    taskRef: decodeHtmlEntities(t.ref || ''),
                    taskLabel: decodeHtmlEntities(t.label || ''),
                    fkProject: fkProj,
                    durationEffective: durEff,
                    lines: myLines
                };
            } else {
                const cached = projectTaskLinesCache[tid];
                if (forceRefresh || !cached || cached.durationEffective !== durEff) {
                    tasksMissingLines.push(t);
                }
            }
        });

        // Fallback uniquement si l'API Dolibarr n'a pas renvoye lines dans /tasks?includetimespent=2 (max 10 taches recentes, par petits lots de 3)
        const limitedFallback = tasksMissingLines.slice(0, 10);
        for (let i = 0; i < limitedFallback.length; i += 3) {
            const batch = limitedFallback.slice(i, i + 3);
            await Promise.all(batch.map(async (t) => {
                const tid = String(t.id);
                const durEff = parseInt(t.duration_effective || 0, 10);
                try {
                    const detailRes = await fetchDoli(`${doliUrl}/tasks/${tid}?includetimespent=2`, { headers: reqHeaders });
                    if (detailRes.ok) {
                        const taskData = await detailRes.json();
                        const fkProj = String(taskData.fk_project || taskData.fk_projet || t.fk_project || t.fk_projet || '');
                        if (hrProjId && fkProj === hrProjId) {
                            delete projectTaskLinesCache[tid];
                            return;
                        }
                        const allLines = Array.isArray(taskData.lines) ? taskData.lines : [];
                        const myLines = allLines.filter(e => String(e.timespent_line_fk_user || '') === String(globalCurrentUserId));
                        projectTaskLinesCache[tid] = {
                            taskId: tid,
                            taskRef: decodeHtmlEntities(taskData.ref || t.ref || ''),
                            taskLabel: decodeHtmlEntities(taskData.label || t.label || ''),
                            fkProject: fkProj,
                            durationEffective: durEff,
                            lines: myLines
                        };
                    }
                } catch (_) {}
            }));
        }

        buildWeekPicker();
        renderStandardProjectHistory();
    } catch (err) {
        console.warn('[ReedCRM] Erreur chargement temps projets hors RH:', err);
    } finally {
        isFetchingProjectTimespent = false;
    }
}

/**
 * Construit les 5 cartes Lu-Ma-Me-Je-Ve de la semaine courante avec la charte graphique Mensuel.
 * - En mode Semaine ('rh') : affiche le temps RH (Pr\u00e9sence/Absence).
 * - En mode Projet ('standard') : affiche le temps cumul\u00e9 point\u00e9 sur les projets hors projet RH.
 */
function buildWeekPicker() {
    const container = document.getElementById('ts-week-days');
    if (!container) return;
    container.innerHTML = '';

    const monday = getMondayOf(selectedDate);
    const DAY_NAMES = ['LUN', 'MAR', 'MER', 'JEU', 'VEN'];
    const DAY_KEYS  = ['lun', 'mar', 'mer', 'jeu', 'ven'];
    const schedule = profileConfig?.doliHrSchedule || {};
    const isProjectMode = currentMode === 'standard';
    const dailyLogged = isProjectMode ? null : buildDailyLoggedMap();
    const projectDailyLogged = isProjectMode ? buildProjectDailyLoggedMap() : null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 5; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        d.setHours(0, 0, 0, 0);

        const dStr = toLocalDateStr(d);
        const isActive = dStr === toLocalDateStr(selectedDate);
        const dayKey = DAY_KEYS[i];
        const schedStr = schedule[dayKey] || '07:00';
        const [sh, sm] = schedStr.split(':').map(v => parseInt(v, 10) || 0);
        const expectedSec = (sh * 3600) + (sm * 60);

        let presSec = 0;
        let absSec = 0;
        let totalDaySec = 0;

        if (isProjectMode) {
            totalDaySec = projectDailyLogged[dStr] || 0;
        } else {
            const loggedObj = dailyLogged[dStr] || { presSec: 0, absSec: 0 };
            presSec = loggedObj.presSec;
            absSec = loggedObj.absSec;
            totalDaySec = presSec + absSec;
        }

        let stateClass = 'cal-day-grey';
        let statusText = '\u00c0 venir';
        if (expectedSec > 0 && totalDaySec === expectedSec) {
            stateClass = 'cal-day-ok';
            statusText = 'OK';
        } else if (isProjectMode && totalDaySec > expectedSec) {
            stateClass = 'cal-day-over';
            const diff = totalDaySec - expectedSec;
            statusText = `+${formatSecToHHMM(diff)}`;
        } else if (!isProjectMode && expectedSec === 0 && totalDaySec > 0) {
            stateClass = 'cal-day-ok';
            statusText = 'OK';
        } else if ((d <= today && expectedSec > 0 && totalDaySec !== expectedSec) || (d > today && totalDaySec > 0 && totalDaySec !== expectedSec)) {
            stateClass = 'cal-day-ko';
            const diff = totalDaySec - expectedSec;
            const sign = diff > 0 ? '+' : '-';
            statusText = `${sign}${formatSecToHHMM(Math.abs(diff))}`;
        }

        let paText = '-';
        let paClass = 'is-none';
        if (isProjectMode) {
            if (totalDaySec > 0) {
                paText = 'P';
                paClass = 'is-p';
            }
        } else {
            if (presSec > 0 && absSec > 0) {
                paText = 'P/A';
                paClass = 'is-pa';
            } else if (presSec > 0) {
                paText = 'P';
                paClass = 'is-p';
            } else if (absSec > 0) {
                paText = 'A';
                paClass = 'is-a';
            }
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `ts-cal-day ${stateClass}`;
        if (isActive) btn.classList.add('is-today');

        const mmStr = String(d.getMonth() + 1).padStart(2, '0');
        const yyyyStr = d.getFullYear();
        const ddStr = String(d.getDate()).padStart(2, '0');

        if (isProjectMode) {
            btn.title = `${DAY_NAMES[i]} ${ddStr}/${mmStr}/${yyyyStr}\nAttendu : ${formatSecToHHMM(expectedSec)}\nPoint\u00e9 projets (hors RH) : ${formatSecToHHMM(totalDaySec)}\nStatut : ${statusText}`;
        } else {
            btn.title = `${DAY_NAMES[i]} ${ddStr}/${mmStr}/${yyyyStr}\nAttendu : ${formatSecToHHMM(expectedSec)}\nPoint\u00e9 : ${formatSecToHHMM(totalDaySec)} (P: ${formatSecToHHMM(presSec)} | A: ${formatSecToHHMM(absSec)})\nStatut : ${statusText}`;
        }

        const topRow = document.createElement('div');
        topRow.className = 'ts-cal-day-top';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'ts-cal-day-name';
        nameSpan.textContent = DAY_NAMES[i];

        const badgeSpan = document.createElement('span');
        badgeSpan.className = `ts-cal-pa-badge ${paClass}`;
        badgeSpan.textContent = paText;

        topRow.appendChild(nameSpan);
        topRow.appendChild(badgeSpan);

        const numSpan = document.createElement('span');
        numSpan.className = 'ts-cal-day-num';
        numSpan.textContent = ddStr;

        const monthSpan = document.createElement('span');
        monthSpan.className = 'ts-cal-day-month';
        monthSpan.textContent = `${mmStr}/${yyyyStr}`;

        const durSpan = document.createElement('span');
        durSpan.className = 'ts-cal-day-dur';
        durSpan.textContent = isProjectMode
            ? formatSecToHHMM(totalDaySec)
            : (stateClass === 'cal-day-grey' ? formatSecToHHMM(expectedSec) : formatSecToHHMM(totalDaySec));

        btn.appendChild(topRow);
        btn.appendChild(numSpan);
        btn.appendChild(monthSpan);
        btn.appendChild(durSpan);

        btn.addEventListener('click', () => {
            selectedDate = new Date(d);
            const dateStr = toLocalDateStr(selectedDate);
            const dateInput = document.getElementById('time-date');
            if (dateInput) dateInput.value = dateStr;
            const dateStdInput = document.getElementById('time-date-std');
            if (dateStdInput) dateStdInput.value = dateStr;
            checkSubmitStatus();
            updateCardsDefaultTime(DAY_KEYS[i]);
            buildWeekPicker();
            renderStandardProjectHistory();
            updateDailyTimespentStats();
        });

        container.appendChild(btn);
    }
}

/**
 * Pr?-remplit le champ temps des cartes RH avec la valeur du planning
 * du profil pour le jour donn?.
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

    if (currentMode === 'standard') {
        if (infoBlock) infoBlock.style.display = 'none';
        if (counterBlock) counterBlock.style.display = 'none';
    } else {
        if (infoBlock) infoBlock.style.display = '';
        if (counterBlock) counterBlock.style.display = currentMode === 'monthly' ? 'none' : '';
    }

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

        span.appendChild(document.createTextNode('attendue : '));
        const defBold = document.createElement('strong');
        defBold.className = 'ts-stat-val';
        defBold.textContent = defaultTime;
        span.appendChild(defBold);

        span.appendChild(document.createTextNode(' | Point\u00e9 : '));
        const logBold = document.createElement('strong');
        logBold.className = 'ts-stat-val';
        logBold.textContent = logged;
        span.appendChild(logBold);

        span.appendChild(document.createTextNode(` | ${stateLabel} : `));
        const stateBold = document.createElement('strong');
        stateBold.className = 'ts-stat-val';
        stateBold.textContent = `${stateVal} - `;
        span.appendChild(stateBold);

        const stSpan = document.createElement('strong');
        stSpan.className = 'ts-stat-status';
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
                    hrTaskLinesCache[String(taskId)] = myLines;
                    
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
        buildWeekPicker();
        renderMonthlyCalendar();

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

/**
 * Formate un total de secondes en H:MM (m?me au-del? de 24h, ex: 154:00).
 * @param {number} sec
 * @returns {string}
 */
function formatSecToHoursTotal(sec) {
    const total = Math.max(0, parseInt(sec, 10) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Construit et met ? jour le calendrier mensuel dynamique (Pr?sent/Absent P/A, Vert OK, Rouge Manque, Gris).
 */
function renderMonthlyCalendar() {
    const grid = document.getElementById('ts-cal-grid');
    const titleEl = document.getElementById('ts-cal-month-title');
    const summaryEl = document.getElementById('ts-cal-month-summary');
    const monthlyHoursTop = document.getElementById('ts-monthly-hours');
    if (!grid) return;

    const months = ['Janvier','F\u00e9vrier','Mars','Avril','Mai','Juin','Juillet','Ao\u00fbt','Septembre','Octobre','Novembre','D\u00e9cembre'];
    const DAY_NAMES = ['LUN', 'MAR', 'MER', 'JEU', 'VEN'];
    const DAY_KEYS  = ['lun', 'mar', 'mer', 'jeu', 'ven'];

    const year = calendarMonthDate.getFullYear();
    const month = calendarMonthDate.getMonth();

    if (titleEl) {
        titleEl.textContent = `${months[month]} ${year}`;
    }

    const schedule = profileConfig?.doliHrSchedule || {};
    const presIds = (profileConfig?.doliHrPresenceTasks || []).map(String);
    const absIds  = (profileConfig?.doliHrAbsenceTasks  || []).map(String);

    // Indexer les temps point?s par date locale YYYY-MM-DD
    const dailyLogged = {};
    const accumulateLines = (taskId, isPresence) => {
        const lines = hrTaskLinesCache[String(taskId)] || [];
        lines.forEach(line => {
            const ts = parseInt(line.timespent_line_datehour || line.timespent_line_date || 0, 10);
            const dur = parseInt(line.timespent_line_duration || 0, 10);
            if (ts > 0 && dur > 0) {
                const dObj = new Date(ts * 1000);
                const dKey = toLocalDateStr(dObj);
                if (!dailyLogged[dKey]) dailyLogged[dKey] = { presSec: 0, absSec: 0 };
                if (isPresence) dailyLogged[dKey].presSec += dur;
                else dailyLogged[dKey].absSec += dur;
            }
        });
    };

    presIds.forEach(id => accumulateLines(id, true));
    absIds.forEach(id => {
        if (!presIds.includes(id)) accumulateLines(id, false);
    });

    // D?terminer le premier lundi et le dernier lundi couvrant les jours ouvr?s du mois
    const firstOfMonth = new Date(year, month, 1);
    let startMonday;
    if (firstOfMonth.getDay() === 6) {
        startMonday = new Date(year, month, 3);
    } else if (firstOfMonth.getDay() === 0) {
        startMonday = new Date(year, month, 2);
    } else {
        startMonday = getMondayOf(firstOfMonth);
    }
    startMonday.setHours(0, 0, 0, 0);

    const lastOfMonth = new Date(year, month + 1, 0);
    let endMonday = getMondayOf(lastOfMonth);
    if (lastOfMonth.getDay() === 6 || lastOfMonth.getDay() === 0) {
        // La semaine se termine avant le week-end
    }
    endMonday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = toLocalDateStr(today);

    grid.innerHTML = '';

    let monthExpectedSec = 0;
    let monthLoggedSec = 0;

    const curWeekMonday = new Date(startMonday);
    while (curWeekMonday <= endMonday) {
        const weekRow = document.createElement('div');
        weekRow.className = 'ts-cal-week-row';

        for (let i = 0; i < 5; i++) {
            const d = new Date(curWeekMonday);
            d.setDate(curWeekMonday.getDate() + i);
            d.setHours(0, 0, 0, 0);

            const dStr = toLocalDateStr(d);
            const isCurrentMonth = d.getMonth() === month && d.getFullYear() === year;
            const isToday = dStr === todayStr;

            const dayKey = DAY_KEYS[i];
            const schedStr = schedule[dayKey] || '07:00';
            const [sh, sm] = schedStr.split(':').map(v => parseInt(v, 10) || 0);
            const expectedSec = (sh * 3600) + (sm * 60);

            const loggedObj = dailyLogged[dStr] || { presSec: 0, absSec: 0 };
            const presSec = loggedObj.presSec;
            const absSec = loggedObj.absSec;
            const totalDaySec = presSec + absSec;

            if (isCurrentMonth) {
                monthExpectedSec += expectedSec;
                monthLoggedSec += totalDaySec;
            }

            // Statut couleur : Vert (OK), Rouge (Manque / ?cart), Gris (? venir / 0h)
            let stateClass = 'cal-day-grey';
            let statusText = '\u00c0 venir';
            if ((expectedSec > 0 && totalDaySec === expectedSec) || (expectedSec === 0 && totalDaySec > 0)) {
                stateClass = 'cal-day-ok';
                statusText = 'OK';
            } else if ((d <= today && expectedSec > 0 && totalDaySec !== expectedSec) || (d > today && totalDaySec > 0 && totalDaySec !== expectedSec)) {
                stateClass = 'cal-day-ko';
                const diff = totalDaySec - expectedSec;
                const sign = diff > 0 ? '+' : '-';
                statusText = `${sign}${formatSecToHHMM(Math.abs(diff))}`;
            }

            // Badge P / A
            let paText = '-';
            let paClass = 'is-none';
            if (presSec > 0 && absSec > 0) {
                paText = 'P/A';
                paClass = 'is-pa';
            } else if (presSec > 0) {
                paText = 'P';
                paClass = 'is-p';
            } else if (absSec > 0) {
                paText = 'A';
                paClass = 'is-a';
            }

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `ts-cal-day ${stateClass}`;
            if (!isCurrentMonth) btn.classList.add('is-outside-month');
            if (isToday) btn.classList.add('is-today');

            const mmStr = String(d.getMonth() + 1).padStart(2, '0');
            const yyyyStr = d.getFullYear();
            const ddStr = String(d.getDate()).padStart(2, '0');

            btn.title = `${DAY_NAMES[i]} ${ddStr}/${mmStr}/${yyyyStr}\nAttendu : ${formatSecToHHMM(expectedSec)}\nPoint\u00e9 : ${formatSecToHHMM(totalDaySec)} (P: ${formatSecToHHMM(presSec)} | A: ${formatSecToHHMM(absSec)})\nStatut : ${statusText}`;

            // Ligne haut : Nom du jour + Badge P/A
            const topRow = document.createElement('div');
            topRow.className = 'ts-cal-day-top';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'ts-cal-day-name';
            nameSpan.textContent = DAY_NAMES[i];

            const badgeSpan = document.createElement('span');
            badgeSpan.className = `ts-cal-pa-badge ${paClass}`;
            badgeSpan.textContent = paText;

            topRow.appendChild(nameSpan);
            topRow.appendChild(badgeSpan);

            // Num?ro du jour
            const numSpan = document.createElement('span');
            numSpan.className = 'ts-cal-day-num';
            numSpan.textContent = ddStr;

            // Mois/Ann?e
            const monthSpan = document.createElement('span');
            monthSpan.className = 'ts-cal-day-month';
            monthSpan.textContent = `${mmStr}/${yyyyStr}`;

            // Dur?e point?e / attendue
            const durSpan = document.createElement('span');
            durSpan.className = 'ts-cal-day-dur';
            durSpan.textContent = stateClass === 'cal-day-grey' ? formatSecToHHMM(expectedSec) : formatSecToHHMM(totalDaySec);

            btn.appendChild(topRow);
            btn.appendChild(numSpan);
            btn.appendChild(monthSpan);
            btn.appendChild(durSpan);

            // Clic sur un jour -> ouvre ce jour dans l'onglet Pr?sence journalier
            btn.addEventListener('click', () => {
                selectedDate = new Date(d);
                const dateStrVal = toLocalDateStr(selectedDate);
                const dateInput = document.getElementById('time-date');
                if (dateInput) dateInput.value = dateStrVal;
                const dateStdInput = document.getElementById('time-date-std');
                if (dateStdInput) dateStdInput.value = dateStrVal;
                updateCardsDefaultTime(dayKey);
                buildWeekPicker();
                updateHrProjectInfo();
                updateDailyTimespentStats();
                const btnRh = document.getElementById('btn-mode-rh');
                if (btnRh) btnRh.click();
            });

            weekRow.appendChild(btn);
        }

        grid.appendChild(weekRow);
        curWeekMonday.setDate(curWeekMonday.getDate() + 7);
    }

    const loggedMonthStr = formatSecToHoursTotal(monthLoggedSec);
    const expectedMonthStr = formatSecToHoursTotal(monthExpectedSec);

    if (summaryEl) {
        summaryEl.textContent = `Point\u00e9 : ${loggedMonthStr} / Attendu : ${expectedMonthStr}`;
    }
    if (monthlyHoursTop && selectedDate.getMonth() === month && selectedDate.getFullYear() === year) {
        monthlyHoursTop.textContent = `${loggedMonthStr} / ${expectedMonthStr}`;
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
                    globalCurrentUserInitials = extractUserInitials(userInfo);
                    if (globalCurrentUserId && globalCurrentUserInitials) {
                        usersInitialsMap[globalCurrentUserId] = globalCurrentUserInitials;
                    }
                    updateDailyTimespentStats();
                    updateProjectTimespentStats();
                }
            } catch(_) {}
        })();
    } else {
        updateDailyTimespentStats();
        updateProjectTimespentStats();
    }

    const setupContainer = document.getElementById('timesheet-setup-container');
    const mainContainer = document.getElementById('timesheet-main-container');

    const preferredMode = profileConfig?.doliDefaultMode || 'rh';
    if ((!profileConfig || !profileConfig.doliHrProject) && preferredMode === 'rh') {
        if (setupContainer) setupContainer.classList.remove('hidden');
        if (mainContainer) mainContainer.classList.add('hidden');
        loadSetupProjects();
    } else {
        if (setupContainer) setupContainer.classList.add('hidden');
        if (mainContainer) mainContainer.classList.remove('hidden');
        loadStandardProjects();
        if (profileConfig && profileConfig.doliHrProject) {
            buildHrUi();
        }
    }

    // Initialiser la date d'aujourd'hui
    selectedDate = new Date();
    const todayStr = toLocalDateStr(selectedDate);
    const dateInput = document.getElementById('time-date');
    if (dateInput) dateInput.value = todayStr;
    const dateStdInput = document.getElementById('time-date-std');
    if (dateStdInput) dateStdInput.value = todayStr;
    const durationStdInput = document.getElementById('time-duration-std');
    if (durationStdInput && !durationStdInput.value) durationStdInput.value = '00:15';

    // Construire le picker de semaine
    buildWeekPicker();
    updateHrProjectInfo();

    // Navigation semaine précédente / suivante
    document.getElementById('ts-week-prev')?.addEventListener('click', () => {
        selectedDate.setDate(selectedDate.getDate() - 7);
        const dStr = toLocalDateStr(selectedDate);
        if (dateInput) dateInput.value = dStr;
        if (dateStdInput) dateStdInput.value = dStr;
        buildWeekPicker();
        renderStandardProjectHistory();
        updateHrProjectInfo();
        updateDailyTimespentStats();
    });
    document.getElementById('ts-week-next')?.addEventListener('click', () => {
        selectedDate.setDate(selectedDate.getDate() + 7);
        const dStr = toLocalDateStr(selectedDate);
        if (dateInput) dateInput.value = dStr;
        if (dateStdInput) dateStdInput.value = dStr;
        buildWeekPicker();
        renderStandardProjectHistory();
        updateHrProjectInfo();
        updateDailyTimespentStats();
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

    // Navigation mois precedent / suivant dans la vue mensuelle
    calendarMonthDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    document.getElementById('ts-cal-prev')?.addEventListener('click', () => {
        calendarMonthDate = new Date(calendarMonthDate.getFullYear(), calendarMonthDate.getMonth() - 1, 1);
        renderMonthlyCalendar();
    });
    document.getElementById('ts-cal-next')?.addEventListener('click', () => {
        calendarMonthDate = new Date(calendarMonthDate.getFullYear(), calendarMonthDate.getMonth() + 1, 1);
        renderMonthlyCalendar();
    });

    // Tabs mode Projet / Presence (Jour) / Presence (Mois)
    const btnStandard = document.getElementById('btn-mode-standard');
    const btnRh = document.getElementById('btn-mode-rh');
    const btnMonthly = document.getElementById('btn-mode-monthly');
    const modeStandard = document.getElementById('timesheet-mode-standard');
    const modeRh = document.getElementById('timesheet-mode-rh');
    const modeMonthly = document.getElementById('timesheet-mode-monthly');
    const weekNav = document.getElementById('ts-week-nav');

    if (btnStandard && btnRh) {
        btnRh.addEventListener('click', () => {
            currentMode = 'rh';
            btnRh.classList.add('ts-tab-active');
            btnStandard.classList.remove('ts-tab-active');
            btnMonthly?.classList.remove('ts-tab-active');
            modeRh.classList.remove('hidden');
            modeStandard.classList.add('hidden');
            modeMonthly?.classList.add('hidden');
            weekNav?.classList.remove('hidden');
            document.getElementById('ts-hr-project-info')?.style.setProperty('display', '');
            document.getElementById('ts-monthly-counter')?.style.setProperty('display', '');
            buildWeekPicker();
            checkSubmitStatus();
            buildHrUi();
        });

        btnStandard.addEventListener('click', () => {
            currentMode = 'standard';
            btnStandard.classList.add('ts-tab-active');
            btnRh.classList.remove('ts-tab-active');
            btnMonthly?.classList.remove('ts-tab-active');
            modeStandard.classList.remove('hidden');
            modeRh.classList.add('hidden');
            modeMonthly?.classList.add('hidden');
            weekNav?.classList.remove('hidden');
            document.getElementById('ts-hr-project-info')?.style.setProperty('display', 'none');
            document.getElementById('ts-monthly-counter')?.style.setProperty('display', 'none');
            buildWeekPicker();
            updateProjectTimespentStats();
            checkSubmitStatus();
        });

        btnMonthly?.addEventListener('click', () => {
            currentMode = 'monthly';
            btnMonthly.classList.add('ts-tab-active');
            btnRh.classList.remove('ts-tab-active');
            btnStandard.classList.remove('ts-tab-active');
            modeMonthly?.classList.remove('hidden');
            modeRh.classList.add('hidden');
            modeStandard.classList.add('hidden');
            weekNav?.classList.add('hidden');
            document.getElementById('ts-hr-project-info')?.style.setProperty('display', '');
            document.getElementById('ts-monthly-counter')?.style.setProperty('display', 'none');
            calendarMonthDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
            renderMonthlyCalendar();
            updateDailyTimespentStats();
        });
    }

    // Activer le mode configuré à l'ouverture (par défaut RH si projet RH configuré)
    // Activer le mode configure a l'ouverture (par defaut RH si projet RH configure)
    const defaultMode = profileConfig?.doliDefaultMode || 'rh';
    if (defaultMode === 'monthly' && profileConfig && profileConfig.doliHrProject) {
        currentMode = 'monthly';
        btnMonthly?.classList.add('ts-tab-active');
        btnRh?.classList.remove('ts-tab-active');
        btnStandard?.classList.remove('ts-tab-active');
        modeMonthly?.classList.remove('hidden');
        modeRh?.classList.add('hidden');
        modeStandard?.classList.add('hidden');
        weekNav?.classList.add('hidden');
        document.getElementById('ts-hr-project-info')?.style.setProperty('display', '');
        document.getElementById('ts-monthly-counter')?.style.setProperty('display', 'none');
        renderMonthlyCalendar();
    } else if (defaultMode === 'rh' && profileConfig && profileConfig.doliHrProject) {
        currentMode = 'rh';
        btnRh?.classList.add('ts-tab-active');
        btnStandard?.classList.remove('ts-tab-active');
        btnMonthly?.classList.remove('ts-tab-active');
        modeRh?.classList.remove('hidden');
        modeStandard?.classList.add('hidden');
        modeMonthly?.classList.add('hidden');
        weekNav?.classList.remove('hidden');
    } else {
        currentMode = 'standard';
        btnStandard?.classList.add('ts-tab-active');
        btnRh?.classList.remove('ts-tab-active');
        btnMonthly?.classList.remove('ts-tab-active');
        modeStandard?.classList.remove('hidden');
        modeRh?.classList.add('hidden');
        modeMonthly?.classList.add('hidden');
        weekNav?.classList.remove('hidden');
        document.getElementById('ts-hr-project-info')?.style.setProperty('display', 'none');
        document.getElementById('ts-monthly-counter')?.style.setProperty('display', 'none');
        buildWeekPicker();
    }

    const projSelect = document.getElementById('time-project');
    if (projSelect) {
        projSelect.addEventListener('change', (e) => {
            loadStandardTasks(e.target.value);
            checkSubmitStatus();
        });
    }

    const taskSelect = document.getElementById('time-task');
    if (taskSelect) {
        taskSelect.addEventListener('change', (e) => {
            updateSelectedTaskStats(e.target.value);
            checkSubmitStatus();
        });
    }

    const durationInput = document.getElementById('time-duration-std') || document.getElementById('time-duration');
    if (durationInput) durationInput.addEventListener('input', checkSubmitStatus);

    const noteStdInput = document.getElementById('time-note-std');
    if (noteStdInput) noteStdInput.addEventListener('input', checkSubmitStatus);

    const dateStdEl = document.getElementById('time-date-std');
    if (dateStdEl) {
        dateStdEl.addEventListener('input', () => {
            if (dateStdEl.value) {
                selectedDate = new Date(dateStdEl.value + 'T00:00:00');
                const hiddenDate = document.getElementById('time-date');
                if (hiddenDate) hiddenDate.value = dateStdEl.value;
                buildWeekPicker();
                renderStandardProjectHistory();
            }
            checkSubmitStatus();
        });
    }

    const btnCreateSpj = document.getElementById('btn-create-spj-task');
    if (btnCreateSpj) btnCreateSpj.addEventListener('click', handleCreateSpjTaskClick);

    const btnSubmit = document.getElementById('btn-submit-time-std') || document.getElementById('btn-submit-time');
    if (btnSubmit) btnSubmit.addEventListener('click', submitTime);
}


function checkSubmitStatus() {
    const btnSubmit = document.getElementById('btn-submit-time-std') || document.getElementById('btn-submit-time');
    if (!btnSubmit) return;

    const requireNote = profileConfig?.doliRequireNote !== undefined ? Boolean(profileConfig.doliRequireNote) : true;
    const reqStar = document.getElementById('std-note-req-star');
    if (reqStar) {
        reqStar.style.display = requireNote ? 'inline' : 'none';
    }

    let isValid = false;
    const duration = (document.getElementById('time-duration-std') || document.getElementById('time-duration'))?.value;
    const date = (document.getElementById('time-date-std') || document.getElementById('time-date'))?.value;
    const noteVal = (document.getElementById('time-note-std') || document.getElementById('time-note'))?.value?.trim() || '';
    
    if (duration && date) {
        if (currentMode === 'standard') {
            const task = document.getElementById('time-task')?.value;
            const noteOk = !requireNote || noteVal.length > 0;
            if (task && task !== '' && noteOk) isValid = true;
        } else {
            if (selectedHrTask) isValid = true;
        }
    }

    btnSubmit.disabled = !isValid;
}

/**
 * Met à jour les statistiques inline de la tâche sélectionnée.
 * @param {string|number} taskId
 */
function updateSelectedTaskStats(taskId) {
    const taskStatsEl = document.getElementById('std-task-stats');
    if (!taskId || !standardTasksMap[String(taskId)]) {
        if (taskStatsEl) {
            taskStatsEl.innerHTML = '';
            taskStatsEl.classList.add('hidden');
        }
        return;
    }
    const t = standardTasksMap[String(taskId)];
    const planned = parseInt(t.planned_workload || 0, 10);
    const spent = parseInt(t.duration_effective || 0, 10);
    const baseUrl = doliUrl.replace(/\/api\/index\.php\/?$/i, '');
    const taskUrl = `${baseUrl}/projet/tasks/task.php?id=${encodeURIComponent(taskId)}`;
    renderInlineStats(taskStatsEl, t.label || t.ref || '', planned, spent, [t], taskUrl);
}

/**
 * Infere le nom d'une entite a partir des titres de ses projets (ex: "Accident - societe 3" -> "societe 3").
 * @param {Array<Object>} entityProjects
 * @returns {string}
 */
function inferEntityLabelFromProjects(entityProjects) {
    if (!Array.isArray(entityProjects) || entityProjects.length === 0) return '';
    const counts = {};
    entityProjects.forEach(p => {
        const title = decodeHtmlEntities(p.title || '');
        if (title.includes(' - ')) {
            const suffix = title.split(' - ').pop().trim();
            if (suffix && suffix.length >= 2) {
                counts[suffix] = (counts[suffix] || 0) + 1;
            }
        }
    });
    let bestSuffix = '';
    let bestCount = 0;
    for (const [sfx, cnt] of Object.entries(counts)) {
        if (cnt > bestCount) {
            bestCount = cnt;
            bestSuffix = sfx;
        }
    }
    return bestSuffix;
}

/**
 * Sauvegarde l'entite active dans le profil courant (chrome.storage.sync).
 * @param {string} newEntityId
 */
function persistActiveEntity(newEntityId) {
    if (profileConfig) {
        profileConfig.doliEntity = String(newEntityId);
    }
    try {
        chrome.storage.sync.get(['doliProfiles', 'doliActiveProfileId'], (items) => {
            if (chrome.runtime.lastError) return;
            const profiles = items.doliProfiles || [];
            const activeId = items.doliActiveProfileId;
            const idx = profiles.findIndex(pr => pr.id === activeId);
            if (idx !== -1) {
                profiles[idx].doliEntity = String(newEntityId);
                chrome.storage.sync.set({ doliProfiles: profiles });
            }
        });
    } catch (_) {}
}

/**
 * Filtre et affiche uniquement les projets de l'entite active dans #time-project.
 */
function renderProjectsForActiveEntity() {
    const select = document.getElementById('time-project');
    if (!select) return;

    const activeEnt = String(doliEntity || '1');
    const filtered = allLoadedProjects.filter(p => String(p.entity || '1') === activeEnt && String(p.statut ?? p.fk_statut ?? p.status ?? '1') === '1');

    select.innerHTML = '<option value="">S\u00e9lectionner un projet</option>';
    standardProjectsMap = {};

    filtered.forEach(p => {
        const cleanTitle = decodeHtmlEntities(p.title || '');
        const cleanRef = decodeHtmlEntities(p.ref || '');
        const normalizedProj = { ...p, title: cleanTitle, ref: cleanRef };
        standardProjectsMap[String(p.id)] = normalizedProj;

        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${cleanRef} - ${cleanTitle}`;
        select.appendChild(opt);
    });

    if (!window.timeProjectSelect) {
        window.timeProjectSelect = new CustomSelect(select);
    } else {
        window.timeProjectSelect.update();
    }
}

/**
 * Decouvre les entites disponibles, alimente le selecteur #doli-active-entity en haut,
 * et charge les projets sans melanger les entites.
 * @returns {Promise<void>}
 */
async function loadStandardProjects() {
    const select = document.getElementById('time-project');
    const entitySelect = document.getElementById('doli-active-entity');
    if (!select) return;

    const baseHeaders = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };

    try {
        const requests = [
            fetchDoli(`${doliUrl}/projects?sqlfilters=(t.fk_statut:=:1)&limit=10000&sortfield=t.rowid&sortorder=DESC`, { headers: baseHeaders })
        ];
        if (doliEntity && String(doliEntity) !== '1') {
            requests.push(
                fetchDoli(`${doliUrl}/projects?sqlfilters=(t.fk_statut:=:1)&limit=10000&sortfield=t.rowid&sortorder=DESC`, {
                    headers: { ...baseHeaders, 'DOLAPIENTITY': String(doliEntity) }
                })
            );
        }

        const responses = await Promise.all(requests);
        const byId = new Map();
        for (const r of responses) {
            if (r && r.ok) {
                const list = await r.json();
                if (Array.isArray(list)) {
                    list.forEach(p => {
                        if (p && p.id) byId.set(String(p.id), p);
                    });
                }
            }
        }
        allLoadedProjects = Array.from(byId.values());

        // Collecter les IDs d'entites distincts presents dans les projets
        const entityIdsSet = new Set();
        allLoadedProjects.forEach(p => {
            entityIdsSet.add(String(p.entity || '1'));
        });
        if (doliEntity) entityIdsSet.add(String(doliEntity));
        if (entityIdsSet.size === 0) entityIdsSet.add('1');

        // Tenter de recuperer les noms officiels via /multicompany (si module API active)
        try {
            const mcRes = await fetchDoli(`${doliUrl}/multicompany`, { headers: baseHeaders });
            if (mcRes.ok) {
                const mcData = await mcRes.json();
                if (Array.isArray(mcData)) {
                    mcData.forEach(ent => {
                        const eid = String(ent.id || ent.rowid || '');
                        const elabel = decodeHtmlEntities(ent.label || ent.name || '');
                        if (eid) {
                            entityIdsSet.add(eid);
                            if (elabel) entitiesLabelMap[eid] = elabel;
                        }
                    });
                }
            }
        } catch (_) {}

        const sortedEntityIds = Array.from(entityIdsSet).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

        // Resoudre le nom de chaque entite via /setup/company (avec DOLAPIENTITY) et/ou suffixe des projets
        const companyNamesByEntity = {};
        await Promise.all(sortedEntityIds.map(async (eid) => {
            if (entitiesLabelMap[eid]) return;
            try {
                const compRes = await fetchDoli(`${doliUrl}/setup/company`, {
                    headers: { ...baseHeaders, 'DOLAPIENTITY': eid }
                });
                if (compRes.ok) {
                    const compData = await compRes.json();
                    if (compData && compData.name) {
                        companyNamesByEntity[eid] = decodeHtmlEntities(String(compData.name).trim());
                    }
                }
            } catch (_) {}
        }));

        const uniqueCompNames = new Set(Object.values(companyNamesByEntity).filter(Boolean));
        const companyEndpointIsEntityAware = uniqueCompNames.size > 1 || sortedEntityIds.length === 1;

        sortedEntityIds.forEach(eid => {
            if (entitiesLabelMap[eid]) return;
            const projsForEnt = allLoadedProjects.filter(p => String(p.entity || '1') === eid);
            const inferred = inferEntityLabelFromProjects(projsForEnt);
            const compName = companyNamesByEntity[eid] || '';

            if (companyEndpointIsEntityAware && compName) {
                entitiesLabelMap[eid] = compName;
            } else if (inferred) {
                entitiesLabelMap[eid] = inferred;
            } else if (compName && eid === '1') {
                entitiesLabelMap[eid] = compName;
            } else {
                entitiesLabelMap[eid] = `Entit\u00e9 ${eid}`;
            }
        });

        // Determiner l'entite active par defaut si non definie ou absente
        if (!doliEntity || !sortedEntityIds.includes(String(doliEntity))) {
            doliEntity = sortedEntityIds[0] || '1';
            persistActiveEntity(doliEntity);
        }

        // Alimenter et afficher le selecteur d'entite #doli-active-entity en haut
        if (entitySelect) {
            entitySelect.innerHTML = '';
            sortedEntityIds.forEach(eid => {
                const opt = document.createElement('option');
                opt.value = eid;
                opt.textContent = entitiesLabelMap[eid] || `Entit\u00e9 ${eid}`;
                if (String(eid) === String(doliEntity)) opt.selected = true;
                entitySelect.appendChild(opt);
            });
            entitySelect.classList.remove('hidden');

            if (!entitySelect.dataset.listenerBound) {
                entitySelect.dataset.listenerBound = 'true';
                entitySelect.addEventListener('change', async (e) => {
                    doliEntity = String(e.target.value || '1');
                    persistActiveEntity(doliEntity);

                    try {
                        const entRes = await fetchDoli(`${doliUrl}/projects?sqlfilters=(t.fk_statut:=:1)&limit=10000&sortfield=t.rowid&sortorder=DESC`, {
                            headers: { ...baseHeaders, 'DOLAPIENTITY': doliEntity }
                        });
                        if (entRes.ok) {
                            const entList = await entRes.json();
                            if (Array.isArray(entList)) {
                                const map = new Map(allLoadedProjects.map(p => [String(p.id), p]));
                                entList.forEach(p => { if (p && p.id) map.set(String(p.id), p); });
                                allLoadedProjects = Array.from(map.values());
                            }
                        }
                    } catch (_) {}

                    projectTaskLinesCache = {};
                    renderProjectsForActiveEntity();
                    loadStandardTasks('');
                    updateProjectTimespentStats(true);
                });
            }
        }

        // Afficher uniquement les projets de l'entite selectionnee
        renderProjectsForActiveEntity();
        buildWeekPicker();
        renderStandardProjectHistory();
    } catch (e) {
        console.error('Error fetching standard projects', e);
    }
}

/**
 * Cr\u00e9e \u00e0 la vol\u00e9e la t\u00e2che SPJ_<libell\u00e9 du projet> dans Dolibarr si le projet n'a aucune t\u00e2che.
 * @param {string|number} projectId
 * @param {string} spjLabel
 * @param {Object} headers
 * @returns {Promise<Object|null>}
 */
async function createDefaultSpjTask(projectId, spjLabel, headers) {
    try {
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const rand = String(Math.floor(1000 + Math.random() * 9000));
        const fallbackRef = `TK${yy}${mm}-${rand}`;

        const postHeaders = { ...headers, 'Content-Type': 'application/json' };
        const createRes = await fetchDoli(`${doliUrl}/tasks`, {
            method: 'POST',
            headers: postHeaders,
            body: JSON.stringify({
                fk_project: parseInt(projectId, 10),
                fk_projet: parseInt(projectId, 10),
                entity: parseInt(doliEntity || '1', 10),
                ref: fallbackRef,
                label: spjLabel,
                date_start: Math.floor(now.getTime() / 1000),
                progress: 0
            })
        });

        if (createRes.ok) {
            const newIdRaw = await createRes.json();
            const newId = (newIdRaw && typeof newIdRaw === 'object') ? (newIdRaw.id || newIdRaw.rowid) : newIdRaw;
            if (newId) {
                const detailRes = await fetchDoli(`${doliUrl}/tasks/${newId}`, { headers });
                if (detailRes.ok) {
                    const detailData = await detailRes.json();
                    if (detailData && detailData.id) return detailData;
                }
                return { id: String(newId), ref: fallbackRef, label: spjLabel, planned_workload: 0, duration_effective: 0 };
            }
        }
    } catch (err) {
        console.warn('Erreur création automatique tâche SPJ:', err);
    }
    return null;
}

/**
 * D?termine si une t?che correspond ? la t?che par d?faut SPJ_ du projet.
 * @param {Object} t
 * @param {string} [spjTargetLabel]
 * @returns {boolean}
 */
function isSpjTask(t, spjTargetLabel = '') {
    if (!t) return false;
    const lbl = String(t.label || '').trim().toUpperCase();
    const ref = String(t.ref || '').trim().toUpperCase();
    const target = String(spjTargetLabel || '').trim().toUpperCase();
    if (target && lbl === target) return true;
    if (lbl.startsWith('SPJ_') || lbl.startsWith('SPJ ') || lbl.startsWith('SPJ-') || lbl.includes('SPJ_') || ref.startsWith('SPJ_')) {
        return true;
    }
    return false;
}

/**
 * Retourne les options du CustomSelect pour le selecteur de tache (#time-task) avec creation a la volee.
 * @returns {Object}
 */
function getTaskCustomSelectOptions() {
    return {
        onCreate: handleCreateCustomTaskFromSearch,
        createButtonTitle: chrome.i18n.getMessage('std_create_custom_task_btn_title') || 'Cr\u00e9er la t\u00e2che'
    };
}

/**
 * Cr\u00e9e une nouvelle t\u00e2che sur le projet s\u00e9lectionn\u00e9 \u00e0 partir du texte saisi dans la recherche de t\u00e2che,
 * puis la s\u00e9lectionne automatiquement.
 * @param {string} rawTaskLabel
 * @returns {Promise<void>}
 */
async function handleCreateCustomTaskFromSearch(rawTaskLabel) {
    const projectId = document.getElementById('time-project')?.value;
    const select = document.getElementById('time-task');
    const statusDiv = document.getElementById('time-status-std');
    const cleanLabel = (rawTaskLabel || '').trim();
    if (!projectId || !select || !cleanLabel) return;

    const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    try {
        const createdTask = await createDefaultSpjTask(projectId, cleanLabel, headers);
        if (createdTask && createdTask.id) {
            createdTask.label = decodeHtmlEntities(createdTask.label || cleanLabel);
            createdTask.ref = decodeHtmlEntities(createdTask.ref || '');
            standardTasksMap[String(createdTask.id)] = createdTask;

            const opt = document.createElement('option');
            opt.value = createdTask.id;
            opt.textContent = `${createdTask.ref ? createdTask.ref + ' - ' : ''}${createdTask.label}`;
            select.appendChild(opt);
            select.disabled = false;

            const proj = standardProjectsMap[String(projectId)];
            const projTitle = proj ? (proj.title || proj.ref || '') : '';
            const spjTargetLabel = `SPJ_${projTitle}`;
            const btnCreateSpj = document.getElementById('btn-create-spj-task');
            if (btnCreateSpj && isSpjTask(createdTask, spjTargetLabel)) {
                btnCreateSpj.disabled = true;
                btnCreateSpj.title = chrome.i18n.getMessage('std_spj_already_exists_title') || 'La t\u00e2che SPJ_ existe d\u00e9j\u00e0 sur ce projet';
            }

            selectStandardTaskById(createdTask.id);
        } else if (statusDiv) {
            statusDiv.style.color = '#e74c3c';
            statusDiv.textContent = chrome.i18n.getMessage('std_spj_create_error') || 'Erreur lors de la cr\u00e9ation de la t\u00e2che';
        }
    } catch (err) {
        console.warn('Erreur cr\u00e9ation t\u00e2che depuis la recherche:', err);
    }
}

/**
 * S?lectionne une t?che dans le select standard et met ? jour le CustomSelect + statistiques.
 * @param {string|number} taskId
 */
function selectStandardTaskById(taskId) {
    const select = document.getElementById('time-task');
    if (!select) return;
    const targetVal = String(taskId || '');
    let matchedIndex = 0;

    Array.from(select.options).forEach((opt, idx) => {
        const isMatch = targetVal !== '' && String(opt.value) === targetVal;
        opt.selected = isMatch;
        if (isMatch) {
            opt.setAttribute('selected', 'selected');
            matchedIndex = idx;
        } else {
            opt.removeAttribute('selected');
        }
    });

    select.selectedIndex = matchedIndex;
    select.value = matchedIndex > 0 ? targetVal : '';

    if (!window.timeTaskSelect) {
        window.timeTaskSelect = new CustomSelect(select, getTaskCustomSelectOptions());
    } else {
        window.timeTaskSelect.update();
    }

    if (window.timeTaskSelect && window.timeTaskSelect.trigger && select.options[matchedIndex]) {
        const span = window.timeTaskSelect.trigger.querySelector('span');
        if (span) span.textContent = select.options[matchedIndex].textContent;
    }

    updateSelectedTaskStats(select.value);
    checkSubmitStatus();
}

/**
 * Cr?e ? la demande la t?che par d?faut SPJ_<libell? du projet> au clic sur le bouton SPJ_ et la s?lectionne.
 * @returns {Promise<void>}
 */
async function handleCreateSpjTaskClick() {
    const projectId = document.getElementById('time-project')?.value;
    const select = document.getElementById('time-task');
    const btnCreateSpj = document.getElementById('btn-create-spj-task');
    const statusDiv = document.getElementById('time-status-std');
    if (!projectId || !select) return;

    const proj = standardProjectsMap[String(projectId)];
    const projTitle = proj ? (proj.title || proj.ref || '') : String(projectId);
    const spjTargetLabel = `SPJ_${projTitle}`;

    // Si une t?che SPJ_ existe d?j?, la s?lectionner directement
    const existingTask = Object.values(standardTasksMap).find(t => isSpjTask(t, spjTargetLabel));
    if (existingTask) {
        selectStandardTaskById(existingTask.id);
        if (btnCreateSpj) {
            btnCreateSpj.disabled = true;
            btnCreateSpj.title = chrome.i18n.getMessage('std_spj_already_exists_title') || 'La t?che SPJ_ existe d?j? sur ce projet';
        }
        return;
    }

    if (btnCreateSpj) btnCreateSpj.disabled = true;
    const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    try {
        const createdTask = await createDefaultSpjTask(projectId, spjTargetLabel, headers);
        if (createdTask && createdTask.id) {
            standardTasksMap[String(createdTask.id)] = createdTask;
            const opt = document.createElement('option');
            opt.value = createdTask.id;
            opt.textContent = `${createdTask.ref ? createdTask.ref + ' - ' : ''}${createdTask.label}`;
            select.appendChild(opt);
            select.disabled = false;

            selectStandardTaskById(createdTask.id);

            if (btnCreateSpj) {
                btnCreateSpj.disabled = true;
                btnCreateSpj.title = chrome.i18n.getMessage('std_spj_already_exists_title') || 'La t?che SPJ_ existe d?j? sur ce projet';
            }
        } else {
            if (btnCreateSpj) btnCreateSpj.disabled = false;
            if (statusDiv) {
                statusDiv.style.color = '#e74c3c';
                statusDiv.textContent = chrome.i18n.getMessage('std_spj_create_error') || 'Erreur lors de la cr?ation de la t?che SPJ_';
            }
        }
    } catch (err) {
        console.warn('Erreur cr?ation manuelle t?che SPJ:', err);
        if (btnCreateSpj) btnCreateSpj.disabled = false;
    }
}

async function loadStandardTasks(projectId) {
    const select = document.getElementById('time-task');
    const projStatsEl = document.getElementById('std-project-stats');
    const taskStatsEl = document.getElementById('std-task-stats');
    const btnCreateSpj = document.getElementById('btn-create-spj-task');
    if (!select) return;

    select.innerHTML = '<option value="">S\u00e9lectionner une t\u00e2che</option>';
    select.disabled = true;
    standardTasksMap = {};
    if (taskStatsEl) {
        taskStatsEl.innerHTML = '';
        taskStatsEl.classList.add('hidden');
    }
    if (btnCreateSpj) {
        btnCreateSpj.disabled = true;
        btnCreateSpj.title = chrome.i18n.getMessage('std_create_spj_btn_title') || 'Cr\u00e9er la t\u00e2che par d\u00e9faut SPJ_';
    }

    if (!projectId) {
        if (projStatsEl) {
            projStatsEl.innerHTML = '';
            projStatsEl.classList.add('hidden');
        }
        renderStandardProjectHistory();
        if (window.timeTaskSelect) window.timeTaskSelect.update();
        checkSubmitStatus();
        return;
    }

    const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    const proj = standardProjectsMap[String(projectId)];
    const projTitle = proj ? (proj.title || proj.ref || '') : '';
    const spjTargetLabel = `SPJ_${projTitle}`;

    try {
        const res = await fetchDoli(`${doliUrl}/tasks?sqlfilters=(t.fk_projet:=:${projectId})&limit=100&includetimespent=2`, { headers });
        let tasks = [];
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) tasks = data;
        }

        const autoCreateEnabled = profileConfig?.doliAutoCreateSpjTask !== undefined ? Boolean(profileConfig.doliAutoCreateSpjTask) : true;
        const hasSpjTask = tasks.some(t => isSpjTask(t, spjTargetLabel));

        // Si la t?che SPJ_ n'existe pas sur ce projet et que l'option est activ?e, la cr?er automatiquement
        if (!hasSpjTask && autoCreateEnabled && projTitle) {
            const createdTask = await createDefaultSpjTask(projectId, spjTargetLabel, headers);
            if (createdTask) {
                tasks.unshift(createdTask);
            }
        }

        let totalPlanned = 0;
        let totalSpent = 0;
        let preselectedTaskId = '';

        if (tasks.length > 0) {
            tasks.forEach(t => {
                standardTasksMap[String(t.id)] = t;
                totalPlanned += parseInt(t.planned_workload || 0, 10);
                totalSpent += parseInt(t.duration_effective || 0, 10);
                const opt = document.createElement('option');
                opt.value = t.id;
                t.label = decodeHtmlEntities(t.label || '');
                t.ref = decodeHtmlEntities(t.ref || '');
                opt.textContent = `${t.ref ? t.ref + ' - ' : ''}${t.label}`;
                if (!preselectedTaskId && isSpjTask(t, spjTargetLabel)) {
                    preselectedTaskId = String(t.id);
                }
                select.appendChild(opt);
            });
            select.disabled = false;
        }

        // Activer le bouton + SPJ_ uniquement si aucune t?che SPJ_ n'existe encore sur ce projet
        if (btnCreateSpj) {
            if (preselectedTaskId) {
                btnCreateSpj.disabled = true;
                btnCreateSpj.title = chrome.i18n.getMessage('std_spj_already_exists_title') || 'La t\u00e2che SPJ_ existe d\u00e9j\u00e0 sur ce projet';
            } else {
                btnCreateSpj.disabled = false;
                btnCreateSpj.title = `${chrome.i18n.getMessage('std_create_spj_btn_title') || 'Cr\u00e9er la t\u00e2che par d\u00e9faut'} (${spjTargetLabel})`;
            }
        }

        const baseUrl = doliUrl.replace(/\/api\/index\.php\/?$/i, '');
        const projUrl = `${baseUrl}/projet/card.php?id=${encodeURIComponent(projectId)}`;
        renderInlineStats(projStatsEl, projTitle, totalPlanned, totalSpent, Object.values(standardTasksMap), projUrl);
        selectStandardTaskById(preselectedTaskId);
        loadStandardProjectHistory();
    } catch(e) {
        console.error('Error fetching standard tasks', e);
        if (!window.timeTaskSelect) {
            window.timeTaskSelect = new CustomSelect(select, getTaskCustomSelectOptions());
        } else {
            window.timeTaskSelect.update();
        }
        checkSubmitStatus();
    }
}

/**
 * Charge et affiche l'historique des temps consommes du projet selectionne sous le formulaire Standard.
 * Format par entree :
 *   jj/mm/aa|LM|Duree|Note
 * @returns {Promise<void>}
 */
/**
 * Construit le texte d'infobulle (Client, Projet, Tâche) pour le picto d'une tâche dans l'historique.
 * @param {string|number} taskId
 * @param {string} taskRef
 * @param {string} taskLabel
 * @param {string|number} fkProject
 * @returns {string}
 */
function buildTaskHistoryTooltip(taskId, taskRef, taskLabel, fkProject) {
    const projIdStr = String(fkProject || '');
    const proj = standardProjectsMap[projIdStr]
        || allLoadedProjects.find(p => String(p.id) === projIdStr);

    const socId = proj ? String(proj.socid || proj.fk_soc || '') : '';
    const clientName = (socId && socId !== '0')
        ? (thirdpartiesNameMap[socId] || decodeHtmlEntities(proj.thirdparty_name || ''))
        : '';

    const projRef = proj ? decodeHtmlEntities(proj.ref || '') : '';
    const projTitle = proj ? decodeHtmlEntities(proj.title || '') : '';

    const clientLabel = chrome.i18n.getMessage('std_hist_tooltip_client') || 'Tiers';
    const projectLabel = chrome.i18n.getMessage('std_hist_tooltip_project') || 'Projet';
    const taskTitleLabel = chrome.i18n.getMessage('std_hist_tooltip_task') || 'T\u00e2che';

    const tooltipParts = [];
    if (clientName) {
        tooltipParts.push(`${clientLabel} : ${clientName}`);
    }
    if (projRef || projTitle) {
        tooltipParts.push(`${projectLabel} : ${projRef}${projTitle ? (projRef ? ' - ' : '') + projTitle : ''}`);
    }
    if (taskRef || taskLabel) {
        tooltipParts.push(`${taskTitleLabel} : ${taskRef}${taskLabel ? (taskRef ? ' - ' : '') + taskLabel : ''}`);
    }

    return tooltipParts.join('\n') || (chrome.i18n.getMessage('time_card_open_doli_title') || 'Ouvrir dans Dolibarr');
}

/**
 * Met à jour les infobulles des liens d'historique associés à un projet donné.
 * @param {string|number} fkProject
 */
function refreshHistoryTooltipsForProject(fkProject) {
    const projIdStr = String(fkProject || '');
    if (!projIdStr) return;
    const container = document.getElementById('std-project-history');
    if (!container) return;
    const links = container.querySelectorAll('.std-hist-obj-link');
    links.forEach(link => {
        if (link.dataset.fkProject === projIdStr) {
            link.title = buildTaskHistoryTooltip(
                link.dataset.taskId || '',
                link.dataset.taskRef || '',
                link.dataset.taskLabel || '',
                projIdStr
            );
        }
    });
}

/**
 * Résout de manière asynchrone le projet et le tiers (client) associé pour enrichir l'infobulle.
 * @param {string|number} fkProject
 * @returns {Promise<void>}
 */
async function resolveProjectAndClientForHistory(fkProject) {
    const projIdStr = String(fkProject || '');
    if (!projIdStr || projIdStr === '0' || !doliUrl || !apiToken) return;
    if (pendingProjectClientFetches.has(`proj_${projIdStr}`)) return;
    pendingProjectClientFetches.add(`proj_${projIdStr}`);

    try {
        const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
        if (doliEntity !== '' && doliEntity !== null && doliEntity !== undefined) {
            headers['DOLAPIENTITY'] = String(doliEntity);
        }

        let proj = standardProjectsMap[projIdStr]
            || allLoadedProjects.find(p => String(p.id) === projIdStr);

        if (!proj) {
            try {
                const pRes = await fetchDoli(`${doliUrl}/projects/${encodeURIComponent(projIdStr)}`, { headers });
                if (pRes && pRes.ok) {
                    const pData = await pRes.json();
                    if (pData && pData.id) {
                        proj = pData;
                        standardProjectsMap[projIdStr] = pData;
                        if (!allLoadedProjects.some(p => String(p.id) === projIdStr)) {
                            allLoadedProjects.push(pData);
                        }
                        refreshHistoryTooltipsForProject(projIdStr);
                    }
                }
            } catch (_) {
                // Ignorer si le projet n'est pas accessible
            }
        }

        const socId = proj ? String(proj.socid || proj.fk_soc || '') : '';
        if (socId && socId !== '0' && thirdpartiesNameMap[socId] === undefined) {
            try {
                let socRes = await fetchDoli(`${doliUrl}/thirdparties/${encodeURIComponent(socId)}`, { headers });
                if ((!socRes || !socRes.ok) && headers['DOLAPIENTITY']) {
                    const fallbackHeaders = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
                    socRes = await fetchDoli(`${doliUrl}/thirdparties/${encodeURIComponent(socId)}`, { headers: fallbackHeaders });
                }
                if (socRes && socRes.ok) {
                    const socData = await socRes.json();
                    const codeClient = decodeHtmlEntities(socData ? (socData.code_client || socData.code_fournisseur || '') : '');
                    const cleanName = decodeHtmlEntities(socData ? (socData.name || socData.nom || '') : '');
                    const cleanAlias = decodeHtmlEntities(socData ? (socData.name_alias || '') : '');
                    const namePart = cleanName
                        ? (cleanAlias && cleanAlias !== cleanName ? `${cleanName} (${cleanAlias})` : cleanName)
                        : '';
                    thirdpartiesNameMap[socId] = [codeClient, namePart].filter(Boolean).join(' - ');
                } else {
                    thirdpartiesNameMap[socId] = '';
                }
            } catch (_) {
                thirdpartiesNameMap[socId] = '';
            }
            refreshHistoryTooltipsForProject(projIdStr);
        } else if (socId && socId !== '0' && thirdpartiesNameMap[socId]) {
            refreshHistoryTooltipsForProject(projIdStr);
        }
    } catch (_) {
        // Ignorer les erreurs réseau non bloquantes pour l'infobulle
    } finally {
        pendingProjectClientFetches.delete(`proj_${projIdStr}`);
    }
}

/**
 * Cree un element lien style Dolibarr getNomUrl(1) pour une tache/projet.
 * @param {string|number} taskId
 * @param {string} taskRef
 * @param {string} taskLabel
 * @param {string|number} fkProject
 * @returns {HTMLAnchorElement}
 */
function createTaskNomUrlElement(taskId, taskRef, taskLabel, fkProject) {
    const link = document.createElement('a');
    link.className = 'std-hist-obj-link';
    link.href = '#';
    link.dataset.taskId = String(taskId || '');
    link.dataset.taskRef = String(taskRef || '');
    link.dataset.taskLabel = String(taskLabel || '');
    link.dataset.fkProject = String(fkProject || '');

    link.title = buildTaskHistoryTooltip(taskId, taskRef, taskLabel, fkProject);

    const projIdStr = String(fkProject || '');
    const proj = standardProjectsMap[projIdStr]
        || allLoadedProjects.find(p => String(p.id) === projIdStr);
    const socId = proj ? String(proj.socid || proj.fk_soc || '') : '';
    if (projIdStr && (!proj || (socId && socId !== '0' && thirdpartiesNameMap[socId] === undefined))) {
        resolveProjectAndClientForHistory(projIdStr);
    }

    // Picto tache Dolibarr (clipboard-check)
    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('width', '13');
    iconSvg.setAttribute('height', '13');
    iconSvg.setAttribute('viewBox', '0 0 24 24');
    iconSvg.setAttribute('fill', 'none');
    iconSvg.setAttribute('stroke', 'currentColor');
    iconSvg.setAttribute('stroke-width', '2');
    iconSvg.setAttribute('stroke-linecap', 'round');
    iconSvg.setAttribute('stroke-linejoin', 'round');
    const rectClip = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectClip.setAttribute('x', '9'); rectClip.setAttribute('y', '2');
    rectClip.setAttribute('width', '6'); rectClip.setAttribute('height', '4');
    rectClip.setAttribute('rx', '1');
    const pathClip = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathClip.setAttribute('d', 'M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2');
    const polyCheck = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyCheck.setAttribute('points', '9 12 11 14 15 10');
    iconSvg.appendChild(rectClip);
    iconSvg.appendChild(pathClip);
    iconSvg.appendChild(polyCheck);

    link.appendChild(iconSvg);

    link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const baseUrl = doliUrl.replace(/\/api\/index\.php\/?$/i, '');
            const targetUrl = taskId
                ? `${baseUrl}/projet/tasks/task.php?id=${encodeURIComponent(taskId)}`
                : `${baseUrl}/projet/card.php?id=${encodeURIComponent(fkProject)}`;
            chrome.tabs.create({ url: targetUrl });
        } catch (_) {}
    });

    return link;
}

/**
 * Affiche dans #std-project-history les temps pointes sur les projets (hors projet RH de la configuration)
 * pour la date selectionnee (ou le projet selectionne) au format :
 *   date | objet (getNomUrl) | description | duree
 */
function renderStandardProjectHistory() {
    const container = document.getElementById('std-project-history');
    if (!container) return;

    const hrProjIds = getExcludedHrProjectIds();
    const hrTaskIds = new Set([
        ...(profileConfig?.doliHrPresenceTasks || []).map(String),
        ...(profileConfig?.doliHrAbsenceTasks || []).map(String)
    ]);

    const targetDateStr = toLocalDateStr(selectedDate);
    const allEntries = [];

    Object.entries(projectTaskLinesCache).forEach(([tid, entry]) => {
        if (!entry || hrTaskIds.has(String(tid))) return;
        if (entry.fkProject && hrProjIds.has(String(entry.fkProject))) return;
        const lines = Array.isArray(entry.lines) ? entry.lines : [];
        lines.forEach(line => {
            const ts = parseInt(line.timespent_line_datehour || line.timespent_line_date || 0, 10);
            const dur = parseInt(line.timespent_line_duration || 0, 10);
            if (ts <= 0 || dur <= 0) return;
            const dStr = toLocalDateStr(new Date(ts * 1000));
            if (dStr !== targetDateStr) return;
            allEntries.push({
                ...line,
                _taskId: entry.taskId || tid,
                _taskRef: entry.taskRef || '',
                _taskLabel: entry.taskLabel || '',
                _fkProject: entry.fkProject || ''
            });
        });
    });

    if (allEntries.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    allEntries.sort((a, b) => {
        const tsA = parseInt(a.timespent_line_datehour || a.timespent_line_date || 0, 10);
        const tsB = parseInt(b.timespent_line_datehour || b.timespent_line_date || 0, 10);
        if (tsB !== tsA) return tsB - tsA;
        const idA = parseInt(a.timespent_line_id || a.id || 0, 10);
        const idB = parseInt(b.timespent_line_id || b.id || 0, 10);
        return idB - idA;
    });

    container.innerHTML = '';
    container.classList.remove('hidden');

    allEntries.forEach(entry => {
        const ts = parseInt(entry.timespent_line_datehour || entry.timespent_line_date || 0, 10);
        let dateShort = '-';
        if (ts > 0) {
            const d = new Date(ts * 1000);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yy = String(d.getFullYear()).slice(-2);
            dateShort = `${dd}/${mm}/${yy}`;
        }

        const durStr = formatSecToHHMM(entry.timespent_line_duration || 0);
        const noteStr = decodeHtmlEntities((entry.timespent_line_note || '').trim());

        const item = document.createElement('div');
        item.className = 'std-hist-item';

        // Ligne unique : date | objet (getNomUrl) | description | duree
        const metaDiv = document.createElement('div');
        metaDiv.className = 'std-hist-meta';

        const dateSpan = document.createElement('span');
        dateSpan.className = 'std-hist-date';
        dateSpan.textContent = dateShort;

        const sep1 = document.createElement('span');
        sep1.className = 'std-hist-sep';
        sep1.textContent = '|';

        const objEl = createTaskNomUrlElement(entry._taskId, entry._taskRef, entry._taskLabel, entry._fkProject);

        const sep2 = document.createElement('span');
        sep2.className = 'std-hist-sep';
        sep2.textContent = '|';

        const noteSpan = document.createElement('span');
        noteSpan.className = 'std-hist-note';
        noteSpan.textContent = noteStr || '-';
        if (noteStr) noteSpan.title = noteStr;

        const sep3 = document.createElement('span');
        sep3.className = 'std-hist-sep';
        sep3.textContent = '|';

        const durSpan = document.createElement('span');
        durSpan.className = 'std-hist-dur';
        durSpan.textContent = durStr;

        metaDiv.appendChild(dateSpan);
        metaDiv.appendChild(sep1);
        metaDiv.appendChild(objEl);
        metaDiv.appendChild(sep2);
        metaDiv.appendChild(noteSpan);
        metaDiv.appendChild(sep3);
        metaDiv.appendChild(durSpan);

        item.appendChild(metaDiv);
        container.appendChild(item);
    });
}

async function loadStandardProjectHistory(refreshTaskId = null) {
    const tasks = Object.values(standardTasksMap);
    const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    try {
        if (tasks.length > 0) {
            const hrProjIds = getExcludedHrProjectIds();
            await Promise.all(tasks.map(async (t) => {
                try {
                    let taskData = t;
                    const needsFetch = (refreshTaskId && String(t.id) === String(refreshTaskId))
                        || (!Array.isArray(t.lines) && parseInt(t.duration_effective || 0, 10) > 0);
                    if (needsFetch) {
                        const res = await fetchDoli(`${doliUrl}/tasks/${t.id}?includetimespent=2`, { headers });
                        if (res.ok) {
                            taskData = await res.json();
                            t.lines = Array.isArray(taskData.lines) ? taskData.lines : [];
                        }
                    }
                    const lines = Array.isArray(taskData.lines) ? taskData.lines : [];
                    const fkProj = String(taskData.fk_project || taskData.fk_projet || t.fk_project || t.fk_projet || document.getElementById('time-project')?.value || '');
                    if (globalCurrentUserId && (!fkProj || !hrProjIds.has(fkProj))) {
                        projectTaskLinesCache[String(t.id)] = {
                            taskId: String(t.id),
                            taskRef: decodeHtmlEntities(taskData.ref || t.ref || ''),
                            taskLabel: decodeHtmlEntities(taskData.label || t.label || ''),
                            fkProject: fkProj,
                            durationEffective: parseInt(taskData.duration_effective || t.duration_effective || 0, 10),
                            lines: lines.filter(e => String(e.timespent_line_fk_user || '') === String(globalCurrentUserId))
                        };
                    }
                } catch (_) {}
            }));

            const projStatsSpentEl = document.querySelector('#std-project-stats .std-stat-item.is-spent');
            if (projStatsSpentEl) {
                attachLastTimespentHover(projStatsSpentEl, Object.values(standardTasksMap));
            }
            const curTaskId = document.getElementById('time-task')?.value;
            const taskStatsSpentEl = document.querySelector('#std-task-stats .std-stat-item.is-spent');
            if (taskStatsSpentEl && curTaskId && standardTasksMap[String(curTaskId)]) {
                attachLastTimespentHover(taskStatsSpentEl, [standardTasksMap[String(curTaskId)]]);
            }
        }
        buildWeekPicker();
        renderStandardProjectHistory();
    } catch (err) {
        console.warn('Erreur chargement historique projet standard:', err);
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

    const cleanLabel = decodeHtmlEntities(label || '');
    const labelSpan = document.createElement('span');
    labelSpan.className = 'ts-hr-card-label';
    labelSpan.textContent = cleanLabel;
    labelSpan.title = cleanLabel;

    info.appendChild(refSpan);
    info.appendChild(labelSpan);

    // -- Zone note inline au centre de la ligne unique ------------------------
    const noteInput = document.createElement('textarea');
    noteInput.className   = 'ts-hr-note-input';
    noteInput.rows        = 1;
    noteInput.placeholder = chrome.i18n.getMessage('time_card_note_placeholder');
    noteInput.removeAttribute('readonly');
    noteInput.removeAttribute('disabled');

    // -- Input temps : pre-rempli avec la valeur du planning pour le jour courant ----
    const timeInput = document.createElement('input');
    timeInput.type      = 'time';
    timeInput.className = 'ts-hr-time-input';
    timeInput.title     = chrome.i18n.getMessage('time_card_duration_title');

    const dayKey = getDayKeyFromDate(selectedDate);
    const schedule = profileConfig?.doliHrSchedule || {};
    const defaultTime = schedule[dayKey] || '';
    if (defaultTime) timeInput.value = defaultTime;

    // -- Bouton disquette (sauvegarde) ----------------------------------------
    const starBtn = document.createElement('button');
    starBtn.type      = 'button';
    starBtn.className = 'ts-hr-star-btn';
    starBtn.title     = chrome.i18n.getMessage('time_card_save_title');

    const starSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    starSvg.setAttribute('width', '20'); starSvg.setAttribute('height', '20');
    starSvg.setAttribute('viewBox', '0 0 24 24'); starSvg.setAttribute('fill', 'none');
    starSvg.setAttribute('stroke', 'currentColor'); starSvg.setAttribute('stroke-width', '1.75');
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
    mainRow.appendChild(noteInput);
    mainRow.appendChild(timeInput);
    mainRow.appendChild(starBtn);

    // -- Div statut par carte -------------------------------------------------
    const statusDiv = document.createElement('div');
    statusDiv.className = 'ts-hr-card-status hidden';

    // -- Historique timespent -------------------------------------------------
    const historyDiv = document.createElement('div');
    historyDiv.className = 'ts-hr-hist-container';

    card.appendChild(mainRow);
    card.appendChild(statusDiv);
    card.appendChild(historyDiv);

    // -- Interactions ---------------------------------------------------------
    timeInput.addEventListener('change', () => {
        if (timeInput.value) {
            card.classList.add('ts-hr-card-active');
        } else {
            card.classList.remove('ts-hr-card-active', 'ts-hr-card-done');
            starBtn.classList.remove('ts-star-active');
        }
    });

    if (defaultTime) {
        card.classList.add('ts-hr-card-active');
    }

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

            const hrProjectId = profileConfig?.doliHrProject || '';
            await ensureUserContributorOnProjectAndTask(hrProjectId, taskId, reqHeaders);

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


/**
 * S'assure que l'utilisateur courant qui pointe est bien ajouté comme contact interne
 * avec le rôle contributeur sur le projet (PROJECTCONTRIBUTOR) et sur la tâche (TASKCONTRIBUTOR).
 * @param {string|number} projectId - ID du projet Dolibarr
 * @param {string|number} taskId - ID de la tâche Dolibarr
 * @param {Object} headers - En-têtes HTTP d'authentification Dolibarr
 * @returns {Promise<void>}
 */
async function ensureUserContributorOnProjectAndTask(projectId, taskId, headers) {
    try {
        const getHeaders = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
        if (doliEntity) getHeaders['DOLAPIENTITY'] = doliEntity;

        if (!globalCurrentUserId) {
            const userRes = await fetchDoli(`${doliUrl}/users/info`, { headers: getHeaders });
            if (userRes.ok) {
                const userInfo = await userRes.json();
                globalCurrentUserId = String(userInfo.id || userInfo.rowid || '');
                globalCurrentUserInitials = extractUserInitials(userInfo);
                if (globalCurrentUserId && globalCurrentUserInitials) {
                    usersInitialsMap[globalCurrentUserId] = globalCurrentUserInitials;
                }
            }
        }

        const userIdNum = parseInt(globalCurrentUserId, 10);
        if (!userIdNum || userIdNum <= 0) return;

        const postHeaders = {
            ...getHeaders,
            ...(headers || {}),
            'Content-Type': 'application/json'
        };

        const entityKey = String(doliEntity || '1');
        const promises = [];

        if (projectId) {
            const projKey = `${entityKey}:${projectId}:${userIdNum}`;
            if (!ensuredProjectContributors.has(projKey)) {
                promises.push((async () => {
                    try {
                        let alreadyOnProject = false;
                        const contactsRes = await fetchDoli(`${doliUrl}/projects/${projectId}/contacts`, { headers: getHeaders });
                        if (contactsRes.ok) {
                            const contacts = await contactsRes.json();
                            if (Array.isArray(contacts)) {
                                alreadyOnProject = contacts.some(c =>
                                    String(c.source || '').toLowerCase() === 'internal' &&
                                    String(c.id || c.fk_socpeople || '') === String(userIdNum) &&
                                    String(c.code || '').toUpperCase() === 'PROJECTCONTRIBUTOR'
                                );
                            }
                        }

                        if (!alreadyOnProject) {
                            const addProjRes = await fetchDoli(`${doliUrl}/projects/${projectId}/contacts`, {
                                method: 'POST',
                                headers: postHeaders,
                                body: JSON.stringify({
                                    fk_socpeople: userIdNum,
                                    type_contact: 'PROJECTCONTRIBUTOR',
                                    source: 'internal',
                                    notrigger: 0
                                })
                            });
                            if (addProjRes.ok) {
                                ensuredProjectContributors.add(projKey);
                            }
                        } else {
                            ensuredProjectContributors.add(projKey);
                        }
                    } catch (errProj) {
                        console.warn('[ReedCRM] Impossible d\'ajouter le contributeur sur le projet:', errProj);
                    }
                })());
            }
        }

        if (taskId) {
            const taskKey = `${entityKey}:${taskId}:${userIdNum}`;
            if (!ensuredTaskContributors.has(taskKey)) {
                promises.push((async () => {
                    try {
                        let alreadyOnTask = false;
                        const contactsRes = await fetchDoli(`${doliUrl}/tasks/${taskId}/contacts`, { headers: getHeaders });
                        if (contactsRes.ok) {
                            const contacts = await contactsRes.json();
                            if (Array.isArray(contacts)) {
                                alreadyOnTask = contacts.some(c =>
                                    String(c.source || '').toLowerCase() === 'internal' &&
                                    String(c.id || c.fk_socpeople || '') === String(userIdNum) &&
                                    String(c.code || '').toUpperCase() === 'TASKCONTRIBUTOR'
                                );
                            }
                        }

                        if (!alreadyOnTask) {
                            const addTaskRes = await fetchDoli(`${doliUrl}/tasks/${taskId}/contacts`, {
                                method: 'POST',
                                headers: postHeaders,
                                body: JSON.stringify({
                                    fk_socpeople: userIdNum,
                                    type_contact: 'TASKCONTRIBUTOR',
                                    source: 'internal',
                                    notrigger: 0
                                })
                            });
                            if (addTaskRes.ok) {
                                ensuredTaskContributors.add(taskKey);
                            }
                        } else {
                            ensuredTaskContributors.add(taskKey);
                        }
                    } catch (errTask) {
                        console.warn('[ReedCRM] Impossible d\'ajouter le contributeur sur la tâche:', errTask);
                    }
                })());
            }
        }

        if (promises.length > 0) {
            await Promise.all(promises);
        }
    } catch (err) {
        console.warn('[ReedCRM] Erreur lors de l\'affectation du contributeur:', err);
    }
}

async function submitTime() {
    const btn = document.getElementById('btn-submit-time-std') || document.getElementById('btn-submit-time');
    const statusDiv = document.getElementById('time-status-std') || document.getElementById('time-status');
    const date = (document.getElementById('time-date-std') || document.getElementById('time-date'))?.value;
    const duration = (document.getElementById('time-duration-std') || document.getElementById('time-duration'))?.value;
    const noteEl = document.getElementById('time-note-std') || document.getElementById('time-note');
    const note = noteEl ? noteEl.value : '';
    
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
        const projectId = currentMode === 'standard'
            ? (document.getElementById('time-project')?.value || standardTasksMap[String(taskId)]?.fk_project || standardTasksMap[String(taskId)]?.fk_projet || '')
            : (profileConfig?.doliHrProject || '');
        await ensureUserContributorOnProjectAndTask(projectId, taskId, headers);

        const res = await fetchDoli(`${doliUrl}/tasks/${taskId}/addtimespent`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        btn.classList.remove('loading');

        if (res.ok) {
            statusDiv.style.color = '#2ecc71';
            statusDiv.textContent = 'Temps enregistré avec succès !';
            if (currentMode === 'standard' && taskId && standardTasksMap[String(taskId)]) {
                standardTasksMap[String(taskId)].duration_effective = (parseInt(standardTasksMap[String(taskId)].duration_effective || 0, 10)) + durationInSeconds;
                updateSelectedTaskStats(taskId);
                const projId = document.getElementById('time-project')?.value;
                if (projId) {
                    let pPlanned = 0, pSpent = 0;
                    Object.values(standardTasksMap).forEach(tk => {
                        pPlanned += parseInt(tk.planned_workload || 0, 10);
                        pSpent += parseInt(tk.duration_effective || 0, 10);
                    });
                    const proj = standardProjectsMap[String(projId)];
                    const baseUrl = doliUrl.replace(/\/api\/index\.php\/?$/i, '');
                    const projUrl = `${baseUrl}/projet/card.php?id=${encodeURIComponent(projId)}`;
                    renderInlineStats(document.getElementById('std-project-stats'), proj ? (proj.title || proj.ref || '') : '', pPlanned, pSpent, Object.values(standardTasksMap), projUrl);
                }
                loadStandardProjectHistory(taskId);
            }
            updateDailyTimespentStats(); // Recalcul des totaux après ajout
            setTimeout(() => {
                statusDiv.textContent = '';
                if (noteEl) noteEl.value = '';
                checkSubmitStatus();
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

/**
 * Normalise une chaine pour la detection automatique du projet et des taches RH DoliSIRH.
 * @param {string} str
 * @returns {string}
 */
function normalizeHrText(str) {
    if (!str) return '';
    return decodeHtmlEntities(String(str)).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Determine si un projet correspond au projet Ressources Humaines par defaut de DoliSIRH.
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

function findDefaultHrProject(projectsList) {
    if (!Array.isArray(projectsList)) return undefined;
    const hrProjects = projectsList.filter(isDefaultHrProject);
    const v200 = hrProjects.find(p => normalizeHrText(p.title || '').includes('2.0.0'));
    return v200 || hrProjects[0];
}

/**
 * Classe une tache RH en 'presence' (WORK_TIME) ou 'absence' (NON_WORK_TIME) par defaut.
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

const DOLISIRH_DOLISTORE_URL = 'https://www.dolistore.com/product.php?id=597&l=fr';

/**
 * Affiche ou masque un encart d'alerte dans #timesheet-setup-container lorsque DoliSIRH n'est pas installé/activé,
 * et grise l'ensemble des contrôles de configuration si le module est absent.
 * @param {boolean} show
 */
function renderSetupDoliSirhWarning(show) {
    const setupContainer = document.getElementById('timesheet-setup-container');
    const select = document.getElementById('time-setup-project');
    const presContainer = document.getElementById('time-setup-presence-container');
    const absContainer = document.getElementById('time-setup-absence-container');
    const saveBtn = document.getElementById('btn-save-time-setup');
    const firstFormGroup = setupContainer ? setupContainer.querySelector('.form-group') : null;
    if (!setupContainer || !firstFormGroup) return;

    let banner = document.getElementById('time-setup-dolisirh-warning');
    if (!show) {
        if (banner) banner.remove();
        if (select) {
            select.disabled = false;
            if (window.timeSetupProjectSelect) window.timeSetupProjectSelect.update();
        }
        if (presContainer) {
            presContainer.style.background = '#fff';
            presContainer.style.borderColor = '#cbd5e1';
            presContainer.style.pointerEvents = '';
            presContainer.style.cursor = '';
        }
        if (absContainer) {
            absContainer.style.background = '#fff';
            absContainer.style.borderColor = '#cbd5e1';
            absContainer.style.pointerEvents = '';
            absContainer.style.cursor = '';
        }
        setupContainer.querySelectorAll('.form-group label').forEach(lbl => {
            lbl.style.color = '#334155';
        });
        return;
    }

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'time-setup-dolisirh-warning';
        banner.style.cssText = 'margin-bottom:12px;padding:8px 10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;font-size:11.5px;color:#9a3412;line-height:1.4;';

        const msgSpan = document.createElement('span');
        msgSpan.textContent = (chrome.i18n.getMessage('dolisirh_missing_msg') || "Le module API est d\u00e9sactiv\u00e9 ou DoliSIRH n'est pas pr\u00e9sent et/ou activ\u00e9. Vous pouvez l'acheter sur :") + ' ';

        const link = document.createElement('a');
        link.href = DOLISIRH_DOLISTORE_URL;
        link.textContent = chrome.i18n.getMessage('dolisirh_dolistore_link_label') || 'Dolistore';
        link.style.cssText = 'color:#c2410c;font-weight:700;text-decoration:underline;cursor:pointer;';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            chrome.tabs.create({ url: DOLISIRH_DOLISTORE_URL });
        });

        banner.appendChild(msgSpan);
        banner.appendChild(link);
    }
    setupContainer.insertBefore(banner, firstFormGroup);

    if (select) {
        select.disabled = true;
        if (window.timeSetupProjectSelect) window.timeSetupProjectSelect.update();
    }
    if (presContainer) {
        presContainer.style.background = '#f1f5f9';
        presContainer.style.borderColor = '#cbd5e1';
        presContainer.style.pointerEvents = 'none';
        presContainer.style.cursor = 'not-allowed';
    }
    if (absContainer) {
        absContainer.style.background = '#f1f5f9';
        absContainer.style.borderColor = '#cbd5e1';
        absContainer.style.pointerEvents = 'none';
        absContainer.style.cursor = 'not-allowed';
    }
    if (saveBtn) {
        saveBtn.disabled = true;
    }
    setupContainer.querySelectorAll('.form-group label').forEach(lbl => {
        lbl.style.color = '#94a3b8';
    });
}

async function loadSetupProjects() {
    const select = document.getElementById('time-setup-project');
    if (!select) return;

    const headers = { 'DOLAPIKEY': apiToken, 'Accept': 'application/json' };
    if (doliEntity) headers['DOLAPIENTITY'] = doliEntity;

    select.innerHTML = '<option value="">S\u00e9lectionnez un projet RH</option>';
    if (!window.timeSetupProjectSelect) {
        window.timeSetupProjectSelect = new CustomSelect(select);
    } else {
        window.timeSetupProjectSelect.update();
    }

    let hasDoliSirhModule = null;
    try {
        const modRes = await fetchDoli(`${doliUrl}/setup/modules`, { headers });
        if (modRes.ok) {
            const modList = await modRes.json();
            if (Array.isArray(modList)) {
                hasDoliSirhModule = modList.some(m => String(m || '').toLowerCase().includes('dolisirh'));
            }
        }
    } catch (_) {}

    try {
        let res = await fetchDoli(`${doliUrl}/projects?sqlfilters=(t.fk_statut:=:1)&limit=10000&sortfield=t.rowid&sortorder=DESC`, { headers });
        if (!res.ok) {
            res = await fetchDoli(`${doliUrl}/projects?limit=10000&sortfield=t.rowid&sortorder=DESC`, { headers });
        }

        let defaultHrProj = null;
        if (res.ok) {
            const projects = await res.json();
            select.innerHTML = '<option value="">S\u00e9lectionnez un projet RH</option>';
            if (Array.isArray(projects)) {
                const activeEnt = String(doliEntity || '1');
                const openProjects = projects.filter(p => String(p.statut ?? p.fk_statut ?? p.status ?? '1') === '1');
                const baseProjects = openProjects.length > 0 ? openProjects : projects;
                let filtered = baseProjects.filter(p => String(p.entity || '1') === activeEnt);
                if (filtered.length === 0 && baseProjects.length > 0) {
                    filtered = baseProjects;
                }
                defaultHrProj = findDefaultHrProject(filtered);

                filtered.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = `${decodeHtmlEntities(p.ref || '')} - ${decodeHtmlEntities(p.title || '')}`;
                    if (defaultHrProj && String(p.id) === String(defaultHrProj.id)) {
                        opt.selected = true;
                    }
                    select.appendChild(opt);
                });

                if (defaultHrProj) {
                    select.value = String(defaultHrProj.id);
                }

                if (!window.timeSetupProjectSelect) {
                    window.timeSetupProjectSelect = new CustomSelect(select);
                } else {
                    window.timeSetupProjectSelect.update();
                }

                if (select.value) {
                    await loadSetupTasks(select.value);
                }
            }
        }

        const isDoliSirhPresent = hasDoliSirhModule !== null ? hasDoliSirhModule : Boolean(defaultHrProj);
        renderSetupDoliSirhWarning(!isDoliSirhPresent);
    } catch(e) {
        select.innerHTML = '<option value="">Erreur de chargement</option>';
        if (window.timeSetupProjectSelect) window.timeSetupProjectSelect.update();
        renderSetupDoliSirhWarning(true);
        console.warn('Error fetching setup projects', e);
    }
}

async function loadSetupTasks(projectId) {
    const presContainer = document.getElementById('time-setup-presence-container');
    const absContainer = document.getElementById('time-setup-absence-container');
    const saveBtn = document.getElementById('btn-save-time-setup');
    
    if (!presContainer || !absContainer || !saveBtn) return;
    
    saveBtn.disabled = true;

    if (!projectId) {
        presContainer.innerHTML = "<span style='color: #94a3b8; font-style: italic;'>S\u00e9lectionnez le projet d'abord</span>";
        absContainer.innerHTML = "<span style='color: #94a3b8; font-style: italic;'>S\u00e9lectionnez le projet d'abord</span>";
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
                    const cleanLabel = decodeHtmlEntities(t.label || '');
                    const defaultKind = classifyDefaultHrTask(t);
                    presContainer.appendChild(createSetupCheckbox(t.id, cleanLabel, 'presence', defaultKind === 'presence'));
                    absContainer.appendChild(createSetupCheckbox(t.id, cleanLabel, 'absence', defaultKind === 'absence'));
                });
                saveBtn.disabled = false;
            } else {
                presContainer.innerHTML = '<span style="color: #e74c3c;">Aucune t\u00e2che trouv\u00e9e</span>';
                absContainer.innerHTML = '<span style="color: #e74c3c;">Aucune t\u00e2che trouv\u00e9e</span>';
            }
        }
    } catch(e) {
        presContainer.innerHTML = '<span style="color: #e74c3c;">Erreur r\u00e9seau</span>';
        absContainer.innerHTML = '<span style="color: #e74c3c;">Erreur r\u00e9seau</span>';
    }
}

function createSetupCheckbox(taskId, label, type, checked = false) {
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
    input.checked = Boolean(checked);
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
