import { apiCall, checkAuth } from '../utils/api.js';
import { mountHeader, setHeaderUser } from '../components/header.js';
import { escapeHtml, localDate, toInputDate, toggleModal, setupModalClose, showAlert, showConfirm, getContrastColor } from '../utils/dom.js';
import { renderMarkdown, hydrateMarkdownImages } from '../utils/markdown.js';
import { connectRealtime, getRealtimeId } from '../utils/realtime.js';
import { syncPushSubscription } from '../utils/push.js';

let subjects = [];
let assignments = [];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
/** Mobile view: continuous list of days from today, extended while scrolling. */
const MOBILE_DAYS_STEP = 14;
let mobileDaysShown = MOBILE_DAYS_STEP;
let mobileObserver = null;
/** "Past assignments" view (/dashboard/?vue=passes): one week at a time. */
let pastView = new URLSearchParams(window.location.search).get('vue') === 'passes';
let pastWeekStart = null;
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
let selectedDate = null;
let isMobileView = false;
let authData = null;

/** The school year starts in September (month 8) and ends in August. */
const SCHOOL_YEAR_START_MONTH = 8;
const schoolYear = getSchoolYear();

/**
 * @returns {{startYear: number, endYear: number, firstDay: Date, lastDay: Date}}
 *   firstDay is September 1st of the start year, lastDay the last day of August of the end year.
 */
function getSchoolYear(reference = new Date()) {
  const startYear = reference.getMonth() >= SCHOOL_YEAR_START_MONTH
    ? reference.getFullYear()
    : reference.getFullYear() - 1;

  return {
    startYear,
    endYear: startYear + 1,
    firstDay: new Date(startYear, SCHOOL_YEAR_START_MONTH, 1),
    lastDay: new Date(startYear + 1, SCHOOL_YEAR_START_MONTH, 0)
  };
}

function monthIndex(year, month) {
  return year * 12 + month;
}

const minMonthIndex = monthIndex(schoolYear.startYear, SCHOOL_YEAR_START_MONTH);
const maxMonthIndex = monthIndex(schoolYear.endYear, SCHOOL_YEAR_START_MONTH - 1);

/** Bounds as YYYY-MM-DD, directly comparable with the dates of the cells. */
const minDateStr = toInputDate(schoolYear.firstDay);
const maxDateStr = toInputDate(schoolYear.lastDay);

function isDateStrInSchoolYear(dateStr) {
  return dateStr >= minDateStr && dateStr <= maxDateStr;
}

let accumulatedFiles = [];
let accumulatedEditFiles = [];

/**
 * Realtime state: refreshes triggered by the other members of the class.
 * - currentAssignmentId: assignment shown in #assignment-modal
 * - currentAssignmentSignature: state of that assignment when the modal was rendered
 * - editAssignmentRecreate: the assignment being edited was deleted elsewhere
 * - editAssignmentBaseline: version of the assignment loaded in the edit form
 * - refreshQueued: a refresh waits for a local submission to finish
 * - commentSending: a comment is being sent
 * - commentsRequest: number of the last comments load
 * - pendingComments: assignment id → comment count received in realtime
 */
let currentAssignmentId = null;
let currentAssignmentSignature = null;
let editAssignmentRecreate = false;
let editAssignmentBaseline = null;
let refreshTimer = null;
let refreshQueued = false;
let isSubmitting = false;
let commentSending = false;
let commentsRequest = 0;
const pendingResources = new Set();
const pendingComments = new Map();

/**
 * Realtime updates are only enabled for users attached to a class, the only
 * ones who can receive anything.
 */
async function init() {
  mountHeader({ page: 'dashboard' });

  authData = await checkAuth();

  if (!authData.authenticated) return;

  setHeaderUser(authData);

  if (authData.pending_request) {
    document.getElementById('pending-banner').style.display = 'block';
    document.getElementById('pending-class-name').textContent = authData.pending_request.classe_nom;
    document.getElementById('main-content').style.display = 'none';
    return;
  }

  if (!authData.classe_id && !authData.is_admin) {
    document.getElementById('main-content').innerHTML = `
      <div style="text-align: center; padding: 3rem; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2>Bienvenue sur Eniv</h2>
        <p style="color: var(--secondary); margin-top: 1rem;">Vous n'êtes pas encore associé à une classe.</p>
      </div>
    `;
    return;
  }

  await loadData();
  setupEventListeners();
  applySchoolYearLimits();
  checkViewport();
  renderCalendar();
  openAssignmentFromUrl();
  syncPushSubscription();

  if (authData.classe_id) {
    connectRealtime({
      onUpdate: (message) => {
        if (message.resource === 'commentaires') pendingComments.set(message.devoirId, message.nbCommentaires);
        scheduleRefresh(message.resource, message.devoirId);
      },
      onResync: () => scheduleRefresh('*', null)
    });
  }
}

const REFRESH_DEBOUNCE_MS = 400;
let refreshAssignmentId = null;

/**
 * One remote action (editing an assignment, then uploading three files) sends
 * several frames: they are grouped to reload only once. While a local
 * submission is in progress, the refresh waits for it to end, so as not to
 * reload half-written data.
 */
function scheduleRefresh(resource, assignmentId) {
  if (!resource) return;

  pendingResources.add(resource);
  if (assignmentId) refreshAssignmentId = assignmentId;

  if (isSubmitting) {
    refreshQueued = true;
    return;
  }

  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(applyRefresh, REFRESH_DEBOUNCE_MS);
}

function flushQueuedRefresh() {
  if (!refreshQueued) return;
  refreshQueued = false;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(applyRefresh, REFRESH_DEBOUNCE_MS);
}

/**
 * Applies the grouped refresh. Comment notifications carry their count, so the
 * assignments are only reloaded when a count is missing.
 */
async function applyRefresh() {
  refreshTimer = null;

  const resources = new Set(pendingResources);
  const assignmentId = refreshAssignmentId;
  const commentCounts = new Map(pendingComments);
  pendingResources.clear();
  pendingComments.clear();
  refreshAssignmentId = null;

  const isResync = resources.has('*');
  const wantsSubjects = isResync || resources.has('matieres');
  const missingCount = [...commentCounts.values()].some(n => !Number.isInteger(n));
  const wantsAssignments = isResync || missingCount || ['devoirs', 'fichiers', 'quiz'].some(r => resources.has(r));

  const tasks = [];
  if (wantsSubjects) tasks.push(loadSubjects());
  if (wantsAssignments) tasks.push(loadAssignments());
  if (tasks.length === 0 && commentCounts.size === 0) return;

  await Promise.all(tasks);
  if (!wantsAssignments) {
    commentCounts.forEach((n, id) => {
      const assignment = assignments.find(a => a.id === id);
      if (assignment) assignment.nb_commentaires = n;
    });
  }
  renderCalendar();
  await refreshOpenModals(resources, assignmentId, commentCounts);
}

