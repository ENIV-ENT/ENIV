import { apiCall, checkAuth, logout } from '../utils/api.js?v=2';
import { escapeHTML, localDate, formatDate, toInputDate, toggleModal, setupModalClose, showAlert, showConfirm, getContrastColor } from '../utils/dom.js?v=2';

let matieres = [];
let devoirs = [];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let currentWeekStart = null;
let selectedDate = null;
let isMobileView = false;
let authData = null;

// Stockage des fichiers accumulés
let accumulatedFiles = [];
let accumulatedEditFiles = [];

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

  // Charger le thème sauvegardé
  loadThemePreference();

  await loadData();
  setupEventListeners();
  checkViewport();
  renderCalendar();
}

// Fonction pour charger la préférence de thème depuis le localStorage
function loadThemePreference() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    updateThemeButton(true);
  } else {
    document.body.classList.remove('dark-theme');
    updateThemeButton(false);
  }
}

// Fonction pour basculer le thème
function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
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
    select.innerHTML = '<option value="">Sélectionner une matière</option>';
    matieres.forEach(matiere => {
      const option = document.createElement('option');
      option.value = matiere.id;
      option.textContent = matiere.nom;
      select.appendChild(option);
    });
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
    if (isMobileView) {
      currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    } else {
      currentMonth--;
      if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    }
    renderCalendar();
  });

  document.getElementById('next-month').addEventListener('click', () => {
    if (isMobileView) {
      currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    } else {
      currentMonth++;
      if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    }
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
    accumulatedEditFiles.length = 0;
    document.getElementById('edit-devoir-nouveaux-fichiers-list').innerHTML = '';
    document.getElementById('edit-devoir-fichiers-existants').innerHTML = '';
  });

  document.getElementById('devoir-form').addEventListener('submit', handleAddDevoir);
  document.getElementById('edit-devoir-form').addEventListener('submit', handleEditDevoir);

  setupDropZone('devoir-drop-zone', 'devoir-fichiers', accumulatedFiles, 'devoir-fichiers-list');
  setupDropZone('edit-devoir-drop-zone', 'edit-devoir-nouveaux-fichiers', accumulatedEditFiles, 'edit-devoir-nouveaux-fichiers-list');

  document.addEventListener('click', handleCalendarClick);

  window.addEventListener('resize', () => {
    const wasMobile = isMobileView;
    checkViewport();
    if (wasMobile !== isMobileView) renderCalendar();
  });
}

function checkViewport() {
  isMobileView = window.innerWidth <= 768;
  if (isMobileView && !currentWeekStart) {
    const today = new Date();
    currentWeekStart = getWeekStart(today);
  }
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
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

function renderCalendar() {
  const calendar = document.getElementById('calendar');
  if (!calendar) return;
  if (isMobileView) renderMobileWeekView();
  else renderDesktopMonthView();
}

function renderMobileWeekView() {
  const calendar = document.getElementById('calendar');
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  document.getElementById('current-month').textContent = `${currentWeekStart.getDate()} ${monthNames[currentWeekStart.getMonth()]} - ${weekEnd.getDate()} ${monthNames[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;

  let html = '<div class="mobile-view">';
  for (let i = 0; i < 7; i++) {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const isToday = date.toDateString() === new Date().toDateString();

    const dayDevoirs = devoirs.filter(d => {
      if (!d.date) return false;
      return d.date.split('T')[0] === dateStr;
    }).sort((a, b) => a.fait - b.fait);

    let headerClass = 'week-day-header';
    if (isToday) headerClass += ' today';

    html += `<div class="week-day-card"><div class="${headerClass}" data-date="${dateStr}">`;
    html += `<div class="week-day-name">${dayNames[i]}</div><div class="week-day-number">${date.getDate()}</div></div>`;

    if (dayDevoirs.length > 0) {
      html += '<div class="week-day-devoirs">';
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
      html += '</div>';
    } else {
      html += '<div class="week-day-devoirs empty">Aucun devoir</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  calendar.innerHTML = html;
}

function renderDesktopMonthView() {
  const calendar = document.getElementById('calendar');
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  document.getElementById('current-month').textContent = `${monthNames[currentMonth]} ${currentYear}`;

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
    selectedDate = e.target.closest('.week-day-header').dataset.date;
    showAddDevoirModal(selectedDate);
    return;
  }
  if (e.target.closest('.calendar-date')) {
    selectedDate = e.target.closest('.calendar-date').dataset.date;
    showAddDevoirModal(selectedDate);
  }
}

async function showDevoirModal(devoirId) {
  const devoir = devoirs.find(d => d.id === devoirId);
  if (!devoir) return;

  const matiere = matieres.find(m => m.id === devoir.matiere_id);
  const modalBody = document.getElementById('modal-body');

  let html = `<h3>${escapeHTML(devoir.titre)}</h3><p><strong>Matière:</strong> `;
  const matiereNom = escapeHTML(devoir.matiere_nom || 'Non définie');
  if (matiere && matiere.lien) html += `<a href="${matiere.lien}" target="_blank">${matiereNom}</a>`;
  else html += matiereNom;
  html += `</p>${devoir.description ? `<p><strong>Description:</strong> ${escapeHTML(devoir.description)}</p>` : ''}`;
  html += `<div id="devoir-modal-fichiers" style="margin:1rem 0;"></div>`;
  html += `<div id="devoir-quiz-section"></div>`;
  html += `<div class="modal-actions">
    <label class="checkbox-container"><input type="checkbox" ${devoir.fait ? 'checked' : ''} id="devoir-statut-${devoir.id}"><span>Marquer comme fait</span></label>
    <button class="btn-secondary" id="edit-devoir-${devoir.id}">Modifier</button>
    <button class="btn-danger" id="delete-devoir-${devoir.id}">Supprimer</button>
  </div>`;

  modalBody.innerHTML = html;
  loadDevoirModalFichiers(devoirId);
  loadQuizStatus(devoirId);

  document.getElementById(`devoir-statut-${devoir.id}`).addEventListener('change', async function() {
    await toggleDevoirStatut(devoir.id, this.checked);
    toggleModal('devoir-modal', false);
  });
  document.getElementById(`edit-devoir-${devoir.id}`).addEventListener('click', () => editDevoir(devoir.id));
  document.getElementById(`delete-devoir-${devoir.id}`).addEventListener('click', () => deleteDevoir(devoir.id));

  toggleModal('devoir-modal', true);
}

async function loadDevoirModalFichiers(devoirId) {
  const container = document.getElementById('devoir-modal-fichiers');
  if (!container) return;
  try {
    const fichiers = await apiCall(`/api/devoirs/${devoirId}/fichiers`);
    if (!fichiers || fichiers.length === 0) { container.innerHTML = ''; return; }

    let html = '<div style="display:flex;flex-direction:column;gap:0.5rem;">';
    fichiers.forEach(fichier => {
      html += `<div style="padding:0.75rem;background:white;border-radius:6px;border:1px solid var(--border);display:flex;align-items:center;gap:0.75rem;cursor:pointer;" onclick="window.open('/uploads/${escapeHTML(fichier.filename)}', '_blank')">`;
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
      await fetch(`/api/devoirs/${devoirId}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
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
  } finally { submitBtn.disabled = false; submitBtn.textContent = originalText; }
}

