import { apiCall, checkAuth, logout } from '../utils/api.js';
import { escapeHTML, localDate, formatDate, toggleModal, setupModalClose } from '../utils/dom.js';
import { initWebSocket } from '../utils/websocket.js';

let matieres = [];
let devoirs = [];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let currentWeekStart = null;
let selectedDate = null;
let isMobileView = false;

async function init() {
  const auth = await checkAuth();

  document.getElementById('eleve-info').textContent = auth.username;

  initWebSocket(loadData);
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
    btn.onclick = () => window.open(data.lien, '_blank');
  } else {
    btn.classList.add('hidden');
  }
}

function setupEventListeners() {
  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('settings-btn').addEventListener('click', () => {
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
  });

  document.getElementById('cancel-edit-devoir-btn').addEventListener('click', () => {
    toggleModal('edit-devoir-modal', false);
    document.getElementById('edit-devoir-form').reset();
  });

  document.getElementById('devoir-form').addEventListener('submit', handleAddDevoir);
  document.getElementById('edit-devoir-form').addEventListener('submit', handleEditDevoir);

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
      const devoirDate = new Date(d.date).toISOString().split('T')[0];
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
    const devoirDate = new Date(d.date).toISOString().split('T')[0];
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
    html += `<div class="devoir-item ${devoir.fait ? 'fait' : ''}" data-devoir-id="${devoir.id}" style="background-color: ${couleur};">`;
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

function showDevoirModal(devoirId) {
  const devoir = devoirs.find(d => d.id === devoirId);
  if (!devoir) return;

  const matiere = matieres.find(m => m.id === devoir.matiere_id);
  const modalBody = document.getElementById('modal-body');

  let html = `
    <h3>${escapeHTML(devoir.titre)}</h3>
    <p><strong>Matière:</strong> `;
  const matiereNomHtml = escapeHTML(devoir.matiere_nom || 'Non définie');
  if (matiere.lien) {
    html += `<a href="${matiere.lien}" target="_blank">${matiereNomHtml}</a>`
  } else {
    html += matiereNomHtml;
  }
  html += `</p>
    ${devoir.description ? `<p><strong>Description:</strong> ${escapeHTML(devoir.description)}</p>` : ''}
    ${devoir.date ? `<p><strong>Pour le:</strong> ${formatDate(devoir.date)}</p>` : ''}
    <p><strong>Créé par:</strong> ${escapeHTML(devoir.created_by_username)}</p>
    <div class="modal-actions">
      <label class="checkbox-container">
        <input type="checkbox" ${devoir.fait ? 'checked' : ''} id="devoir-statut-${devoir.id}">
        <span>Marquer comme fait</span>
      </label>
      <button class="btn-secondary" id="edit-devoir-${devoir.id}">Modifier</button>
      <button class="btn-danger" id="delete-devoir-${devoir.id}">Supprimer</button>
    </div>
  `;

  modalBody.innerHTML = html;

  document.getElementById(`devoir-statut-${devoir.id}`).addEventListener('change', async function() {
    await toggleDevoirStatut(devoir.id, this.checked);
    toggleModal('devoir-modal', false);
  });

  document.getElementById(`edit-devoir-${devoir.id}`).addEventListener('click', () => editDevoir(devoir.id));
  document.getElementById(`delete-devoir-${devoir.id}`).addEventListener('click', () => deleteDevoir(devoir.id));

  toggleModal('devoir-modal', true);
}

function showAddDevoirModal(dateStr) {
  const dateLimiteInput = document.getElementById('devoir-date-limite');

  if (dateStr) {
    dateLimiteInput.value = dateStr;
  }

  updateMatiereSelect();
  toggleModal('add-devoir-modal', true);
}

async function handleAddDevoir(e) {
  e.preventDefault();

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
    alert(data.error);
  } else {
    toggleModal('add-devoir-modal', false);
    document.getElementById('devoir-form').reset();
    await loadDevoirs();
    renderCalendar();
  }
}

async function editDevoir(id) {
  const devoir = devoirs.find(d => d.id === id);
  if (!devoir) return;

  toggleModal('devoir-modal', false);

  document.getElementById('edit-devoir-id').value = devoir.id;
  document.getElementById('edit-devoir-titre').value = devoir.titre;
  document.getElementById('edit-devoir-description').value = devoir.description || '';
  document.getElementById('edit-devoir-date-limite').value = devoir.date || '';

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

  toggleModal('edit-devoir-modal', true);
}

async function handleEditDevoir(e) {
  e.preventDefault();

  const id = document.getElementById('edit-devoir-id').value;

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
    alert(data.error);
  } else {
    toggleModal('edit-devoir-modal', false);
    document.getElementById('edit-devoir-form').reset();
    await loadDevoirs();
    renderCalendar();
  }
}

async function deleteDevoir(id) {
  if (!confirm('Supprimer ce devoir ?')) return;

  await apiCall(`/api/devoirs/${id}`, { method: 'DELETE' });
  toggleModal('devoir-modal', false);
  await loadDevoirs();
  renderCalendar();
}

async function toggleDevoirStatut(devoirId, fait) {
  await apiCall(`/api/devoirs/${devoirId}/statut`, {
    method: 'POST',
    body: JSON.stringify({ fait }),
  });
  await loadDevoirs();
  renderCalendar();
}

init();
