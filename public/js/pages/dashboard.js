import { apiCall, checkAuth, logout } from '../utils/api.js?v=5';
import { escapeHTML, localDate, formatDate, toInputDate, toggleModal, setupModalClose, showAlert, showConfirm, getContrastColor } from '../utils/dom.js?v=3';
import { renderMarkdown, hydrateMarkdownImages } from '../utils/markdown.js?v=2';
import { connectRealtime, getRealtimeId } from '../utils/realtime.js?v=1';
import { syncPushSubscription } from '../utils/push.js?v=2';

let matieres = [];
let devoirs = [];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
// Vue mobile : liste continue de jours à partir d'aujourd'hui, prolongée au défilement
const MOBILE_DAYS_STEP = 14;
let mobileDaysShown = MOBILE_DAYS_STEP;
let mobileObserver = null;
// Vue « devoirs passés » (/dashboard/?vue=passes) : une semaine à la fois
let vuePasses = new URLSearchParams(window.location.search).get('vue') === 'passes';
let pastWeekStart = null;
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
let selectedDate = null;
let isMobileView = false;
let authData = null;

// L'annee scolaire commence en septembre (mois 8) et se termine en aout
const SCHOOL_YEAR_START_MONTH = 8;
const schoolYear = getSchoolYear();

function getSchoolYear(reference = new Date()) {
  const startYear = reference.getMonth() >= SCHOOL_YEAR_START_MONTH
    ? reference.getFullYear()
    : reference.getFullYear() - 1;

  return {
    startYear,
    endYear: startYear + 1,
    // 1er septembre de l'annee de debut
    firstDay: new Date(startYear, SCHOOL_YEAR_START_MONTH, 1),
    // Dernier jour d'aout de l'annee de fin
    lastDay: new Date(startYear + 1, SCHOOL_YEAR_START_MONTH, 0)
  };
}

function monthIndex(year, month) {
  return year * 12 + month;
}

const minMonthIndex = monthIndex(schoolYear.startYear, SCHOOL_YEAR_START_MONTH);
const maxMonthIndex = monthIndex(schoolYear.endYear, SCHOOL_YEAR_START_MONTH - 1);

// Bornes au format YYYY-MM-DD, comparables directement aux dates des cellules
const minDateStr = toInputDate(schoolYear.firstDay);
const maxDateStr = toInputDate(schoolYear.lastDay);

function isDateStrInSchoolYear(dateStr) {
  return dateStr >= minDateStr && dateStr <= maxDateStr;
}

// Stockage des fichiers accumulés
let accumulatedFiles = [];
let accumulatedEditFiles = [];

// Temps réel : état des rafraîchissements déclenchés par les autres membres de la classe
let currentDevoirId = null;        // devoir affiché dans #devoir-modal
let currentDevoirSignature = null; // état du devoir au moment du rendu du modal
let editDevoirRecreate = false;    // le devoir en cours d'édition a été supprimé ailleurs
let editDevoirBaseline = null;     // version du devoir chargée dans le formulaire d'édition
let refreshTimer = null;
let refreshQueued = false;         // un rafraîchissement attend la fin d'un envoi local
let isSubmitting = false;
const pendingResources = new Set();

async function init() {
  authData = await checkAuth();

  if (!authData.authenticated) return;

  // Setup user info
  document.getElementById('eleve-info').textContent = authData.username;

  // Show admin menu item if admin
  if (authData.is_admin) {
    document.getElementById('admin-btn').classList.remove('hidden');
    // Load pending join requests count for the badge
    loadJoinRequestsCount();
  }

  setupUserMenu();

  // Synchroniser le libellé du bouton de thème avant les sorties anticipées ci-dessous
  loadThemePreference();

  // Check pending request
  if (authData.pending_request) {
    document.getElementById('pending-banner').style.display = 'block';
    document.getElementById('pending-classe-name').textContent = authData.pending_request.classe_nom;
    document.getElementById('main-content').style.display = 'none';
    return;
  }

  // If user has no class and isn't admin, show message
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
  ouvrirDevoirDepuisURL();
  syncPushSubscription();

  // Mises à jour temps réel : uniquement pour les utilisateurs rattachés à une
  // classe, les seuls qui peuvent recevoir quelque chose.
  if (authData.classe_id) {
    connectRealtime({
      onUpdate: (message) => scheduleRefresh(message.resource, message.devoirId),
      onResync: () => scheduleRefresh('*', null)
    });
  }
}

// ============= TEMPS RÉEL =============

const REFRESH_DEBOUNCE_MS = 400;
let refreshDevoirId = null;