function isModalOpen(modalId) {
  return Boolean(document.getElementById(modalId)?.classList.contains('active'));
}

/**
 * Content signature of an assignment. The "done" status is left out on
 * purpose: it belongs to each user and cannot change because of a remote
 * action.
 */
function assignmentSignature(assignment) {
  if (!assignment) return null;
  return [assignment.titre, assignment.description, assignment.matiere_id, assignment.date].join('|');
}

/**
 * Updates the open modals after a remote change.
 *
 * The details modal is fully re-rendered only when its content really changed:
 * re-rendering resets the scroll, which is annoying on long descriptions, and
 * also reloads the comments.
 *
 * In the edit modal, the list of existing files only mirrors the server, so
 * refreshing it cannot overwrite anything typed by the user. The form fields
 * may hold an input in progress: the divergence is only reported, and
 * reloading stays the user's choice.
 */
async function refreshOpenModals(resources, assignmentId, commentCounts) {
  const isResync = resources.has('*');

  if (isModalOpen('assignment-modal') && currentAssignmentId) {
    const assignment = assignments.find(a => a.id === currentAssignmentId);

    if (!assignment) {
      toggleModal('assignment-modal', false);
      currentAssignmentId = null;
      currentAssignmentSignature = null;
      await showAlert("Ce devoir vient d'être supprimé par un autre utilisateur.", 'Devoir supprimé');
    } else {
      const concerned = isResync || !assignmentId || assignmentId === currentAssignmentId;
      if (concerned && resources.has('fichiers')) loadAssignmentModalFiles(currentAssignmentId);
      if (concerned && resources.has('quiz')) loadQuizStatus(currentAssignmentId);

      const signature = assignmentSignature(assignment);
      if (concerned && (isResync || resources.has('devoirs')) && signature !== currentAssignmentSignature) {
        await showAssignmentModal(currentAssignmentId);
      } else if (isResync || commentCounts.has(currentAssignmentId)) {
        loadComments(currentAssignmentId);
      }
    }
  }

  if (isModalOpen('edit-assignment-modal') && !editAssignmentRecreate) {
    const editedId = parseInt(document.getElementById('edit-assignment-id').value, 10);
    const assignment = Number.isFinite(editedId) ? assignments.find(a => a.id === editedId) : null;

    if (Number.isFinite(editedId) && !assignment) {
      markEditedAssignmentAsDeleted();
    } else if (assignment) {
      if (isResync || resources.has('fichiers')) loadExistingFiles(editedId);
      setEditedAssignmentChanged(assignmentSignature(assignment) !== editAssignmentBaseline);
    }
  }
}

function setEditedAssignmentChanged(changed) {
  document.getElementById('edit-assignment-changed-banner').classList.toggle('hidden', !changed);
}

/** Replaces the input in progress with the remote version, when the user asks for it from the banner. */
async function reloadEditedAssignment() {
  const editedId = parseInt(document.getElementById('edit-assignment-id').value, 10);
  const assignment = assignments.find(a => a.id === editedId);
  if (!assignment) return;

  await fillEditAssignmentForm(assignment);
  setEditedAssignmentChanged(false);
}

/**
 * The assignment being edited is gone: the user's input is kept and saving
 * becomes a re-creation. The deletion takes precedence over a change reported
 * before, and the attached files were deleted along with the assignment.
 */
function markEditedAssignmentAsDeleted() {
  editAssignmentRecreate = true;
  document.getElementById('edit-assignment-deleted-banner').classList.remove('hidden');
  document.getElementById('edit-assignment-submit-btn').textContent = 'Recréer le devoir';
  setEditedAssignmentChanged(false);
  document.getElementById('edit-assignment-existing-files').innerHTML = '';
}

function resetEditAssignmentBanners() {
  editAssignmentRecreate = false;
  document.getElementById('edit-assignment-deleted-banner').classList.add('hidden');
  document.getElementById('edit-assignment-submit-btn').textContent = 'Enregistrer';
  setEditedAssignmentChanged(false);
}

async function loadData() {
  await Promise.all([
    loadSubjects(),
    loadAssignments()
  ]);
  renderCalendar();
}

async function loadSubjects() {
  const data = await apiCall('/api/admin/matieres');
  if (!data.error) {
    subjects = data;
    updateSubjectSelects();
  }
}

/**
 * Rebuilds the subject selects. Rebuilding clears the current choice, so it is
 * restored when the subject still exists (it may have been deleted meanwhile).
 */
function updateSubjectSelects() {
  const selects = ['assignment-subject', 'edit-assignment-subject'];
  selects.forEach(selectId => {
    const select = document.getElementById(selectId);
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = '<option value="">Sélectionner une matière</option>';
    subjects.forEach(subject => {
      const option = document.createElement('option');
      option.value = subject.id;
      option.textContent = subject.nom;
      select.appendChild(option);
    });
    if (previousValue && subjects.some(s => String(s.id) === previousValue)) {
      select.value = previousValue;
    }
  });
}

async function loadAssignments() {
  const data = await apiCall('/api/devoirs');
  if (!data.error) {
    assignments = data;
  }
}

/**
 * Wires the page. In the mobile view, days without assignments are hidden, so
 * adding goes through the floating button (with a date to pick).
 */
