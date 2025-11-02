import { apiCall, checkAuth, logout } from '../utils/api.js';
import { escapeHTML, localDate, formatDate, toInputDate, toggleModal, setupModalClose, showAlert, showConfirm, getContrastColor } from '../utils/dom.js';

let matieres = [];
let devoirs = [];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let currentWeekStart = null;
let selectedDate = null;
let isMobileView = false;

// Stockage des fichiers accumulés
let accumulatedFiles = [];
let accumulatedEditFiles = [];

async function init() {
  const auth = await checkAuth();

  document.getElementById('eleve-info').textContent = auth.username;

  await loadData();

  setupEventListeners();
  checkViewport();
  renderCalendar();
}

async function loadData() {
  await Promise.all([
    loadMatieres(),
    loadDevoirs(),
    checkEmploiTempsButton()
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

async function checkEmploiTempsButton() {
  const data = await apiCall('/api/devoirs/settings/emploi-temps');
  const btn = document.getElementById('emploi-temps-btn');

  if (data.lien) {
    btn.classList.remove('hidden');
    btn.onclick = () => {
      window.open(data.lien, '_blank');
      // Fermer le dropdown après le clic
      document.getElementById('user-dropdown').classList.add('hidden');
    };
  } else {
    btn.classList.add('hidden');
  }
}

function setupEventListeners() {
  // User menu dropdown
  const userMenuBtn = document.getElementById('user-menu-btn');
  const userDropdown = document.getElementById('user-dropdown');

  userMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle('hidden');
  });

  // Fermer le dropdown en cliquant ailleurs
  document.addEventListener('click', (e) => {
    if (!userDropdown.classList.contains('hidden') && !e.target.closest('.user-menu')) {
      userDropdown.classList.add('hidden');
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    userDropdown.classList.add('hidden');
    logout();
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    userDropdown.classList.add('hidden');
    window.location.href = '/settings';
  });

  document.getElementById('prev-month').addEventListener('click', () => {
    if (isMobileView) {
      currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    } else {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
    }
    renderCalendar();
  });

  document.getElementById('next-month').addEventListener('click', () => {
    if (isMobileView) {
      currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    } else {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
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

  // Setup drag and drop pour la création de devoir
  setupDropZone('devoir-drop-zone', 'devoir-fichiers', accumulatedFiles, 'devoir-fichiers-list');

  // Setup drag and drop pour la modification de devoir
  setupDropZone('edit-devoir-drop-zone', 'edit-devoir-nouveaux-fichiers', accumulatedEditFiles, 'edit-devoir-nouveaux-fichiers-list');

  document.addEventListener('click', handleCalendarClick);

  window.addEventListener('resize', () => {
    const wasMobile = isMobileView;
    checkViewport();
    if (wasMobile !== isMobileView) {
      renderCalendar();
    }
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

  // Clic sur la zone pour ouvrir le sélecteur de fichiers
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // Changement de fichier via l'input
  fileInput.addEventListener('change', function(e) {
    addFilesToArray(e.target.files, fileArray, listId);
    // Ne pas réinitialiser l'input pour pouvoir ajouter plusieurs fois
  });

  // Drag and drop events
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.style.borderColor = 'var(--primary)';
    dropZone.style.backgroundColor = 'rgba(74, 144, 226, 0.1)';
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.backgroundColor = 'var(--light)';
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.backgroundColor = 'var(--light)';

    const files = e.dataTransfer.files;
    addFilesToArray(files, fileArray, listId);
  });
}

function addFilesToArray(files, fileArray, listId) {
  if (!files || files.length === 0) return;

  // Filtrer les fichiers PDF uniquement
  const pdfFiles = Array.from(files).filter(file => file.type === 'application/pdf');

  if (pdfFiles.length === 0) {
    showAlert('Seuls les fichiers PDF sont autorisés', 'Erreur');
    return;
  }

  // Vérifier la taille des fichiers (10 Mo max)
  const oversizedFiles = pdfFiles.filter(file => file.size > 10 * 1024 * 1024);
  if (oversizedFiles.length > 0) {
    showAlert(`Certains fichiers dépassent la limite de 10 Mo : ${oversizedFiles.map(f => f.name).join(', ')}`, 'Erreur');
    return;
  }

  // Ajouter les fichiers à l'array (ne pas effacer les anciens)
  pdfFiles.forEach(file => {
    // Vérifier si le fichier n'est pas déjà dans la liste
    const exists = fileArray.some(f => f.name === file.name && f.size === file.size);
    if (!exists) {
      fileArray.push(file);
    }
  });

  // Afficher la liste mise à jour
  displayFileList(fileArray, listId);
}

function displayFileList(fileArray, listId) {
  const container = document.getElementById(listId);

  if (fileArray.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '<div style="margin-top: 0.5rem;">';
  fileArray.forEach((file, index) => {
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
    html += `<div style="padding: 0.5rem; background: white; border-radius: 4px; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--border);">`;
    html += `<span style="font-size: 0.9rem; flex: 1;">${escapeHTML(file.name)} <span style="color: var(--secondary);">(${sizeInMB} Mo)</span></span>`;
    html += `<button type="button" class="btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="removeFileFromList(${index}, '${listId}')">Retirer</button>`;
    html += `</div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

window.removeFileFromList = function(index, listId) {
  // Déterminer quel tableau utiliser
  const fileArray = listId === 'devoir-fichiers-list' ? accumulatedFiles : accumulatedEditFiles;

  // Retirer le fichier
  fileArray.splice(index, 1);

  // Rafraîchir l'affichage
  displayFileList(fileArray, listId);
};

function renderCalendar() {
  const calendar = document.getElementById('calendar');
  if (!calendar) return;

  if (isMobileView) {
    renderMobileWeekView();
  } else {
    renderDesktopMonthView();
  }
}

function renderMobileWeekView() {
  const calendar = document.getElementById('calendar');
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const startStr = `${currentWeekStart.getDate()} ${monthNames[currentWeekStart.getMonth()]}`;
  const endStr = `${weekEnd.getDate()} ${monthNames[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;
  document.getElementById('current-month').textContent = `${startStr} - ${endStr}`;

  let html = '<div class="mobile-view">';

  for (let i = 0; i < 7; i++) {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + i);

    const dateStr = date.toISOString().split('T')[0];
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();

    const dayDevoirs = devoirs.filter(d => {
      if (!d.date) return false;
      // Comparer directement les chaînes de dates pour éviter les problèmes de timezone
      const devoirDate = d.date.split('T')[0];
      return devoirDate === dateStr;
    }).sort((a, b) => a.fait - b.fait);

    let headerClass = 'week-day-header';
    if (isToday) headerClass += ' today';

    html += `<div class="week-day-card">`;
    html += `<div class="${headerClass}" data-date="${dateStr}">`;
    html += `<div class="week-day-name">${dayNames[i]}</div>`;
    html += `<div class="week-day-number">${date.getDate()}</div>`;
    html += `</div>`;

    if (dayDevoirs.length > 0) {
      html += '<div class="week-day-devoirs">';
      dayDevoirs.forEach(devoir => {
        const matiere = matieres.find(m => m.id === devoir.matiere_id);
        const couleur = matiere?.couleur || '#999';
        html += `<div class="mobile-devoir-item ${devoir.fait ? 'fait' : ''}" data-devoir-id="${devoir.id}" style="border-left: 4px solid ${couleur};">`;
        html += `<div class="mobile-devoir-title">${escapeHTML(devoir.titre)}</div>`;
        html += `<div class="mobile-devoir-matiere" style="color: ${couleur};">`;
        const matiereNomHtml = escapeHTML(devoir.matiere_nom || 'Sans matière');
        if (matiere.lien) {
          html += `<a href="${matiere.lien}" target="_blank">${matiereNomHtml}</a>`
        } else {
          html += matiereNomHtml;
        }
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
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
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
  dayNames.forEach(day => {
    calendarHTML += `<div class="calendar-day-header">${day}</div>`;
  });
  calendarHTML += '</div><div class="calendar-dates">';

  for (let x = firstDayIndex; x > 0; x--) {
    const date = localDate(currentYear, currentMonth - 1, prevLastDayDate - x + 1);
    calendarHTML += renderDateCell(date, true);
  }

  for (let i = 1; i <= lastDayDate; i++) {
    const date = localDate(currentYear, currentMonth, i);
    calendarHTML += renderDateCell(date, false);
  }

  for (let j = 1; j <= nextDays; j++) {
    const date = localDate(currentYear, currentMonth + 1, j);
    calendarHTML += renderDateCell(date, true);
  }

  calendarHTML += '</div>';
  calendar.innerHTML = calendarHTML;
}

function renderDateCell(date, otherMonth) {
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const dateStr = date.toISOString().split('T')[0];

  const dayDevoirs = devoirs.filter(d => {
    if (!d.date) return false;
    // Comparer directement les chaînes de dates pour éviter les problèmes de timezone
    const devoirDate = d.date.split('T')[0];
    return devoirDate === dateStr;
  }).sort((a, b) => a.fait - b.fait);

  let classes = 'calendar-date';
  if (otherMonth) classes += ' other-month';
  if (isToday) classes += ' today';

  let html = `<div class="${classes}" data-date="${dateStr}">`;
  html += `<div class="date-number">${date.getDate()}</div>`;
  html += '<div class="date-devoirs">';

  dayDevoirs.forEach(devoir => {
    const matiere = matieres.find(m => m.id === devoir.matiere_id);
    const couleur = matiere?.couleur || '#999';
    const textColor = getContrastColor(couleur);
    html += `<div class="devoir-item ${devoir.fait ? 'fait' : ''}" data-devoir-id="${devoir.id}" style="background-color: ${couleur}; color: ${textColor};">`;
    html += `${escapeHTML(devoir.titre)}`;
    html += '</div>';
  });

  html += '</div></div>';
  return html;
}

function handleCalendarClick(e) {
  if (e.target.closest('.mobile-devoir-item')) {
    e.stopPropagation();
    const item = e.target.closest('.mobile-devoir-item');
    const devoirId = parseInt(item.dataset.devoirId);
    showDevoirModal(devoirId);
    return;
  }

  if (e.target.classList.contains('devoir-item')) {
    e.stopPropagation();
    const devoirId = parseInt(e.target.dataset.devoirId);
    showDevoirModal(devoirId);
    return;
  }

  if (e.target.closest('.week-day-header')) {
    e.stopPropagation();
    const header = e.target.closest('.week-day-header');
    const dateStr = header.dataset.date;
    selectedDate = dateStr;
    showAddDevoirModal(dateStr);
    return;
  }

  if (e.target.closest('.calendar-date')) {
    const dateCell = e.target.closest('.calendar-date');
    const dateStr = dateCell.dataset.date;
    selectedDate = dateStr;
    showAddDevoirModal(dateStr);
  }
}

async function showDevoirModal(devoirId) {
  const devoir = devoirs.find(d => d.id === devoirId);
  if (!devoir) return;

  const matiere = matieres.find(m => m.id === devoir.matiere_id);
  const modalBody = document.getElementById('modal-body');

  let html = `
    <h3>${escapeHTML(devoir.titre)}</h3>
    <p><strong>Matière:</strong> `;
  const matiereNomHtml = escapeHTML(devoir.matiere_nom || 'Non définie');
  if (matiere && matiere.lien) {
    html += `<a href="${matiere.lien}" target="_blank">${matiereNomHtml}</a>`
  } else {
    html += matiereNomHtml;
  }
  html += `</p>
    ${devoir.description ? `<p><strong>Description:</strong> ${escapeHTML(devoir.description)}</p>` : ''}`;

  // Section des fichiers PDF (sans titre, juste la liste)
  html += `<div id="devoir-modal-fichiers" style="margin: 1rem 0;"></div>`;

  // Section du bouton S'entraîner (sera affichée si documents présents)
  html += `<div id="devoir-quiz-section"></div>`;

  html += `<div class="modal-actions">
      <label class="checkbox-container">
        <input type="checkbox" ${devoir.fait ? 'checked' : ''} id="devoir-statut-${devoir.id}">
        <span>Marquer comme fait</span>
      </label>
      <button class="btn-secondary" id="edit-devoir-${devoir.id}">Modifier</button>
      <button class="btn-danger" id="delete-devoir-${devoir.id}">Supprimer</button>
    </div>
  `;

  modalBody.innerHTML = html;

  // Charger les fichiers PDF
  loadDevoirModalFichiers(devoirId);
  
  // Charger le statut du quiz
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

    // Si pas de fichiers, ne rien afficher
    if (!fichiers || fichiers.length === 0) {
      container.innerHTML = '';
      return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
    fichiers.forEach(fichier => {
      html += `<div style="padding: 0.75rem; background: white; border-radius: 6px; border: 1px solid var(--border); display: flex; align-items: center; gap: 0.75rem; transition: all 0.2s ease; cursor: pointer;" onclick="window.open('/uploads/${escapeHTML(fichier.filename)}', '_blank')" onmouseover="this.style.backgroundColor='rgba(74, 144, 226, 0.05)'; this.style.borderColor='var(--primary)'" onmouseout="this.style.backgroundColor='white'; this.style.borderColor='var(--border)'">`;

      // Icône PDF
      html += `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" style="flex-shrink: 0;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <text x="12" y="18" font-size="6" text-anchor="middle" fill="var(--danger)" font-weight="bold">PDF</text>
      </svg>`;

      // Info du fichier
      html += `<div style="flex: 1; min-width: 0;">`;
      html += `<div style="font-size: 0.95rem; font-weight: 500; color: var(--primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(fichier.original_name)}</div>`;
      html += `<div style="font-size: 0.8rem; color: var(--secondary);">Uploadé par ${escapeHTML(fichier.uploaded_by_username || 'Inconnu')}</div>`;
      html += `</div>`;

      // Icône flèche
      html += `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" stroke-width="2" style="flex-shrink: 0;">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </svg>`;

      html += `</div>`;
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (error) {
    console.error('Erreur lors du chargement des fichiers:', error);
    // En cas d'erreur, ne rien afficher non plus
    container.innerHTML = '';
  }
}

function showAddDevoirModal(dateStr) {
  const dateLimiteInput = document.getElementById('devoir-date-limite');

  if (dateStr) {
    dateLimiteInput.value = dateStr;
  }

  // Réinitialiser la liste des fichiers accumulés
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

    // Upload des fichiers si présents
    if (accumulatedFiles && accumulatedFiles.length > 0) {
      submitBtn.textContent = `Upload des fichiers (0/${accumulatedFiles.length})...`;

      for (let i = 0; i < accumulatedFiles.length; i++) {
        const formData = new FormData();
        formData.append('pdf', accumulatedFiles[i]);

        try {
          const uploadResult = await fetch(`/api/devoirs/${data.devoirId}/upload`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
          });

          const uploadData = await uploadResult.json();
          if (uploadData.error) {
            console.error(`Erreur lors de l'upload de ${accumulatedFiles[i].name}:`, uploadData.error);
          }

          submitBtn.textContent = `Upload des fichiers (${i + 1}/${accumulatedFiles.length})...`;
        } catch (error) {
          console.error(`Erreur lors de l'upload de ${accumulatedFiles[i].name}:`, error);
        }
      }
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
  }
}

async function editDevoir(id) {
  const devoir = devoirs.find(d => d.id === id);
  if (!devoir) return;

  toggleModal('devoir-modal', false);

  document.getElementById('edit-devoir-id').value = devoir.id;
  document.getElementById('edit-devoir-titre').value = devoir.titre;
  document.getElementById('edit-devoir-description').value = devoir.description || '';
  document.getElementById('edit-devoir-date-limite').value = toInputDate(devoir.date);

  const select = document.getElementById('edit-devoir-matiere');
  select.innerHTML = '<option value="">Sélectionner une matière</option>';
  matieres.forEach(matiere => {
    const option = document.createElement('option');
    option.value = matiere.id;
    option.textContent = matiere.nom;
    if (matiere.id === devoir.matiere_id) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  // Réinitialiser les fichiers nouveaux accumulés
  accumulatedEditFiles.length = 0;
  document.getElementById('edit-devoir-nouveaux-fichiers-list').innerHTML = '';

  // Charger et afficher les fichiers existants
  await loadExistingFiles(id);

  toggleModal('edit-devoir-modal', true);
}

async function loadExistingFiles(devoirId) {
  const container = document.getElementById('edit-devoir-fichiers-existants');
  container.innerHTML = '';

  try {
    const fichiers = await apiCall(`/api/devoirs/${devoirId}/fichiers`);

    // Si pas de fichiers, ne rien afficher
    if (!fichiers || fichiers.length === 0) {
      container.innerHTML = '';
      return;
    }

    let html = '';
    fichiers.forEach(fichier => {
      html += `<div style="padding: 0.5rem; background: white; border-radius: 4px; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--border);" data-fichier-id="${fichier.id}">`;
      html += `<div style="flex: 1;">`;
      html += `<a href="/uploads/${escapeHTML(fichier.filename)}" target="_blank" style="color: var(--primary); text-decoration: none; font-size: 0.9rem;">${escapeHTML(fichier.original_name)}</a>`;
      html += `<div style="font-size: 0.8rem; color: var(--secondary);">Uploadé par ${escapeHTML(fichier.uploaded_by_username || 'Inconnu')}</div>`;
      html += `</div>`;
      html += `<button type="button" class="btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="deleteFichier(${fichier.id}, ${devoirId})">Supprimer</button>`;
      html += `</div>`;
    });
    container.innerHTML = html;
  } catch (error) {
    console.error('Erreur lors du chargement des fichiers:', error);
    // En cas d'erreur, ne rien afficher non plus
    container.innerHTML = '';
  }
}

window.deleteFichier = async function(fichierId, devoirId) {
  const confirmed = await showConfirm('Êtes-vous sûr de vouloir supprimer ce fichier ?', 'Confirmation');
  if (!confirmed) return;

  try {
    const result = await apiCall(`/api/devoirs/fichiers/${fichierId}`, {
      method: 'DELETE'
    });

    if (result.error) {
      await showAlert(result.error, 'Erreur');
      return;
    }

    // Recharger la liste des fichiers
    await loadExistingFiles(devoirId);
  } catch (error) {
    console.error('Erreur lors de la suppression du fichier:', error);
    await showAlert('Erreur lors de la suppression du fichier', 'Erreur');
  }
};

async function handleEditDevoir(e) {
  e.preventDefault();

  const id = document.getElementById('edit-devoir-id').value;
  const submitBtn = document.getElementById('edit-devoir-submit-btn');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enregistrement en cours...';

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

    // Upload des nouveaux fichiers si présents
    if (accumulatedEditFiles && accumulatedEditFiles.length > 0) {
      submitBtn.textContent = `Upload des fichiers (0/${accumulatedEditFiles.length})...`;

      for (let i = 0; i < accumulatedEditFiles.length; i++) {
        const formData = new FormData();
        formData.append('pdf', accumulatedEditFiles[i]);

        try {
          const uploadResult = await fetch(`/api/devoirs/${id}/upload`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
          });

          const uploadData = await uploadResult.json();
          if (uploadData.error) {
            console.error(`Erreur lors de l'upload de ${accumulatedEditFiles[i].name}:`, uploadData.error);
          }

          submitBtn.textContent = `Upload des fichiers (${i + 1}/${accumulatedEditFiles.length})...`;
        } catch (error) {
          console.error(`Erreur lors de l'upload de ${accumulatedEditFiles[i].name}:`, error);
        }
      }
    }

    toggleModal('edit-devoir-modal', false);
    document.getElementById('edit-devoir-form').reset();
    accumulatedEditFiles.length = 0;
    document.getElementById('edit-devoir-nouveaux-fichiers-list').innerHTML = '';
    document.getElementById('edit-devoir-fichiers-existants').innerHTML = '';
    await loadDevoirs();
    renderCalendar();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

async function deleteDevoir(id) {
  const confirmed = await showConfirm('Êtes-vous sûr de vouloir supprimer ce devoir ?', 'Confirmation');
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

    // Si pas de documents, ne rien afficher
    if (!status.hasDocuments) {
      container.innerHTML = '';
      return;
    }

    let html = '<div style="margin: 1rem 0; padding: 1rem; background: #e3f2fd; border-radius: 6px; border-left: 4px solid #2196f3;">';

    if (status.isGenerating) {
      html += `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 20px; height: 20px; border: 3px solid #2196f3; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          <div>
            <div style="font-weight: 600; color: #2196f3;">Génération en cours...</div>
            <div style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">Vous recevrez un email quand le quiz sera prêt</div>
          </div>
        </div>
      `;
    } else if (status.hasQuiz) {
      html += `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; color: #2196f3;">✅ Quiz disponible</div>
            <div style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">Réviser avec un questionnaire interactif</div>
          </div>
          <button onclick="startQuiz(${devoirId})" class="btn-primary" style="white-space: nowrap;">
            S'entraîner
          </button>
        </div>
      `;
    } else {
      const premiumText = status.isPremium 
        ? '<span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 0.15rem 0.5rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; margin-left: 0.5rem;">PREMIUM</span>'
        : '';
      
      html += `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; color: #2196f3;">📚 Documents disponibles ${premiumText}</div>
            <div style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">
              ${status.isPremium ? 'Générer 20-100 questions avec IA Premium (Claude 4.5)' : 'Générer 20-100 questions avec IA (Llama 3.3)'}
            </div>
          </div>
          <button onclick="generateQuiz(${devoirId})" class="btn-primary" style="white-space: nowrap;">
            Générer Quiz
          </button>
        </div>
      `;
    }

    html += '</div>';
    
    // Ajouter le CSS pour l'animation
    if (status.isGenerating) {
      html += `
        <style>
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      `;
    }

    container.innerHTML = html;
  } catch (error) {
    console.error('Erreur lors du chargement du statut du quiz:', error);
    container.innerHTML = '';
  }
}

window.startQuiz = function(devoirId) {
  window.location.href = `/quiz?id=${devoirId}`;
};

window.generateQuiz = async function(devoirId) {
  const confirmed = await showConfirm(
    'La génération du quiz peut prendre quelques minutes. Vous recevrez un email quand il sera prêt. Continuer ?',
    'Générer le quiz'
  );
  
  if (!confirmed) return;

  try {
    const result = await apiCall(`/api/devoirs/${devoirId}/generate-quiz`, {
      method: 'POST'
    });

    if (result.error) {
      await showAlert(result.error, 'Erreur');
      return;
    }

    await showAlert(
      'La génération du quiz a démarré ! Vous recevrez un email quand il sera prêt.',
      'Quiz en cours de génération'
    );

    // Recharger le statut
    await loadQuizStatus(devoirId);
  } catch (error) {
    console.error('Erreur lors de la génération du quiz:', error);
    await showAlert('Erreur lors de la génération du quiz', 'Erreur');
  }
};

async function toggleDevoirStatut(devoirId, fait) {
  await apiCall(`/api/devoirs/${devoirId}/statut`, {
    method: 'POST',
    body: JSON.stringify({ fait }),
  });
  await loadDevoirs();
  renderCalendar();
}

init();