// Une seule action distante (modifier un devoir puis envoyer trois fichiers) émet
// plusieurs trames : on les regroupe pour ne recharger qu'une fois.
function scheduleRefresh(resource, devoirId) {
  if (!resource) return;

  pendingResources.add(resource);
  if (devoirId) refreshDevoirId = devoirId;

  // Un envoi local est en cours : le rafraîchissement attendra sa fin pour ne pas
  // recharger des données à moitié écrites.
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

async function applyRefresh() {
  refreshTimer = null;

  const resources = new Set(pendingResources);
  const devoirId = refreshDevoirId;
  pendingResources.clear();
  refreshDevoirId = null;

  const isResync = resources.has('*');
  const wantsMatieres = isResync || resources.has('matieres');
  const wantsDevoirs = isResync || ['devoirs', 'fichiers', 'quiz'].some(r => resources.has(r));

  const tasks = [];
  if (wantsMatieres) tasks.push(loadMatieres());
  if (wantsDevoirs) tasks.push(loadDevoirs());
  if (tasks.length === 0) return;

  await Promise.all(tasks);
  renderCalendar();
  await refreshOpenModals(resources, devoirId);
}

function isModalOpen(modalId) {
  return Boolean(document.getElementById(modalId)?.classList.contains('active'));
}

// Le statut "fait" est volontairement exclu : il est propre à chaque utilisateur
// et ne peut pas changer du fait d'une action distante.
function devoirSignature(devoir) {
  if (!devoir) return null;
  return [devoir.titre, devoir.description, devoir.matiere_id, devoir.date].join('|');
}

async function refreshOpenModals(resources, devoirId) {
  const isResync = resources.has('*');

  if (isModalOpen('devoir-modal') && currentDevoirId) {
    const devoir = devoirs.find(d => d.id === currentDevoirId);

    if (!devoir) {
      toggleModal('devoir-modal', false);
      currentDevoirId = null;
      currentDevoirSignature = null;
      await showAlert("Ce devoir vient d'être supprimé par un autre utilisateur.", 'Devoir supprimé');
    } else if (isResync || !devoirId || devoirId === currentDevoirId) {
      if (resources.has('fichiers')) loadDevoirModalFichiers(currentDevoirId);
      if (resources.has('quiz')) loadQuizStatus(currentDevoirId);

      // Rendu complet uniquement si le contenu a réellement changé : il réinitialise
      // le défilement, gênant sur les longues descriptions.
      const signature = devoirSignature(devoir);
      if ((isResync || resources.has('devoirs')) && signature !== currentDevoirSignature) {
        await showDevoirModal(currentDevoirId);
      }
    }
  }

  if (isModalOpen('edit-devoir-modal') && !editDevoirRecreate) {
    const editedId = parseInt(document.getElementById('edit-devoir-id').value, 10);
    const devoir = Number.isFinite(editedId) ? devoirs.find(d => d.id === editedId) : null;

    if (Number.isFinite(editedId) && !devoir) {
      markEditDevoirAsDeleted();
    } else if (devoir) {
      // La liste des fichiers existants n'est qu'un reflet de l'état du serveur :
      // la rafraîchir ne peut rien écraser de ce que l'utilisateur a saisi.
      if (isResync || resources.has('fichiers')) loadExistingFiles(editedId);

      // Les champs du formulaire, eux, contiennent peut-être une saisie en cours :
      // on se contente de signaler la divergence, le rechargement reste au choix
      // de l'utilisateur.
      setEditDevoirModifie(devoirSignature(devoir) !== editDevoirBaseline);
    }
  }
}

function setEditDevoirModifie(modifie) {
  document.getElementById('edit-devoir-modifie-banner').classList.toggle('hidden', !modifie);
}

// Remplace la saisie en cours par la version distante, à la demande explicite de
// l'utilisateur via le bouton du bandeau.
async function rechargerDevoirEnEdition() {
  const editedId = parseInt(document.getElementById('edit-devoir-id').value, 10);
  const devoir = devoirs.find(d => d.id === editedId);
  if (!devoir) return;

  await fillEditDevoirForm(devoir);
  setEditDevoirModifie(false);
}

// Le devoir en cours d'édition a disparu : on conserve la saisie de l'utilisateur
// et l'enregistrement devient une recréation.
function markEditDevoirAsDeleted() {
  editDevoirRecreate = true;
  document.getElementById('edit-devoir-supprime-banner').classList.remove('hidden');
  document.getElementById('edit-devoir-submit-btn').textContent = 'Recréer le devoir';
  // La suppression prime sur une éventuelle modification signalée auparavant.
  setEditDevoirModifie(false);
  // Les fichiers joints ont été supprimés en cascade avec le devoir.
  document.getElementById('edit-devoir-fichiers-existants').innerHTML = '';
}

function resetEditDevoirBanners() {
  editDevoirRecreate = false;
  document.getElementById('edit-devoir-supprime-banner').classList.add('hidden');
  document.getElementById('edit-devoir-submit-btn').textContent = 'Enregistrer';
  setEditDevoirModifie(false);
}

// Le thème lui-même est déjà appliqué par /js/theme-init.js avant le premier rendu,
// il ne reste qu'à synchroniser le bouton du menu.
function loadThemePreference() {
  updateThemeButton(document.documentElement.classList.contains('dark-theme'));
}

// Fonction pour basculer le thème
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeButton(isDark);
}