function setupEventListeners() {
  document.getElementById('prev-month').addEventListener('click', () => {
    if (!navigate(-1)) return;
    renderCalendar();
  });

  document.getElementById('next-month').addEventListener('click', () => {
    if (!navigate(1)) return;
    renderCalendar();
  });

  setupModalClose('assignment-modal', 'close-modal');
  setupModalClose('add-assignment-modal', 'close-add-modal');
  setupModalClose('edit-assignment-modal', 'close-edit-assignment-modal');

  document.getElementById('cancel-assignment-btn').addEventListener('click', () => {
    toggleModal('add-assignment-modal', false);
    document.getElementById('assignment-form').reset();
    accumulatedFiles.length = 0;
    document.getElementById('assignment-files-list').innerHTML = '';
  });

  document.getElementById('cancel-edit-assignment-btn').addEventListener('click', () => {
    toggleModal('edit-assignment-modal', false);
    document.getElementById('edit-assignment-form').reset();
    resetEditAssignmentBanners();
    accumulatedEditFiles.length = 0;
    document.getElementById('edit-assignment-new-files-list').innerHTML = '';
    document.getElementById('edit-assignment-existing-files').innerHTML = '';
  });

  document.getElementById('assignment-form').addEventListener('submit', handleAddAssignment);
  document.getElementById('edit-assignment-form').addEventListener('submit', handleEditAssignment);
  document.getElementById('edit-assignment-reload-btn').addEventListener('click', reloadEditedAssignment);

  setupDropZone('assignment-drop-zone', 'assignment-files', accumulatedFiles, 'assignment-files-list');
  setupDropZone('edit-assignment-drop-zone', 'edit-assignment-new-files', accumulatedEditFiles, 'edit-assignment-new-files-list');

  document.addEventListener('click', handleCalendarClick);

  document.getElementById('view-toggle-btn').addEventListener('click', () => setPastView(!pastView));
  document.getElementById('add-assignment-fab').addEventListener('click', () => {
    document.getElementById('assignment-due-date').value = '';
    showAddAssignmentModal(null);
  });
  window.addEventListener('popstate', () => {
    const past = new URLSearchParams(window.location.search).get('vue') === 'passes';
    if (past !== pastView) setPastView(past, { push: false });
  });

  window.addEventListener('resize', () => {
    const wasMobile = isMobileView;
    checkViewport();
    if (wasMobile !== isMobileView) renderCalendar();
  });
}

/** Restricts the date fields of the forms to the current school year. */
function applySchoolYearLimits() {
  ['assignment-due-date', 'edit-assignment-due-date'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.min = minDateStr;
    input.max = maxDateStr;
  });
}

function checkViewport() {
  isMobileView = window.innerWidth <= 768;
}

/** "Day" dates are UTC midnight of the local day (localDate), comparable with assignment dates through dateKey. */
function addDays(date, n) {
  return localDate(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function todayLocal() {
  return addDays(new Date(), 0);
}

function dateKey(date) {
  return date.toISOString().split('T')[0];
}

function mondayOf(date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}

/** Last week holding a past day (on a Monday: the previous week). */
function lastPastWeekStart() {
  return mondayOf(addDays(todayLocal(), -1));
}

function assignmentsOfDay(dateStr) {
  return assignments.filter(a => a.date && a.date.split('T')[0] === dateStr)
    .sort((a, b) => a.fait - b.fait);
}

function setupDropZone(dropZoneId, inputId, fileArray, listId) {
  const dropZone = document.getElementById(dropZoneId);
  const fileInput = document.getElementById(inputId);

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', function(e) {
    addFilesToArray(e.target.files, fileArray, listId);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault(); e.stopPropagation();
    dropZone.style.borderColor = 'var(--primary)';
    dropZone.style.backgroundColor = 'rgba(74, 144, 226, 0.1)';
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault(); e.stopPropagation();
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.backgroundColor = 'var(--light)';
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.backgroundColor = 'var(--light)';
    addFilesToArray(e.dataTransfer.files, fileArray, listId);
  });
}

function addFilesToArray(files, fileArray, listId) {
  if (!files || files.length === 0) return;

  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ];

  const validFiles = Array.from(files).filter(file => allowedTypes.includes(file.type));
  if (validFiles.length === 0) {
    showAlert('Seuls les fichiers PDF, Word, PowerPoint et Excel sont autorisés', 'Erreur');
    return;
  }

  const oversizedFiles = validFiles.filter(file => file.size > 50 * 1024 * 1024);
  if (oversizedFiles.length > 0) {
    showAlert(`Certains fichiers dépassent 50 Mo`, 'Erreur');
    return;
  }

  validFiles.forEach(file => {
    const exists = fileArray.some(f => f.name === file.name && f.size === file.size);
    if (!exists) fileArray.push(file);
  });

  displayFileList(fileArray, listId);
}