async function editDevoir(id) {
  const devoir = devoirs.find(d => d.id === id);
  if (!devoir) return;
  toggleModal('devoir-modal', false);

  document.getElementById('edit-devoir-id').value = devoir.id;
  document.getElementById('edit-devoir-titre').value = devoir.titre;
  document.getElementById('edit-devoir-description').value = devoir.description || '';
  document.getElementById('edit-devoir-date-limite').value = toInputDate(devoir.date);

  updateMatiereSelect();
  document.getElementById('edit-devoir-matiere').value = devoir.matiere_id || '';

  accumulatedEditFiles.length = 0;
  document.getElementById('edit-devoir-nouveaux-fichiers-list').innerHTML = '';
  await loadExistingFiles(id);
  toggleModal('edit-devoir-modal', true);
}

async function loadExistingFiles(devoirId) {
  const container = document.getElementById('edit-devoir-fichiers-existants');
  container.innerHTML = '';
  try {
    const fichiers = await apiCall(`/api/devoirs/${devoirId}/fichiers`);
    if (!fichiers || fichiers.length === 0) return;

    container.innerHTML = fichiers.map(f => `
      <div style="padding:0.5rem;background:white;border-radius:4px;margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);">
        <a href="/uploads/${escapeHTML(f.filename)}" target="_blank" style="color:var(--primary);text-decoration:none;font-size:0.9rem;">${escapeHTML(f.original_name)}</a>
        <button type="button" class="btn-danger" style="padding:0.25rem 0.5rem;font-size:0.8rem;" onclick="deleteFichier(${f.id}, ${devoirId})">Supprimer</button>
      </div>
    `).join('');
  } catch (error) { container.innerHTML = ''; }
}

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
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enregistrement...';

  try {
    const data = await apiCall(`/api/devoirs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        titre: document.getElementById('edit-devoir-titre').value,
        description: document.getElementById('edit-devoir-description').value,
        matiere_id: document.getElementById('edit-devoir-matiere').value,
        date: document.getElementById('edit-devoir-date-limite').value
      })
    });

    if (data.error) {
      await showAlert(data.error, 'Erreur');
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      return;
    }

    if (accumulatedEditFiles.length > 0) {
      await uploadFiles(id, accumulatedEditFiles);
    }

    toggleModal('edit-devoir-modal', false);
    document.getElementById('edit-devoir-form').reset();
    accumulatedEditFiles.length = 0;
    document.getElementById('edit-devoir-nouveaux-fichiers-list').innerHTML = '';
    document.getElementById('edit-devoir-fichiers-existants').innerHTML = '';
    await loadDevoirs();
    renderCalendar();
  } finally { submitBtn.disabled = false; submitBtn.textContent = originalText; }
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
    } else {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;">
        <div><div style="font-weight:600;color:#2196f3;">Documents disponibles</div>
        <div style="font-size:0.85rem;color:#666;">Générer 20-100 questions avec IA</div></div>
        <button onclick="generateQuiz(${devoirId})" class="btn-primary" style="white-space:nowrap;">Générer Quiz</button></div>`;
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