// Fonction pour mettre à jour l'icône et le texte du bouton de thème
function updateThemeButton(isDark) {
  const themeIcon = document.getElementById('theme-icon');
  const themeText = document.getElementById('theme-text');
  
  if (isDark) {
    // Icône de soleil pour mode sombre
    themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    themeText.textContent = 'Thème clair';
  } else {
    // Icône de lune pour mode clair
    themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    themeText.textContent = 'Thème sombre';
  }
}

function setupUserMenu() {
  const menuBtn = document.getElementById('user-menu-btn');
  const dropdown = document.getElementById('user-dropdown');

  menuBtn.addEventListener('click', () => {
    dropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) {
      dropdown.classList.add('hidden');
    }
  });

  // Dropdown items
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('settings-btn').addEventListener('click', () => {
    window.location.href = '/settings';
  });

  const notesBtn = document.getElementById('notes-btn');
  if (notesBtn) {
    notesBtn.addEventListener('click', () => {
      dropdown.classList.add('hidden');
      window.open('https://iut-notes.unice.fr', '_blank');
    });
  }

  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // Admin panel toggle
  const adminBtn = document.getElementById('admin-btn');
  if (adminBtn) {
    adminBtn.addEventListener('click', () => {
      window.location.href = '/admin';
    });
  }

  // Emploi du temps
  checkEmploiTemps();
}

async function checkEmploiTemps() {
  const data = await apiCall('/api/devoirs/settings/emploi-temps');
  if (!data.lien) return;

  const btn = document.getElementById('emploi-temps-btn');
  if (btn) {
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => {
      window.open(data.lien, '_blank');
      document.getElementById('user-dropdown').classList.add('hidden');
    });
  }
}

async function loadJoinRequestsCount() {
  const data = await apiCall('/api/admin/join-requests');
  if (Array.isArray(data) && data.length > 0) {
    // Only looking for update in the dropdown badge
    const badge = document.getElementById('admin-pending-badge');
    if (badge) {
        badge.textContent = data.length;
        badge.classList.remove('hidden');
    }
  }
}

// ============= CALENDAR & DEVOIRS (inchangé) =============

async function loadData() {
  await Promise.all([
    loadMatieres(),
    loadDevoirs()
  ]);
  renderCalendar();
}

async function loadMatieres() {
  const data = await apiCall('/api/admin/matieres');
  if (!data.error) {
    matieres = data;
    updateMatiereSelect();
  }
}

function updateMatiereSelect() {
  const selects = ['devoir-matiere', 'edit-devoir-matiere'];
  selects.forEach(selectId => {
    const select = document.getElementById(selectId);
    if (!select) return;
    // La reconstruction efface la sélection en cours : on la restaure si la
    // matière existe toujours (elle peut avoir été supprimée entre-temps).
    const previousValue = select.value;
    select.innerHTML = '<option value="">Sélectionner une matière</option>';
    matieres.forEach(matiere => {
      const option = document.createElement('option');
      option.value = matiere.id;
      option.textContent = matiere.nom;
      select.appendChild(option);
    });
    if (previousValue && matieres.some(m => String(m.id) === previousValue)) {
      select.value = previousValue;
    }
  });
}

async function loadDevoirs() {
  const data = await apiCall('/api/devoirs');
  if (!data.error) {
    devoirs = data;
  }
}

function setupEventListeners() {
  document.getElementById('prev-month').addEventListener('click', () => {
    if (!navigate(-1)) return;
    renderCalendar();
  });

  document.getElementById('next-month').addEventListener('click', () => {
    if (!navigate(1)) return;
    renderCalendar();
  });

  setupModalClose('devoir-modal', 'close-modal');
  setupModalClose('add-devoir-modal', 'close-add-modal');
  setupModalClose('edit-devoir-modal', 'close-edit-devoir-modal');

  document.getElementById('cancel-devoir-btn').addEventListener('click', () => {
    toggleModal('add-devoir-modal', false);
    document.getElementById('devoir-form').reset();
    accumulatedFiles.length = 0;
    document.getElementById('devoir-fichiers-list').innerHTML = '';
  });

  document.getElementById('cancel-edit-devoir-btn').addEventListener('click', () => {
    toggleModal('edit-devoir-modal', false);
    document.getElementById('edit-devoir-form').reset();
    resetEditDevoirBanners();
    accumulatedEditFiles.length = 0;
    document.getElementById('edit-devoir-nouveaux-fichiers-list').innerHTML = '';
    document.getElementById('edit-devoir-fichiers-existants').innerHTML = '';
  });

  document.getElementById('devoir-form').addEventListener('submit', handleAddDevoir);
  document.getElementById('edit-devoir-form').addEventListener('submit', handleEditDevoir);
  document.getElementById('edit-devoir-recharger-btn').addEventListener('click', rechargerDevoirEnEdition);

  setupDropZone('devoir-drop-zone', 'devoir-fichiers', accumulatedFiles, 'devoir-fichiers-list');
  setupDropZone('edit-devoir-drop-zone', 'edit-devoir-nouveaux-fichiers', accumulatedEditFiles, 'edit-devoir-nouveaux-fichiers-list');

  document.addEventListener('click', handleCalendarClick);

  document.getElementById('vue-toggle-btn').addEventListener('click', () => setVuePasses(!vuePasses));
  // Vue mobile : les jours sans devoir sont masqués, l'ajout passe par ce bouton (date à choisir)
  document.getElementById('add-devoir-fab').addEventListener('click', () => {
    document.getElementById('devoir-date-limite').value = '';
    showAddDevoirModal(null);
  });
  window.addEventListener('popstate', () => {
    const passes = new URLSearchParams(window.location.search).get('vue') === 'passes';
    if (passes !== vuePasses) setVuePasses(passes, { push: false });
  });

  window.addEventListener('resize', () => {
    const wasMobile = isMobileView;
    checkViewport();
    if (wasMobile !== isMobileView) renderCalendar();
  });
}