function displayFileList(fileArray, listId) {
  const container = document.getElementById(listId);
  if (fileArray.length === 0) { container.innerHTML = ''; return; }

  let html = '<div style="margin-top: 0.5rem;">';
  fileArray.forEach((file, index) => {
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
    html += `<div style="padding:0.5rem;background:white;border-radius:4px;margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);">`;
    html += `<span style="font-size:0.9rem;flex:1;">${escapeHtml(file.name)} <span style="color:var(--secondary);">(${sizeInMB} Mo)</span></span>`;
    html += `<button type="button" class="btn-danger" style="padding:0.25rem 0.5rem;font-size:0.8rem;" onclick="removeFileFromList(${index}, '${listId}')">Retirer</button>`;
    html += `</div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

window.removeFileFromList = function(index, listId) {
  const fileArray = listId === 'assignment-files-list' ? accumulatedFiles : accumulatedEditFiles;
  fileArray.splice(index, 1);
  displayFileList(fileArray, listId);
};

/**
 * Returns the target period (month or week) after a move, or null when it
 * leaves the school year. The mobile scrolling view has no navigation by
 * period.
 */
function getNavigationTarget(direction) {
  if (pastView) {
    const target = addDays(pastWeekStart, direction * 7);
    const minWeekStart = mondayOf(addDays(schoolYear.firstDay, 0));
    if (target < minWeekStart || target > lastPastWeekStart()) return null;
    return target;
  }
  if (isMobileView) return null;

  const target = monthIndex(currentYear, currentMonth) + direction;
  if (target < minMonthIndex || target > maxMonthIndex) return null;
  return target;
}

function navigate(direction) {
  const target = getNavigationTarget(direction);
  if (target === null) return false;

  if (pastView) {
    pastWeekStart = target;
  } else {
    currentYear = Math.floor(target / 12);
    currentMonth = target % 12;
  }
  return true;
}

function updateNavButtons() {
  const prevBtn = document.getElementById('prev-month');
  const nextBtn = document.getElementById('next-month');
  if (prevBtn) prevBtn.disabled = getNavigationTarget(-1) === null;
  if (nextBtn) nextBtn.disabled = getNavigationTarget(1) === null;
}

function renderCalendar() {
  const calendar = document.getElementById('calendar');
  if (!calendar) return;
  disconnectMobileObserver();
  document.querySelector('.calendar-header').classList.toggle('scrolling', isMobileView && !pastView);
  document.body.classList.toggle('scrolling-view', isMobileView && !pastView);
  document.getElementById('view-toggle-btn').textContent = pastView ? 'Devoirs à venir' : 'Devoirs passés';
  document.getElementById('view-label').textContent = pastView ? 'Devoirs passés' : '';
  if (pastView) renderPastWeekView();
  else if (isMobileView) renderMobileScrollView();
  else renderDesktopMonthView();
  updateNavButtons();
}

function setPastView(active, { push = true } = {}) {
  pastView = active;
  if (active) pastWeekStart = lastPastWeekStart();
  if (push) {
    const url = new URL(window.location.href);
    if (active) url.searchParams.set('vue', 'passes');
    else url.searchParams.delete('vue');
    history.pushState(null, '', url);
  }
  renderCalendar();
  window.scrollTo(0, 0);
}

function disconnectMobileObserver() {
  if (mobileObserver) {
    mobileObserver.disconnect();
    mobileObserver = null;
  }
}

function renderMobileAssignmentItems(dayAssignments) {
  let html = '';
  dayAssignments.forEach(assignment => {
    const subject = subjects.find(s => s.id === assignment.matiere_id);
    const color = subject?.couleur || '#999';
    html += `<div class="mobile-assignment-item ${assignment.fait ? 'done' : ''}" data-assignment-id="${assignment.id}" style="border-left:4px solid ${color};">`;
    html += `<div class="mobile-assignment-title">${escapeHtml(assignment.titre)}${commentsBadge(assignment)}</div>`;
    html += `<div class="mobile-assignment-subject" style="color:${color};">`;
    const subjectName = escapeHtml(assignment.matiere_nom || 'Sans matière');
    if (subject && subject.lien) html += `<a href="${subject.lien}" target="_blank">${subjectName}</a>`;
    else html += subjectName;
    html += `</div></div>`;
  });
  return html;
}

/**
 * Mobile view: today first (even without assignments), then the following days
 * that have assignments, read MOBILE_DAYS_STEP days at a time when the end of
 * the list gets close. The number of days shown is kept from one render to the
 * next (realtime, "done" checkbox) so that the page does not jump back to the
 * top.
 */
function renderMobileScrollView() {
  const calendar = document.getElementById('calendar');
  const today = todayLocal();
  const todayStr = dateKey(today);
  document.getElementById('current-month').textContent = 'À venir';

  let html = '<div class="mobile-view">';
  let shownMonth = null;
  let endOfYear = false;
  for (let i = 0; i < mobileDaysShown; i++) {
    const date = addDays(today, i);
    const dateStr = dateKey(date);
    if (dateStr > maxDateStr) {
      endOfYear = true;
      break;
    }

    const dayAssignments = assignmentsOfDay(dateStr);
    if (dayAssignments.length === 0 && dateStr !== todayStr) continue;

    const month = `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
    if (month !== shownMonth) {
      html += `<div class="mobile-month-separator">${month}</div>`;
      shownMonth = month;
    }

    let headerClass = 'week-day-header';
    if (dateStr === todayStr) headerClass += ' today';
    if (!isDateStrInSchoolYear(dateStr)) headerClass += ' out-of-range';

    html += `<div class="week-day-card"><div class="${headerClass}" data-date="${dateStr}">`;
    html += `<div class="week-day-name">${DAY_NAMES[date.getDay()]}</div><div class="week-day-number">${date.getDate()}</div></div>`;
    if (dayAssignments.length > 0) html += `<div class="week-day-assignments">${renderMobileAssignmentItems(dayAssignments)}</div>`;
    else html += '<div class="week-day-assignments empty">Aucun devoir</div>';
    html += '</div>';
  }
  html += endOfYear
    ? '<div class="mobile-scroll-end">Fin de l\'année scolaire</div>'
    : '<div id="mobile-scroll-sentinel" class="mobile-scroll-sentinel"></div>';
  html += '</div>';
  calendar.innerHTML = html;

  const sentinel = document.getElementById('mobile-scroll-sentinel');
  if (sentinel && 'IntersectionObserver' in window) {
    mobileObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      mobileDaysShown += MOBILE_DAYS_STEP;
      renderCalendar();
    }, { rootMargin: '0px 0px 600px 0px' });
    mobileObserver.observe(sentinel);
  }
}

/** Past assignments: one week at a time (< > navigation), days without assignments left out. */
function renderPastWeekView() {
  const calendar = document.getElementById('calendar');
  if (!pastWeekStart) pastWeekStart = lastPastWeekStart();
  const sunday = addDays(pastWeekStart, 6);
  document.getElementById('current-month').textContent =
    `${pastWeekStart.getDate()} ${MONTH_NAMES[pastWeekStart.getMonth()]} - ${sunday.getDate()} ${MONTH_NAMES[sunday.getMonth()]} ${sunday.getFullYear()}`;

  const todayStr = dateKey(todayLocal());
  let html = '<div class="past-view">';
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(pastWeekStart, i);
    const dateStr = dateKey(date);
    if (dateStr >= todayStr) break;
    const dayAssignments = assignmentsOfDay(dateStr);
    if (dayAssignments.length === 0) continue;
    total += dayAssignments.length;
    html += `<div class="past-day"><div class="past-day-title">${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()].toLowerCase()}</div>`;
    html += renderMobileAssignmentItems(dayAssignments);
    html += '</div>';
  }
  if (total === 0) html += '<div class="past-empty">Aucun devoir cette semaine</div>';
  html += '</div>';
  calendar.innerHTML = html;
}

function renderDesktopMonthView() {
  const calendar = document.getElementById('calendar');
  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  document.getElementById('current-month').textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;

  const firstDay = localDate(currentYear, currentMonth, 1);
  const lastDay = localDate(currentYear, currentMonth + 1, 0);
  const prevLastDay = localDate(currentYear, currentMonth, 0);

  const firstDayIndex = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const lastDayDate = lastDay.getDate();
  const prevLastDayDate = prevLastDay.getDate();
  const nextDays = 7 - (lastDay.getDay() === 0 ? 6 : lastDay.getDay() - 1) - 1;

  let calendarHtml = '<div class="calendar-days">';
  dayNames.forEach(day => { calendarHtml += `<div class="calendar-day-header">${day}</div>`; });
  calendarHtml += '</div><div class="calendar-dates">';

  for (let x = firstDayIndex; x > 0; x--) {
    calendarHtml += renderDateCell(localDate(currentYear, currentMonth - 1, prevLastDayDate - x + 1), true);
  }
  for (let i = 1; i <= lastDayDate; i++) {
    calendarHtml += renderDateCell(localDate(currentYear, currentMonth, i), false);
  }
  for (let j = 1; j <= nextDays; j++) {
    calendarHtml += renderDateCell(localDate(currentYear, currentMonth + 1, j), true);
  }

  calendarHtml += '</div>';
  calendar.innerHTML = calendarHtml;
}