// Limite les champs date des formulaires a l'annee scolaire en cours
function applySchoolYearLimits() {
  ['devoir-date-limite', 'edit-devoir-date-limite'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.min = minDateStr;
    input.max = maxDateStr;
  });
}

function checkViewport() {
  isMobileView = window.innerWidth <= 768;
}

// Dates « jour » : minuit UTC du jour local (localDate), comparables aux dates des devoirs via dateKey
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

// Dernière semaine qui contient un jour passé (sur un lundi : la semaine précédente)
function lastPastWeekStart() {
  return mondayOf(addDays(todayLocal(), -1));
}

function devoirsDuJour(dateStr) {
  return devoirs.filter(d => d.date && d.date.split('T')[0] === dateStr)
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
    html += `<span style="font-size:0.9rem;flex:1;">${escapeHTML(file.name)} <span style="color:var(--secondary);">(${sizeInMB} Mo)</span></span>`;
    html += `<button type="button" class="btn-danger" style="padding:0.25rem 0.5rem;font-size:0.8rem;" onclick="removeFileFromList(${index}, '${listId}')">Retirer</button>`;
    html += `</div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

window.removeFileFromList = function(index, listId) {
  const fileArray = listId === 'devoir-fichiers-list' ? accumulatedFiles : accumulatedEditFiles;
  fileArray.splice(index, 1);
  displayFileList(fileArray, listId);
};

// Retourne la periode cible (mois ou semaine) apres un deplacement, ou null si
// elle sort de l'annee scolaire
function getNavigationTarget(direction) {
  if (vuePasses) {
    const target = addDays(pastWeekStart, direction * 7);
    const minWeekStart = mondayOf(addDays(schoolYear.firstDay, 0));
    if (target < minWeekStart || target > lastPastWeekStart()) return null;
    return target;
  }
  // Vue mobile à défilement : pas de navigation par période
  if (isMobileView) return null;

  const target = monthIndex(currentYear, currentMonth) + direction;
  if (target < minMonthIndex || target > maxMonthIndex) return null;
  return target;
}

function navigate(direction) {
  const target = getNavigationTarget(direction);
  if (target === null) return false;

  if (vuePasses) {
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
  document.querySelector('.calendar-header').classList.toggle('defilement', isMobileView && !vuePasses);
  document.body.classList.toggle('vue-defilement', isMobileView && !vuePasses);
  document.getElementById('vue-toggle-btn').textContent = vuePasses ? 'Devoirs à venir' : 'Devoirs passés';
  document.getElementById('vue-label').textContent = vuePasses ? 'Devoirs passés' : '';
  if (vuePasses) renderPastWeekView();
  else if (isMobileView) renderMobileScrollView();
  else renderDesktopMonthView();
  updateNavButtons();
}

function setVuePasses(actif, { push = true } = {}) {
  vuePasses = actif;
  if (actif) pastWeekStart = lastPastWeekStart();
  if (push) {
    const url = new URL(window.location.href);
    if (actif) url.searchParams.set('vue', 'passes');
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

function renderMobileDevoirItems(dayDevoirs) {
  let html = '';
  dayDevoirs.forEach(devoir => {
    const matiere = matieres.find(m => m.id === devoir.matiere_id);
    const couleur = matiere?.couleur || '#999';
    html += `<div class="mobile-devoir-item ${devoir.fait ? 'fait' : ''}" data-devoir-id="${devoir.id}" style="border-left:4px solid ${couleur};">`;
    html += `<div class="mobile-devoir-title">${escapeHTML(devoir.titre)}</div>`;
    html += `<div class="mobile-devoir-matiere" style="color:${couleur};">`;
    const matiereNom = escapeHTML(devoir.matiere_nom || 'Sans matière');
    if (matiere && matiere.lien) html += `<a href="${matiere.lien}" target="_blank">${matiereNom}</a>`;
    else html += matiereNom;
    html += `</div></div>`;
  });
  return html;
}

// Vue mobile : aujourd'hui en premier (même sans devoir), puis les jours suivants qui ont des
// devoirs, parcourus par MOBILE_DAYS_STEP
// quand la fin de la liste approche. Le nombre de jours affichés est conservé d'un rendu à
// l'autre (temps réel, case « fait ») pour ne pas ramener la page en haut.
function renderMobileScrollView() {
  const calendar = document.getElementById('calendar');
  const today = todayLocal();
  const todayStr = dateKey(today);
  document.getElementById('current-month').textContent = 'À venir';

  let html = '<div class="mobile-view">';
  let moisAffiche = null;
  let finAnnee = false;
  for (let i = 0; i < mobileDaysShown; i++) {
    const date = addDays(today, i);
    const dateStr = dateKey(date);
    if (dateStr > maxDateStr) {
      finAnnee = true;
      break;
    }

    const dayDevoirs = devoirsDuJour(dateStr);
    if (dayDevoirs.length === 0 && dateStr !== todayStr) continue;

    const mois = `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
    if (mois !== moisAffiche) {
      html += `<div class="mobile-month-separator">${mois}</div>`;
      moisAffiche = mois;
    }

    let headerClass = 'week-day-header';
    if (dateStr === todayStr) headerClass += ' today';
    if (!isDateStrInSchoolYear(dateStr)) headerClass += ' out-of-range';

    html += `<div class="week-day-card"><div class="${headerClass}" data-date="${dateStr}">`;
    html += `<div class="week-day-name">${DAY_NAMES[date.getDay()]}</div><div class="week-day-number">${date.getDate()}</div></div>`;
    if (dayDevoirs.length > 0) html += `<div class="week-day-devoirs">${renderMobileDevoirItems(dayDevoirs)}</div>`;
    else html += '<div class="week-day-devoirs empty">Aucun devoir</div>';
    html += '</div>';
  }
  html += finAnnee
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