function renderDateCell(date, otherMonth) {
  const isToday = date.toDateString() === new Date().toDateString();
  const dateStr = date.toISOString().split('T')[0];

  const dayAssignments = assignments.filter(a => {
    if (!a.date) return false;
    return a.date.split('T')[0] === dateStr;
  }).sort((a, b) => a.fait - b.fait);

  let classes = 'calendar-date';
  if (otherMonth) classes += ' other-month';
  if (isToday) classes += ' today';
  if (!isDateStrInSchoolYear(dateStr)) classes += ' out-of-range';

  let html = `<div class="${classes}" data-date="${dateStr}">`;
  html += `<div class="date-number">${date.getDate()}</div><div class="date-assignments">`;

  dayAssignments.forEach(assignment => {
    const subject = subjects.find(s => s.id === assignment.matiere_id);
    const color = subject?.couleur || '#999';
    const textColor = getContrastColor(color);
    html += `<div class="assignment-item ${assignment.fait ? 'done' : ''}" data-assignment-id="${assignment.id}" style="background-color:${color};color:${textColor};"><span class="assignment-item-title">${escapeHtml(assignment.titre)}</span>${commentsBadge(assignment)}</div>`;
  });

  html += '</div></div>';
  return html;
}

function handleCalendarClick(e) {
  if (e.target.closest('.mobile-assignment-item')) {
    e.stopPropagation();
    showAssignmentModal(parseInt(e.target.closest('.mobile-assignment-item').dataset.assignmentId));
    return;
  }
  if (e.target.closest('.assignment-item')) {
    e.stopPropagation();
    showAssignmentModal(parseInt(e.target.closest('.assignment-item').dataset.assignmentId));
    return;
  }
  if (e.target.closest('.week-day-header')) {
    e.stopPropagation();
    const header = e.target.closest('.week-day-header');
    if (header.classList.contains('out-of-range')) return;
    selectedDate = header.dataset.date;
    showAddAssignmentModal(selectedDate);
    return;
  }
  if (e.target.closest('.calendar-date')) {
    const cell = e.target.closest('.calendar-date');
    if (cell.classList.contains('out-of-range')) return;
    selectedDate = cell.dataset.date;
    showAddAssignmentModal(selectedDate);
  }
}

/**
 * Shows the details of an assignment.
 *
 * When the same assignment is redrawn (changed remotely), the comment being
 * typed is kept, and the comments and documents stay unfolded if they were.
 * When an assignment is opened, both are folded. The comments come after the
 * actions so that the discussion does not push "Marquer comme fait" down; the
 * quiz stays outside the folding documents block, always visible. The textarea
 * height can only be measured once the modal is visible (a kept draft may span
 * several lines).
 *
 * @param {number} assignmentId
 * @param {boolean} [unfoldComments] open the discussion directly (link from a comment notification)
 */
async function showAssignmentModal(assignmentId, unfoldComments = false) {
  const assignment = assignments.find(a => a.id === assignmentId);
  if (!assignment) return;

  const previousInput = currentAssignmentId === assignmentId ? document.querySelector('#assignment-comments textarea') : null;
  const draft = previousInput?.value || '';
  const inputFocused = previousInput !== null && document.activeElement === previousInput;
  const commentsOpen = currentAssignmentId === assignmentId
    && document.getElementById('assignment-modal')?.classList.contains('active')
    && document.querySelector('#assignment-comments .comments-content:not([hidden])') !== null;
  const documentsOpen = currentAssignmentId === assignmentId
    && document.getElementById('assignment-modal')?.classList.contains('active')
    && document.querySelector('#assignment-modal-files .documents-content:not([hidden])') !== null;

  currentAssignmentId = assignmentId;
  currentAssignmentSignature = assignmentSignature(assignment);

  const subject = subjects.find(s => s.id === assignment.matiere_id);
  const modalBody = document.getElementById('modal-body');

  let html = `<h3>${escapeHtml(assignment.titre)}</h3><p><strong>Matière:</strong> `;
  const subjectName = escapeHtml(assignment.matiere_nom || 'Non définie');
  if (subject && subject.lien) html += `<a href="${subject.lien}" target="_blank">${subjectName}</a>`;
  else html += subjectName;
  html += '</p>';
  if (assignment.description) {
    html += `<p><strong>Description:</strong></p><div class="markdown-body">${renderMarkdown(assignment.description)}</div>`;
  }
  html += `<div id="assignment-modal-files" class="documents"></div>`;
  html += `<div id="assignment-quiz-section"></div>`;
  html += `<div class="modal-actions">
    <label class="checkbox-container"><input type="checkbox" ${assignment.fait ? 'checked' : ''} id="assignment-status-${assignment.id}"><span>Marquer comme fait</span></label>
    <button class="btn-secondary" id="export-assignment-${assignment.id}">Exporter / Partager</button>
    <button class="btn-secondary" id="edit-assignment-${assignment.id}">Modifier</button>
    <button class="btn-danger" id="delete-assignment-${assignment.id}">Supprimer</button>
  </div>`;

  html += `<section id="assignment-comments" class="comments" aria-label="Commentaires"></section>`;

  modalBody.innerHTML = html;
  hydrateMarkdownImages(modalBody);
  loadAssignmentModalFiles(assignmentId, documentsOpen);
  loadQuizStatus(assignmentId);
  initComments(assignmentId, draft, unfoldComments || commentsOpen || inputFocused);
  if (inputFocused) document.querySelector('#assignment-comments textarea').focus();
  loadComments(assignmentId);

  document.getElementById(`assignment-status-${assignment.id}`).addEventListener('change', async function() {
    await toggleAssignmentStatus(assignment.id, this.checked);
    toggleModal('assignment-modal', false);
  });

  document.getElementById(`export-assignment-${assignment.id}`).addEventListener('click', async () => {
    await shareAssignment(assignment);
  });

  document.getElementById(`edit-assignment-${assignment.id}`).addEventListener('click', () => editAssignment(assignment.id));
  document.getElementById(`delete-assignment-${assignment.id}`).addEventListener('click', () => deleteAssignment(assignment.id));

  toggleModal('assignment-modal', true);
  fitTextarea(document.querySelector('#assignment-comments textarea'));
}

/** Shares a link that opens the assignment from the URL (copied to the clipboard, or prompted as a last resort). */
async function shareAssignment(assignment) {
  const url = new URL('/dashboard', window.location.origin);
  url.searchParams.set('devoir', String(assignment.id));

  const shareData = {
    title: `Devoir: ${assignment.titre || ''}`,
    text: `Ouvre ce lien pour voir le devoir "${assignment.titre || ''}"`,
    url: url.toString()
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareData.url);
      await showAlert('Lien copié dans le presse-papier.', 'Partager');
      return;
    }

    prompt('Copie ce lien :', shareData.url);
  } catch (e) {
    console.error('Sharing the assignment failed:', e);
    await showAlert('Impossible de partager pour le moment.', 'Erreur');
  }
}

/**
 * Opens the modal when the page is loaded with ?devoir=123 (&commentaires=1
 * unfolds the discussion). When the assignments are not loaded yet, it retries
 * every 200 ms for about 4 s.
 */
function openAssignmentFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const assignmentId = parseInt(params.get('devoir'), 10);
  if (!Number.isFinite(assignmentId)) return;
  const unfoldComments = params.get('commentaires') === '1';

  const tryOpen = () => {
    const exists = assignments.some(a => a.id === assignmentId);
    if (exists) {
      showAssignmentModal(assignmentId, unfoldComments);
      return true;
    }
    return false;
  };

  if (tryOpen()) return;

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (tryOpen() || attempts > 20) clearInterval(timer);
  }, 200);
}

function commentsBadge(assignment) {
  const n = Number(assignment.nb_commentaires) || 0;
  return n > 0 ? ` <span class="comments-badge" title="${n} commentaire${n > 1 ? 's' : ''}">💬 ${n}</span>` : '';
}

function formatCommentDate(value) {
  const date = new Date(value);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? `aujourd'hui à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Fits the textarea height to its text, without a scrollbar before the CSS
 * max-height. No effect while the modal is hidden (scrollHeight is zero).
 */
function fitTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  if (!textarea.scrollHeight) return;
  textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > textarea.clientHeight ? 'auto' : 'hidden';
}

function commentsTitle(n) {
  return `💬 Commentaires (${Number(n) || 0})`;
}

/**
 * Builds the comment section once per display of the assignment: refreshes only
 * replace the list, so as not to disturb an input in progress.
 *
 * Folded by default: only the "Commentaires (n)" line is visible, and a click
 * shows the discussion and the input. Enter sends and Shift+Enter adds a line;
 * on touch screens (no Shift) and during an IME composition, Enter keeps its
 * normal role. After sending, the modal may have been redrawn: the displayed
 * input is only cleared if it still holds the sent text.
 */
function initComments(assignmentId, draft, open = false) {
  const assignment = assignments.find(a => a.id === assignmentId);
  const section = document.getElementById('assignment-comments');
  section.innerHTML = `
    <h4>
      <button type="button" class="comments-toggle" aria-expanded="${open}" aria-controls="comments-content">
        <span class="comments-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
        <span class="comments-title">${commentsTitle(assignment?.nb_commentaires)}</span>
      </button>
    </h4>
    <div class="comments-content" id="comments-content"${open ? '' : ' hidden'}>
      <div class="comments-thread"></div>
      <form class="comment-form">
        <textarea rows="1" maxlength="2000" placeholder="Écrire un commentaire…" required></textarea>
        <button type="submit" class="btn-primary">Envoyer</button>
      </form>
    </div>`;

  const form = section.querySelector('form');
  const textarea = form.querySelector('textarea');
  textarea.value = draft;
  fitTextarea(textarea);

  const toggle = section.querySelector('.comments-toggle');
  const content = section.querySelector('.comments-content');
  toggle.addEventListener('click', () => {
    const unfold = content.hidden;
    content.hidden = !unfold;
    toggle.setAttribute('aria-expanded', String(unfold));
    toggle.querySelector('.comments-chevron').textContent = unfold ? '▾' : '▸';
    if (!unfold) return;
    fitTextarea(textarea);
    const list = section.querySelector('.comments-list');
    if (list) list.scrollTop = list.scrollHeight;
  });
  textarea.addEventListener('input', () => fitTextarea(textarea));
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text || commentSending) return;
    commentSending = true;
    form.querySelector('button').disabled = true;
    try {
      const result = await apiCall(`/api/devoirs/${assignmentId}/commentaires`, {
        method: 'POST',
        body: JSON.stringify({ contenu: text })
      });
      if (result.error) {
        await showAlert(result.error, 'Erreur');
        return;
      }
      const shown = document.querySelector('#assignment-comments textarea');
      if (currentAssignmentId === assignmentId && shown?.value.trim() === text) {
        shown.value = '';
        fitTextarea(shown);
      }
      await loadComments(assignmentId);
    } finally {
      commentSending = false;
      document.querySelector('#assignment-comments .comment-form button')?.removeAttribute('disabled');
    }
  });

  section.querySelector('.comments-thread').addEventListener('click', async (e) => {
    const btn = e.target.closest('.comment-delete');
    if (!btn) return;
    if (!await showConfirm('Supprimer ce commentaire ?', 'Supprimer')) return;
    const result = await apiCall(`/api/devoirs/${assignmentId}/commentaires/${btn.dataset.id}`, { method: 'DELETE' });
    if (result.error) {
      await showAlert(result.error, 'Erreur');
      return;
    }
    await loadComments(assignmentId);
  });
}

/**
 * Loads the comments of the open assignment. A response is dropped when the
 * modal switched to another assignment or a newer request left meanwhile. The
 * calendar badge follows the list, without reloading every assignment. The
 * reading position is kept, or the list stays at the bottom when it was there
 * (last message visible); a first display starts at the bottom, as when
 * unfolding.
 */
async function loadComments(assignmentId) {
  const request = ++commentsRequest;
  const comments = await apiCall(`/api/devoirs/${assignmentId}/commentaires`);
  if (request !== commentsRequest || currentAssignmentId !== assignmentId || comments.error) return;

  const assignment = assignments.find(a => a.id === assignmentId);
  if (assignment && Number(assignment.nb_commentaires) !== comments.length) {
    assignment.nb_commentaires = comments.length;
    renderCalendar();
  }

  const section = document.getElementById('assignment-comments');
  const thread = section?.querySelector('.comments-thread');
  if (!thread) return;

  const items = comments.map((c) => {
    const author = [c.prenom, c.nom].filter(Boolean).join(' ') || c.username;
    return `<li class="comment">
      <div class="comment-header">
        <strong>${escapeHtml(author)}</strong>
        <span>${formatCommentDate(c.created_at)}</span>
        ${c.supprimable ? `<button type="button" class="comment-delete" data-id="${c.id}" aria-label="Supprimer ce commentaire">&times;</button>` : ''}
      </div>
      <p>${escapeHtml(c.contenu)}</p>
    </li>`;
  }).join('');

  const previousList = thread.querySelector('.comments-list');
  const atBottom = !previousList || previousList.scrollHeight - previousList.scrollTop - previousList.clientHeight < 4;
  const scrollTop = previousList?.scrollTop || 0;

  section.querySelector('.comments-title').textContent = commentsTitle(comments.length);
  thread.innerHTML = items
    ? `<ul class="comments-list">${items}</ul>`
    : '<p class="comments-empty">Une question sur ce devoir ? Posez-la à la classe.</p>';

  const newList = thread.querySelector('.comments-list');
  if (newList) newList.scrollTop = atBottom ? newList.scrollHeight : scrollTop;
}

/**
 * Documents block of the details modal, folded by default: only the
 * "Documents (n)" line is visible and a click shows the list. A refresh of the
 * list keeps the folding state; openByDefault only applies when an assignment
 * is displayed (redrawn while it was open).
 */
async function loadAssignmentModalFiles(assignmentId, openByDefault = false) {
  const container = document.getElementById('assignment-modal-files');
  if (!container) return;
  try {
    const files = await apiCall(`/api/devoirs/${assignmentId}/fichiers`);
    if (!files || files.length === 0) { container.innerHTML = ''; return; }

    const currentToggle = container.querySelector('.documents-toggle');
    const open = currentToggle ? currentToggle.getAttribute('aria-expanded') === 'true' : openByDefault;

    const rows = files.map(file => `
      <div class="document-item" onclick="openFile(${file.id})">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        <div class="document-info">
          <div class="document-name">${escapeHtml(file.original_name)}</div>
          <div class="document-author">Uploadé par ${escapeHtml(file.uploaded_by_username || 'Inconnu')}</div>
        </div>
      </div>`).join('');

    container.innerHTML = `
      <h4>
        <button type="button" class="documents-toggle" aria-expanded="${open}" aria-controls="documents-content">
          <span class="documents-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
          <span>📄 Documents (${files.length})</span>
        </button>
      </h4>
      <div class="documents-content" id="documents-content"${open ? '' : ' hidden'}>${rows}</div>`;

    const toggle = container.querySelector('.documents-toggle');
    const content = container.querySelector('.documents-content');
    toggle.addEventListener('click', () => {
      const unfold = content.hidden;
      content.hidden = !unfold;
      toggle.setAttribute('aria-expanded', String(unfold));
      toggle.querySelector('.documents-chevron').textContent = unfold ? '▾' : '▸';
    });
  } catch { container.innerHTML = ''; }
}

/** Uploads the files one by one. Multipart uploads bypass apiCall, so the realtime header is added here. */
async function uploadFiles(assignmentId, files, statusBtn) {
  for (let i = 0; i < files.length; i++) {
    const formData = new FormData();
    formData.append('pdf', files[i]);
    try {
      const realtimeId = getRealtimeId();
      await fetch(`/api/devoirs/${assignmentId}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          ...(realtimeId ? { 'X-Realtime-Id': realtimeId } : {})
        },
        body: formData
      });
    } catch (err) {
      console.error('Upload error:', err);
    }
    if (statusBtn) {
      statusBtn.textContent = `Upload (${i + 1}/${files.length})...`;
    }
  }
}