// Devoirs passés : une semaine à la fois (navigation < >), jours sans devoir omis
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
    const dayDevoirs = devoirsDuJour(dateStr);
    if (dayDevoirs.length === 0) continue;
    total += dayDevoirs.length;
    html += `<div class="past-day"><div class="past-day-title">${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()].toLowerCase()}</div>`;
    html += renderMobileDevoirItems(dayDevoirs);
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

  let calendarHTML = '<div class="calendar-days">';
  dayNames.forEach(day => { calendarHTML += `<div class="calendar-day-header">${day}</div>`; });
  calendarHTML += '</div><div class="calendar-dates">';

  for (let x = firstDayIndex; x > 0; x--) {
    calendarHTML += renderDateCell(localDate(currentYear, currentMonth - 1, prevLastDayDate - x + 1), true);
  }
  for (let i = 1; i <= lastDayDate; i++) {
    calendarHTML += renderDateCell(localDate(currentYear, currentMonth, i), false);
  }
  for (let j = 1; j <= nextDays; j++) {
    calendarHTML += renderDateCell(localDate(currentYear, currentMonth + 1, j), true);
  }

  calendarHTML += '</div>';
  calendar.innerHTML = calendarHTML;
}

function renderDateCell(date, otherMonth) {
  const isToday = date.toDateString() === new Date().toDateString();
  const dateStr = date.toISOString().split('T')[0];

  const dayDevoirs = devoirs.filter(d => {
    if (!d.date) return false;
    return d.date.split('T')[0] === dateStr;
  }).sort((a, b) => a.fait - b.fait);

  let classes = 'calendar-date';
  if (otherMonth) classes += ' other-month';
  if (isToday) classes += ' today';
  if (!isDateStrInSchoolYear(dateStr)) classes += ' out-of-range';

  let html = `<div class="${classes}" data-date="${dateStr}">`;
  html += `<div class="date-number">${date.getDate()}</div><div class="date-devoirs">`;

  dayDevoirs.forEach(devoir => {
    const matiere = matieres.find(m => m.id === devoir.matiere_id);
    const couleur = matiere?.couleur || '#999';
    const textColor = getContrastColor(couleur);
    html += `<div class="devoir-item ${devoir.fait ? 'fait' : ''}" data-devoir-id="${devoir.id}" style="background-color:${couleur};color:${textColor};">${escapeHTML(devoir.titre)}</div>`;
  });

  html += '</div></div>';
  return html;
}

function handleCalendarClick(e) {
  if (e.target.closest('.mobile-devoir-item')) {
    e.stopPropagation();
    showDevoirModal(parseInt(e.target.closest('.mobile-devoir-item').dataset.devoirId));
    return;
  }
  if (e.target.classList.contains('devoir-item')) {
    e.stopPropagation();
    showDevoirModal(parseInt(e.target.dataset.devoirId));
    return;
  }
  if (e.target.closest('.week-day-header')) {
    e.stopPropagation();
    const header = e.target.closest('.week-day-header');
    if (header.classList.contains('out-of-range')) return;
    selectedDate = header.dataset.date;
    showAddDevoirModal(selectedDate);
    return;
  }
  if (e.target.closest('.calendar-date')) {
    const cell = e.target.closest('.calendar-date');
    if (cell.classList.contains('out-of-range')) return;
    selectedDate = cell.dataset.date;
    showAddDevoirModal(selectedDate);
  }
}