function showAddAssignmentModal(dateStr) {
  if (dateStr) document.getElementById('assignment-due-date').value = dateStr;
  accumulatedFiles.length = 0;
  document.getElementById('assignment-files-list').innerHTML = '';
  updateSubjectSelects();
  toggleModal('add-assignment-modal', true);
}

async function handleAddAssignment(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('add-assignment-submit-btn');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Création en cours...';
  isSubmitting = true;

  try {
    const data = await apiCall('/api/devoirs', {
      method: 'POST',
      body: JSON.stringify({
        titre: document.getElementById('assignment-title').value,
        description: document.getElementById('assignment-description').value,
        matiere_id: document.getElementById('assignment-subject').value,
        date: document.getElementById('assignment-due-date').value
      })
    });

    if (data.error) {
      await showAlert(data.error, 'Erreur');
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      return;
    }

    if (accumulatedFiles.length > 0) {
      await uploadFiles(data.devoirId, accumulatedFiles, submitBtn);
    }

    toggleModal('add-assignment-modal', false);
    document.getElementById('assignment-form').reset();
    accumulatedFiles.length = 0;
    document.getElementById('assignment-files-list').innerHTML = '';
    await loadAssignments();
    renderCalendar();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
    isSubmitting = false;
    flushQueuedRefresh();
  }
}

async function editAssignment(id) {
  const assignment = assignments.find(a => a.id === id);
  if (!assignment) return;
  toggleModal('assignment-modal', false);

  resetEditAssignmentBanners();
  accumulatedEditFiles.length = 0;
  document.getElementById('edit-assignment-new-files-list').innerHTML = '';
  await fillEditAssignmentForm(assignment);
  toggleModal('edit-assignment-modal', true);
}

/**
 * Loads an assignment in the edit form and remembers its version: this baseline
 * tells that another user changed it while the form was being filled. The files
 * added by the user are left untouched.
 */
async function fillEditAssignmentForm(assignment) {
  document.getElementById('edit-assignment-id').value = assignment.id;
  document.getElementById('edit-assignment-title').value = assignment.titre;
  document.getElementById('edit-assignment-description').value = assignment.description || '';
  document.getElementById('edit-assignment-due-date').value = toInputDate(assignment.date);

  updateSubjectSelects();
  document.getElementById('edit-assignment-subject').value = assignment.matiere_id || '';

  editAssignmentBaseline = assignmentSignature(assignment);
  await loadExistingFiles(assignment.id);
}