async function showDevoirModal(devoirId) {
  const devoir = devoirs.find(d => d.id === devoirId);
  if (!devoir) return;

  currentDevoirId = devoirId;
  currentDevoirSignature = devoirSignature(devoir);

  const matiere = matieres.find(m => m.id === devoir.matiere_id);
  const modalBody = document.getElementById('modal-body');

  let html = `<h3>${escapeHTML(devoir.titre)}</h3><p><strong>Matière:</strong> `;
  const matiereNom = escapeHTML(devoir.matiere_nom || 'Non définie');
  if (matiere && matiere.lien) html += `<a href="${matiere.lien}" target="_blank">${matiereNom}</a>`;
  else html += matiereNom;
  html += '</p>';
  if (devoir.description) {
    html += `<p><strong>Description:</strong></p><div class="markdown-body">${renderMarkdown(devoir.description)}</div>`;
  }
  html += `<div id="devoir-modal-fichiers" style="margin:1rem 0;"></div>`;
  html += `<div id="devoir-quiz-section"></div>`;
  html += `<div class="modal-actions">
    <label class="checkbox-container"><input type="checkbox" ${devoir.fait ? 'checked' : ''} id="devoir-statut-${devoir.id}"><span>Marquer comme fait</span></label>
    <button class="btn-secondary" id="export-devoir-${devoir.id}">Exporter / Partager</button>
    <button class="btn-secondary" id="edit-devoir-${devoir.id}">Modifier</button>
    <button class="btn-danger" id="delete-devoir-${devoir.id}">Supprimer</button>
  </div>`;

  modalBody.innerHTML = html;
  hydrateMarkdownImages(modalBody);
  loadDevoirModalFichiers(devoirId);
  loadQuizStatus(devoirId);

  document.getElementById(`devoir-statut-${devoir.id}`).addEventListener('change', async function() {
    await toggleDevoirStatut(devoir.id, this.checked);
    toggleModal('devoir-modal', false);
  });

  document.getElementById(`export-devoir-${devoir.id}`).addEventListener('click', async () => {
    await partagerDevoir(devoir);
  });

  document.getElementById(`edit-devoir-${devoir.id}`).addEventListener('click', () => editDevoir(devoir.id));
  document.getElementById(`delete-devoir-${devoir.id}`).addEventListener('click', () => deleteDevoir(devoir.id));

  toggleModal('devoir-modal', true);
}

// Partage un lien vers une page "test" (ouvre le devoir depuis l'URL)
async function partagerDevoir(devoir) {
  const url = new URL('/dashboard', window.location.origin);
  url.searchParams.set('devoir', String(devoir.id)); // lien à envoyer

  const shareData = {
    title: `Devoir: ${devoir.titre || ''}`,
    text: `Ouvre ce lien pour voir le devoir "${devoir.titre || ''}"`,
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

    // fallback très basique
    prompt('Copie ce lien :', shareData.url);
  } catch (e) {
    console.error('Partager devoir erreur:', e);
    await showAlert('Impossible de partager pour le moment.', 'Erreur');
  }
}

// Auto-ouvre le modal si on arrive avec ?devoir=123
function ouvrirDevoirDepuisURL() {
  const params = new URLSearchParams(window.location.search);
  const devoirId = parseInt(params.get('devoir'), 10);
  if (!Number.isFinite(devoirId)) return;

  // Si les devoirs ne sont pas encore chargés, on retente un peu
  const tryOpen = () => {
    const exists = devoirs.some(d => d.id === devoirId);
    if (exists) {
      showDevoirModal(devoirId);
      return true;
    }
    return false;
  };

  if (tryOpen()) return;

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (tryOpen() || attempts > 20) clearInterval(timer); // ~4s max
  }, 200);
}