async function loadExistingFiles(assignmentId) {
  const container = document.getElementById('edit-assignment-existing-files');
  container.innerHTML = '';
  try {
    const files = await apiCall(`/api/devoirs/${assignmentId}/fichiers`);
    if (!files || files.length === 0) return;

    container.innerHTML = files.map(f => `
      <div style="padding:0.5rem;background:white;border-radius:4px;margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);">
        <a href="#" onclick="openFile(${f.id}); return false;" style="color:var(--primary);text-decoration:none;font-size:0.9rem;">${escapeHtml(f.original_name)}</a>
        <button type="button" class="btn-danger" style="padding:0.25rem 0.5rem;font-size:0.8rem;" onclick="deleteFile(${f.id}, ${assignmentId})">Supprimer</button>
      </div>
    `).join('');
  } catch { container.innerHTML = ''; }
}

/**
 * Opens an attached file. Documents no longer have a fixed address: a
 * temporary link (restricted to the class) is requested, then opened. The tab
 * is opened right away, during the click, otherwise browsers block the window.
 */
window.openFile = async function(fileId) {
  const tab = window.open('', '_blank');
  const data = await apiCall(`/api/devoirs/fichiers/${fileId}/lien`);
  if (data.error || !data.url) {
    if (tab) tab.close();
    await showAlert(data.error || 'Impossible d\'ouvrir le document', 'Erreur');
    return;
  }
  if (tab) tab.location.href = data.url;
  else window.location.href = data.url;
};

window.deleteFile = async function(fileId, assignmentId) {
  const confirmed = await showConfirm('Supprimer ce fichier ?', 'Confirmation');
  if (!confirmed) return;
  const result = await apiCall(`/api/devoirs/fichiers/${fileId}`, { method: 'DELETE' });
  if (result.error) { await showAlert(result.error, 'Erreur'); return; }
  await loadExistingFiles(assignmentId);
};

/**
 * Saves the edit form. When the assignment was deleted by someone else during
 * the edit, the input is kept and saved as a new assignment; the button label
 * follows that mode, so a failed re-creation stays a re-creation.
 */
async function handleEditAssignment(e) {
  e.preventDefault();
  const id = document.getElementById('edit-assignment-id').value;
  const submitBtn = document.getElementById('edit-assignment-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = editAssignmentRecreate ? 'Recréation en cours...' : 'Enregistrement...';
  isSubmitting = true;

  try {
    const payload = JSON.stringify({
      titre: document.getElementById('edit-assignment-title').value,
      description: document.getElementById('edit-assignment-description').value,
      matiere_id: document.getElementById('edit-assignment-subject').value,
      date: document.getElementById('edit-assignment-due-date').value
    });

    const data = editAssignmentRecreate
      ? await apiCall('/api/devoirs', { method: 'POST', body: payload })
      : await apiCall(`/api/devoirs/${id}`, { method: 'PUT', body: payload });

    if (data.error) {
      await showAlert(data.error, 'Erreur');
      return;
    }

    const targetId = editAssignmentRecreate ? data.devoirId : id;
    if (accumulatedEditFiles.length > 0) {
      await uploadFiles(targetId, accumulatedEditFiles);
    }

    toggleModal('edit-assignment-modal', false);
    document.getElementById('edit-assignment-form').reset();
    resetEditAssignmentBanners();
    accumulatedEditFiles.length = 0;
    document.getElementById('edit-assignment-new-files-list').innerHTML = '';
    document.getElementById('edit-assignment-existing-files').innerHTML = '';
    await loadAssignments();
    renderCalendar();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editAssignmentRecreate ? 'Recréer le devoir' : 'Enregistrer';
    isSubmitting = false;
    flushQueuedRefresh();
  }
}

async function deleteAssignment(id) {
  const confirmed = await showConfirm('Supprimer ce devoir ?', 'Confirmation');
  if (!confirmed) return;
  await apiCall(`/api/devoirs/${id}`, { method: 'DELETE' });
  toggleModal('assignment-modal', false);
  await loadAssignments();
  renderCalendar();
}

async function loadQuizStatus(assignmentId) {
  const container = document.getElementById('assignment-quiz-section');
  if (!container) return;

  try {
    const status = await apiCall(`/api/devoirs/${assignmentId}/quiz-status`);
    if (!status.hasDocuments) { container.innerHTML = ''; return; }

    let html = '<div class="quiz-box">';

    if (status.isGenerating) {
      html += `<div class="quiz-box-row" style="justify-content:flex-start;gap:0.75rem;">
        <div class="quiz-spinner"></div>
        <div><div class="quiz-box-title">Génération en cours...</div>
        <div class="quiz-box-text">Vous recevrez un email quand le quiz sera prêt</div></div></div>`;
    } else if (status.hasQuiz) {
      html += `<div class="quiz-box-row">
        <div><div class="quiz-box-title">Quiz disponible</div>
        <div class="quiz-box-text">Réviser avec un questionnaire interactif</div></div>
        <button onclick="startQuiz(${assignmentId})" class="btn-primary" style="white-space:nowrap;">S'entraîner</button></div>`;
    } else if (status.quizEnabled) {
      html += `<div class="quiz-box-row">
        <div><div class="quiz-box-title">Documents disponibles</div>
        <div class="quiz-box-text">Générer 20-100 questions avec IA</div></div>
        <button onclick="generateQuiz(${assignmentId})" class="btn-primary" style="white-space:nowrap;">Générer Quiz</button></div>`;
    } else {
      container.innerHTML = '';
      return;
    }

    html += '</div>';
    container.innerHTML = html;
  } catch { container.innerHTML = ''; }
}

window.startQuiz = function(assignmentId) { window.location.href = `/quiz?id=${assignmentId}`; };

window.generateQuiz = async function(assignmentId) {
  const confirmed = await showConfirm('La génération peut prendre quelques minutes. Continuer ?', 'Générer le quiz');
  if (!confirmed) return;

  try {
    const result = await apiCall(`/api/devoirs/${assignmentId}/generate-quiz`, { method: 'POST' });
    if (result.error) { await showAlert(result.error, 'Erreur'); return; }
    await showAlert('Génération démarrée ! Email envoyé quand prêt.', 'Quiz');
    await loadQuizStatus(assignmentId);
  } catch { await showAlert('Erreur lors de la génération', 'Erreur'); }
};

async function toggleAssignmentStatus(assignmentId, done) {
  await apiCall(`/api/devoirs/${assignmentId}/statut`, {
    method: 'POST',
    body: JSON.stringify({ fait: done })
  });
  await loadAssignments();
  renderCalendar();
}

init();