async function loadDevoirModalFichiers(devoirId) {
  const container = document.getElementById('devoir-modal-fichiers');
  if (!container) return;
  try {
    const fichiers = await apiCall(`/api/devoirs/${devoirId}/fichiers`);
    if (!fichiers || fichiers.length === 0) { container.innerHTML = ''; return; }

    let html = '<div style="display:flex;flex-direction:column;gap:0.5rem;">';
    fichiers.forEach(fichier => {
      html += `<div style="padding:0.75rem;background:white;border-radius:6px;border:1px solid var(--border);display:flex;align-items:center;gap:0.75rem;cursor:pointer;" onclick="ouvrirFichier(${fichier.id})">`;
      html += `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
      html += `<div style="flex:1;min-width:0;"><div style="font-size:0.95rem;font-weight:500;color:var(--primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(fichier.original_name)}</div>`;
      html += `<div style="font-size:0.8rem;color:var(--secondary);">Uploadé par ${escapeHTML(fichier.uploaded_by_username || 'Inconnu')}</div></div></div>`;
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (error) { container.innerHTML = ''; }
}

async function uploadFiles(devoirId, files, statusBtn) {
  for (let i = 0; i < files.length; i++) {
    const formData = new FormData();
    formData.append('pdf', files[i]);
    try {
      const realtimeId = getRealtimeId();
      await fetch(`/api/devoirs/${devoirId}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          // Envoi multipart : ne passe pas par apiCall, l'en-tête est donc ajouté ici.
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

function showAddDevoirModal(dateStr) {
  if (dateStr) document.getElementById('devoir-date-limite').value = dateStr;
  accumulatedFiles.length = 0;
  document.getElementById('devoir-fichiers-list').innerHTML = '';
  updateMatiereSelect();
  toggleModal('add-devoir-modal', true);
}

async function handleAddDevoir(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('add-devoir-submit-btn');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Création en cours...';
  isSubmitting = true;

  try {
    const data = await apiCall('/api/devoirs', {
      method: 'POST',
      body: JSON.stringify({
        titre: document.getElementById('devoir-titre').value,
        description: document.getElementById('devoir-description').value,
        matiere_id: document.getElementById('devoir-matiere').value,
        date: document.getElementById('devoir-date-limite').value
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

    toggleModal('add-devoir-modal', false);
    document.getElementById('devoir-form').reset();
    accumulatedFiles.length = 0;
    document.getElementById('devoir-fichiers-list').innerHTML = '';
    await loadDevoirs();
    renderCalendar();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
    isSubmitting = false;
    flushQueuedRefresh();
  }
}

async function editDevoir(id) {
  const devoir = devoirs.find(d => d.id === id);
  if (!devoir) return;
  toggleModal('devoir-modal', false);

  resetEditDevoirBanners();
  accumulatedEditFiles.length = 0;
  document.getElementById('edit-devoir-nouveaux-fichiers-list').innerHTML = '';
  await fillEditDevoirForm(devoir);
  toggleModal('edit-devoir-modal', true);
}

// Charge un devoir dans le formulaire d'édition et mémorise sa version : c'est
// cette référence qui permet de détecter qu'un autre utilisateur l'a modifié
// pendant la saisie. Ne touche pas aux fichiers ajoutés par l'utilisateur.
async function fillEditDevoirForm(devoir) {
  document.getElementById('edit-devoir-id').value = devoir.id;
  document.getElementById('edit-devoir-titre').value = devoir.titre;
  document.getElementById('edit-devoir-description').value = devoir.description || '';
  document.getElementById('edit-devoir-date-limite').value = toInputDate(devoir.date);

  updateMatiereSelect();
  document.getElementById('edit-devoir-matiere').value = devoir.matiere_id || '';

  editDevoirBaseline = devoirSignature(devoir);
  await loadExistingFiles(devoir.id);
}

async function loadExistingFiles(devoirId) {
  const container = document.getElementById('edit-devoir-fichiers-existants');
  container.innerHTML = '';
  try {
    const fichiers = await apiCall(`/api/devoirs/${devoirId}/fichiers`);
    if (!fichiers || fichiers.length === 0) return;

    container.innerHTML = fichiers.map(f => `
      <div style="padding:0.5rem;background:white;border-radius:4px;margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);">
        <a href="#" onclick="ouvrirFichier(${f.id}); return false;" style="color:var(--primary);text-decoration:none;font-size:0.9rem;">${escapeHTML(f.original_name)}</a>
        <button type="button" class="btn-danger" style="padding:0.25rem 0.5rem;font-size:0.8rem;" onclick="deleteFichier(${f.id}, ${devoirId})">Supprimer</button>
      </div>
    `).join('');
  } catch (error) { container.innerHTML = ''; }
}

// Les documents ne sont plus accessibles par une adresse fixe : on demande un
// lien temporaire (réservé à la classe) puis on l'ouvre. L'onglet est ouvert
// tout de suite, pendant le clic, sinon les navigateurs bloquent la fenêtre.
window.ouvrirFichier = async function(fichierId) {
  const onglet = window.open('', '_blank');
  const data = await apiCall(`/api/devoirs/fichiers/${fichierId}/lien`);
  if (data.error || !data.url) {
    if (onglet) onglet.close();
    await showAlert(data.error || 'Impossible d\'ouvrir le document', 'Erreur');
    return;
  }
  if (onglet) onglet.location.href = data.url;
  else window.location.href = data.url;
};

window.deleteFichier = async function(fichierId, devoirId) {
  const confirmed = await showConfirm('Supprimer ce fichier ?', 'Confirmation');
  if (!confirmed) return;
  const result = await apiCall(`/api/devoirs/fichiers/${fichierId}`, { method: 'DELETE' });
  if (result.error) { await showAlert(result.error, 'Erreur'); return; }
  await loadExistingFiles(devoirId);
};

async function handleEditDevoir(e) {
  e.preventDefault();
  const id = document.getElementById('edit-devoir-id').value;
  const submitBtn = document.getElementById('edit-devoir-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = editDevoirRecreate ? 'Recréation en cours...' : 'Enregistrement...';
  isSubmitting = true;

  try {
    const payload = JSON.stringify({
      titre: document.getElementById('edit-devoir-titre').value,
      description: document.getElementById('edit-devoir-description').value,
      matiere_id: document.getElementById('edit-devoir-matiere').value,
      date: document.getElementById('edit-devoir-date-limite').value
    });

    // Le devoir a été supprimé par quelqu'un d'autre pendant l'édition : la saisie
    // est conservée et enregistrée comme un nouveau devoir.
    const data = editDevoirRecreate
      ? await apiCall('/api/devoirs', { method: 'POST', body: payload })
      : await apiCall(`/api/devoirs/${id}`, { method: 'PUT', body: payload });

    if (data.error) {
      await showAlert(data.error, 'Erreur');
      return;
    }

    const targetId = editDevoirRecreate ? data.devoirId : id;
    if (accumulatedEditFiles.length > 0) {
      await uploadFiles(targetId, accumulatedEditFiles);
    }

    toggleModal('edit-devoir-modal', false);
    document.getElementById('edit-devoir-form').reset();
    resetEditDevoirBanners();
    accumulatedEditFiles.length = 0;
    document.getElementById('edit-devoir-nouveaux-fichiers-list').innerHTML = '';
    document.getElementById('edit-devoir-fichiers-existants').innerHTML = '';
    await loadDevoirs();
    renderCalendar();
  } finally {
    submitBtn.disabled = false;
    // Le libellé dépend du mode : l'échec d'une recréation doit rester une recréation.
    submitBtn.textContent = editDevoirRecreate ? 'Recréer le devoir' : 'Enregistrer';
    isSubmitting = false;
    flushQueuedRefresh();
  }
}

async function deleteDevoir(id) {
  const confirmed = await showConfirm('Supprimer ce devoir ?', 'Confirmation');
  if (!confirmed) return;
  await apiCall(`/api/devoirs/${id}`, { method: 'DELETE' });
  toggleModal('devoir-modal', false);
  await loadDevoirs();
  renderCalendar();
}

async function loadQuizStatus(devoirId) {
  const container = document.getElementById('devoir-quiz-section');
  if (!container) return;

  try {
    const status = await apiCall(`/api/devoirs/${devoirId}/quiz-status`);
    if (!status.hasDocuments) { container.innerHTML = ''; return; }

    let html = '<div style="margin:1rem 0;padding:1rem;background:#e3f2fd;border-radius:6px;border-left:4px solid #2196f3;">';

    if (status.isGenerating) {
      html += `<div style="display:flex;align-items:center;gap:0.75rem;">
        <div style="width:20px;height:20px;border:3px solid #2196f3;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></div>
        <div><div style="font-weight:600;color:#2196f3;">Génération en cours...</div>
        <div style="font-size:0.85rem;color:#666;">Vous recevrez un email quand le quiz sera prêt</div></div></div>`;
    } else if (status.hasQuiz) {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;">
        <div><div style="font-weight:600;color:#2196f3;">Quiz disponible</div>
        <div style="font-size:0.85rem;color:#666;">Réviser avec un questionnaire interactif</div></div>
        <button onclick="startQuiz(${devoirId})" class="btn-primary" style="white-space:nowrap;">S'entraîner</button></div>`;
    } else if (status.quizEnabled) {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;">
        <div><div style="font-weight:600;color:#2196f3;">Documents disponibles</div>
        <div style="font-size:0.85rem;color:#666;">Générer 20-100 questions avec IA</div></div>
        <button onclick="generateQuiz(${devoirId})" class="btn-primary" style="white-space:nowrap;">Générer Quiz</button></div>`;
    } else {
      container.innerHTML = '';
      return;
    }

    html += '</div>';
    if (status.isGenerating) {
      html += '<style>@keyframes spin { to { transform: rotate(360deg); } }</style>';
    }
    container.innerHTML = html;
  } catch (error) { container.innerHTML = ''; }
}

window.startQuiz = function(devoirId) { window.location.href = `/quiz?id=${devoirId}`; };

window.generateQuiz = async function(devoirId) {
  const confirmed = await showConfirm('La génération peut prendre quelques minutes. Continuer ?', 'Générer le quiz');
  if (!confirmed) return;

  try {
    const result = await apiCall(`/api/devoirs/${devoirId}/generate-quiz`, { method: 'POST' });
    if (result.error) { await showAlert(result.error, 'Erreur'); return; }
    await showAlert('Génération démarrée ! Email envoyé quand prêt.', 'Quiz');
    await loadQuizStatus(devoirId);
  } catch (error) { await showAlert('Erreur lors de la génération', 'Erreur'); }
};

async function toggleDevoirStatut(devoirId, fait) {
  await apiCall(`/api/devoirs/${devoirId}/statut`, {
    method: 'POST',
    body: JSON.stringify({ fait })
  });
  await loadDevoirs();
  renderCalendar();
}

init();
