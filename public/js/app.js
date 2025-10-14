// État global
let currentUser = null;
let matieres = [];
let devoirs = [];
let eleves = [];

// WebSocket pour rechargement automatique
let ws = null;

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'update') {
      // Recharger les données selon le rôle
      if (currentUser?.role === 'admin') {
        loadAdminData();
      } else if (currentUser?.role === 'eleve') {
        loadEleveData();
      }
    }
  };

  ws.onclose = () => {
    // Reconnecter après 3 secondes
    setTimeout(initWebSocket, 3000);
  };
}

// Utilitaires
async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok && response.status !== 401 && response.status !== 403) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    return { error: error.message };
  }
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
    page.classList.add('hidden');
  });
  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.remove('hidden');
    targetPage.classList.add('active');
  }
}

function formatDate(dateString) {
  if (!dateString) return 'Aucune date limite';
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// Authentification
async function checkAuth() {
  const data = await apiCall('/api/auth/me');

  if (data.authenticated) {
    currentUser = data;
    initWebSocket();

    if (data.role === 'admin') {
      document.getElementById('user-info').textContent = `Admin: ${data.username}`;
      showPage('admin-page');
      loadAdminData();
    } else {
      document.getElementById('eleve-info').textContent = data.username;
      showPage('eleve-page');
      loadEleveData();
    }
  } else {
    showPage('login-page');
  }
}

async function logout() {
  await apiCall('/api/auth/logout', { method: 'POST' });
  if (ws) ws.close();
  currentUser = null;
  showPage('login-page');
}

// Event listeners
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  const data = await apiCall('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  if (data.error) {
    document.getElementById('login-error').textContent = data.error;
  } else {
    document.getElementById('login-error').textContent = '';
    checkAuth();
  }
});

document.getElementById('logout-btn')?.addEventListener('click', logout);
document.getElementById('logout-eleve-btn')?.addEventListener('click', logout);

// Admin - Gestion des onglets
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// Admin - Élèves
async function loadEleves() {
  const data = await apiCall('/api/admin/eleves');
  if (!data.error) {
    eleves = data;
    renderEleves();
  }
}

function renderEleves() {
  const list = document.getElementById('eleves-list');
  list.innerHTML = '';

  if (eleves.length === 0) {
    list.innerHTML = '<p>Aucun élève pour le moment.</p>';
    return;
  }

  eleves.forEach(eleve => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="list-item-info">
        <h3>${eleve.username}</h3>
        <p>Créé le: ${formatDate(eleve.created_at)}</p>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary" onclick="editEleve(${eleve.id})">Modifier</button>
        <button class="btn-danger" onclick="deleteEleve(${eleve.id})">Supprimer</button>
      </div>
    `;
    list.appendChild(item);
  });
}

document.getElementById('add-eleve-btn').addEventListener('click', () => {
  document.getElementById('add-eleve-form').classList.toggle('hidden');
});

document.getElementById('cancel-eleve-btn').addEventListener('click', () => {
  document.getElementById('add-eleve-form').classList.add('hidden');
  document.getElementById('eleve-form').reset();
});

document.getElementById('eleve-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('eleve-username').value;
  const password = document.getElementById('eleve-password').value;

  const data = await apiCall('/api/admin/eleves', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  if (data.error) {
    alert(data.error);
  } else {
    document.getElementById('add-eleve-form').classList.add('hidden');
    document.getElementById('eleve-form').reset();
    loadEleves();
  }
});

async function editEleve(id) {
  const eleve = eleves.find(e => e.id === id);
  if (!eleve) return;

  // Remplir le modal avec les données de l'élève
  document.getElementById('edit-eleve-id').value = eleve.id;
  document.getElementById('edit-eleve-username').value = eleve.username;
  document.getElementById('edit-eleve-password').value = '';
  document.getElementById('edit-eleve-password-confirm').value = '';

  // Ouvrir le modal
  document.getElementById('edit-eleve-modal').classList.add('active');
}

async function deleteEleve(id) {
  if (!confirm('Supprimer cet élève ?')) return;

  await apiCall(`/api/admin/eleves/${id}`, { method: 'DELETE' });
  loadEleves();
}

// Admin - Matières
async function loadMatieres() {
  const data = await apiCall('/api/admin/matieres');
  if (!data.error) {
    matieres = data;
    renderMatieres();
  }
}

function renderMatieres() {
  const list = document.getElementById('matieres-list');
  list.innerHTML = '';

  if (matieres.length === 0) {
    list.innerHTML = '<p>Aucune matière pour le moment.</p>';
    return;
  }

  matieres.forEach(matiere => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="list-item-info">
        <div class="matiere-color-indicator" style="background-color: ${matiere.couleur || '#999'}; width: 50px; height: 50px; border-radius: 8px; margin-right: 1rem; flex-shrink: 0;"></div>
        <div>
          <h3>${matiere.nom}</h3>
          ${matiere.lien ? `<p><a href="${matiere.lien}" target="_blank">Lien</a></p>` : ''}
          <p style="color: #666; font-size: 0.9rem;">Couleur: ${matiere.couleur || 'Non définie'}</p>
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary" onclick="editMatiere(${matiere.id})">Modifier</button>
        <button class="btn-danger" onclick="deleteMatiere(${matiere.id})">Supprimer</button>
      </div>
    `;
    list.appendChild(item);
  });
}

// Palette de couleurs vives
const availableColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
  '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80',
  '#EC7063', '#5DADE2', '#F39C12', '#AF7AC5', '#48C9B0',
  '#E74C3C', '#3498DB', '#2ECC71', '#E67E22', '#9B59B6',
  '#1ABC9C', '#34495E', '#16A085', '#27AE60', '#2980B9',
  '#8E44AD', '#2C3E50', '#F1C40F', '#E08E79', '#73C6B6'
];

function getNextAvailableColor() {
  const usedColors = matieres.map(m => m.couleur).filter(c => c);
  const available = availableColors.filter(color => !usedColors.includes(color));

  if (available.length === 0) {
    // Si toutes les couleurs sont utilisées, générer une couleur aléatoire
    return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
  }

  return available[0]; // Retourner la première couleur disponible
}

document.getElementById('add-matiere-btn')?.addEventListener('click', () => {
  // Obtenir une couleur unique disponible
  const couleur = getNextAvailableColor();

  const couleurInput = document.getElementById('add-matiere-couleur');
  const couleurPreview = document.getElementById('add-matiere-couleur-preview');
  const couleurCode = document.getElementById('add-matiere-couleur-code');

  couleurInput.value = couleur;
  couleurPreview.style.backgroundColor = couleur;
  couleurCode.textContent = couleur;

  // Mettre à jour la prévisualisation quand on change la couleur
  couleurInput.onchange = function() {
    couleurPreview.style.backgroundColor = this.value;
    couleurCode.textContent = this.value;
  };

  // Ouvrir le modal
  document.getElementById('add-matiere-modal').classList.add('active');
});

document.getElementById('close-add-matiere-modal')?.addEventListener('click', () => {
  document.getElementById('add-matiere-modal').classList.remove('active');
});

document.getElementById('cancel-add-matiere-btn')?.addEventListener('click', () => {
  document.getElementById('add-matiere-modal').classList.remove('active');
  document.getElementById('add-matiere-form').reset();
});

document.getElementById('add-matiere-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const nom = document.getElementById('add-matiere-nom').value;
  const lien = document.getElementById('add-matiere-lien').value;
  const couleur = document.getElementById('add-matiere-couleur').value;

  const data = await apiCall('/api/admin/matieres', {
    method: 'POST',
    body: JSON.stringify({ nom, lien, couleur })
  });

  if (data.error) {
    alert(data.error);
  } else {
    document.getElementById('add-matiere-modal').classList.remove('active');
    document.getElementById('add-matiere-form').reset();
    loadMatieres();
  }
});

async function editMatiere(id) {
  const matiere = matieres.find(m => m.id === id);
  if (!matiere) return;

  // Remplir le modal avec les données de la matière
  document.getElementById('edit-matiere-id').value = matiere.id;
  document.getElementById('edit-matiere-nom').value = matiere.nom;
  document.getElementById('edit-matiere-lien').value = matiere.lien || '';

  // Définir la couleur (générer une couleur par défaut si non définie)
  const couleurInput = document.getElementById('edit-matiere-couleur');
  const couleurPreview = document.getElementById('edit-matiere-couleur-preview');
  const couleurCode = document.getElementById('edit-matiere-couleur-code');

  const couleurActuelle = matiere.couleur || '#4A90E2';
  couleurInput.value = couleurActuelle;
  couleurPreview.style.backgroundColor = couleurActuelle;
  couleurCode.textContent = couleurActuelle;

  // Mettre à jour la prévisualisation quand on change la couleur
  couleurInput.onchange = function() {
    couleurPreview.style.backgroundColor = this.value;
    couleurCode.textContent = this.value;
  };

  // Ouvrir le modal
  document.getElementById('edit-matiere-modal').classList.add('active');
}

async function deleteMatiere(id) {
  if (!confirm('Supprimer cette matière ?')) return;

  await apiCall(`/api/admin/matieres/${id}`, { method: 'DELETE' });
  loadMatieres();
}

// Gestion des modals d'édition - Matière
document.getElementById('close-edit-matiere-modal')?.addEventListener('click', () => {
  document.getElementById('edit-matiere-modal').classList.remove('active');
});

document.getElementById('cancel-edit-matiere-btn')?.addEventListener('click', () => {
  document.getElementById('edit-matiere-modal').classList.remove('active');
});

document.getElementById('edit-matiere-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('edit-matiere-id').value;
  const nom = document.getElementById('edit-matiere-nom').value;
  const lien = document.getElementById('edit-matiere-lien').value;
  const couleur = document.getElementById('edit-matiere-couleur').value;

  const data = await apiCall(`/api/admin/matieres/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nom, lien, couleur })
  });

  if (data.error) {
    alert(data.error);
  } else {
    document.getElementById('edit-matiere-modal').classList.remove('active');
    loadMatieres();
  }
});

// Gestion des modals d'édition - Élève
document.getElementById('close-edit-eleve-modal')?.addEventListener('click', () => {
  document.getElementById('edit-eleve-modal').classList.remove('active');
});

document.getElementById('cancel-edit-eleve-btn')?.addEventListener('click', () => {
  document.getElementById('edit-eleve-modal').classList.remove('active');
});

document.getElementById('edit-eleve-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('edit-eleve-id').value;
  const username = document.getElementById('edit-eleve-username').value;
  const password = document.getElementById('edit-eleve-password').value;
  const passwordConfirm = document.getElementById('edit-eleve-password-confirm').value;

  // Si un mot de passe est saisi, vérifier qu'ils correspondent
  if (password) {
    if (password !== passwordConfirm) {
      alert('Les mots de passe ne correspondent pas');
      return;
    }
  }

  const data = await apiCall(`/api/admin/eleves/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ username, password: password || undefined })
  });

  if (data.error) {
    alert(data.error);
    return;
  }

  document.getElementById('edit-eleve-modal').classList.remove('active');
  alert('Modifications enregistrées');
  loadEleves();
});

// Admin - Paramètres
async function loadSettings() {
  const data = await apiCall('/api/admin/settings/emploi-temps');
  if (!data.error) {
    document.getElementById('emploi-temps-lien').value = data.lien || '';
  }
}

document.getElementById('admin-password-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const oldPassword = document.getElementById('admin-old-password').value;
  const newPassword = document.getElementById('admin-new-password').value;
  const confirmPassword = document.getElementById('admin-confirm-password').value;

  if (newPassword !== confirmPassword) {
    alert('Les nouveaux mots de passe ne correspondent pas');
    return;
  }

  const data = await apiCall('/api/admin/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });

  if (data.error) {
    alert(data.error);
  } else {
    alert('Mot de passe modifié avec succès');
    document.getElementById('admin-password-form').reset();
  }
});

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const lien = document.getElementById('emploi-temps-lien').value;

  const data = await apiCall('/api/admin/settings/emploi-temps', {
    method: 'POST',
    body: JSON.stringify({ lien }),
  });

  if (data.error) {
    alert(data.error);
  } else {
    alert('Paramètres enregistrés');
  }
});

async function loadAdminData() {
  await loadEleves();
  await loadMatieres();
  await loadSettings();
}

// Élève - Devoirs et Calendrier
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let currentWeekStart = null;
let selectedDate = null;
let isMobileView = false;

async function loadEleveData() {
  await loadMatieresForEleve();
  await loadDevoirs();
  await checkEmploiTempsButton();
  checkViewport();
  renderCalendar();
}

function checkViewport() {
  isMobileView = window.innerWidth <= 768;
  if (isMobileView && !currentWeekStart) {
    // Initialiser à la semaine courante
    const today = new Date();
    currentWeekStart = getWeekStart(today);
  }
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Lundi
  return new Date(d.setDate(diff));
}

// Écouter le redimensionnement
window.addEventListener('resize', () => {
  const wasMobile = isMobileView;
  checkViewport();
  if (wasMobile !== isMobileView) {
    renderCalendar();
  }
});

async function loadMatieresForEleve() {
  const data = await apiCall('/api/admin/matieres');
  if (!data.error) {
    matieres = data;
    updateMatiereSelect();
  }
}

function updateMatiereSelect() {
  const select = document.getElementById('devoir-matiere');
  if (!select) return;

  select.innerHTML = '<option value="">Sélectionner une matière</option>';

  matieres.forEach(matiere => {
    const option = document.createElement('option');
    option.value = matiere.id;
    option.textContent = matiere.nom;
    select.appendChild(option);
  });
}

async function loadDevoirs() {
  const data = await apiCall('/api/devoirs');
  if (!data.error) {
    devoirs = data;
    if (document.getElementById('calendar')) {
      renderCalendar();
    }
  }
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

  // Titre avec période de la semaine
  const startStr = `${currentWeekStart.getDate()} ${monthNames[currentWeekStart.getMonth()]}`;
  const endStr = `${weekEnd.getDate()} ${monthNames[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;
  document.getElementById('current-month').textContent = `${startStr} - ${endStr}`;

  let html = '<div class="mobile-view">';

  // Générer les 7 jours de la semaine
  for (let i = 0; i < 7; i++) {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + i);

    const dateStr = date.toISOString().split('T')[0];
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();

    const dayDevoirs = devoirs.filter(d => {
      if (!d.date_limite) return false;
      const devoirDate = new Date(d.date_limite).toISOString().split('T')[0];
      return devoirDate === dateStr;
    }).sort((a, b) => a.fait - b.fait);

    let cardClass = 'week-day-card';
    let headerClass = 'week-day-header';
    if (isToday) headerClass += ' today';

    html += `<div class="${cardClass}">`;
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
        html += `<div class="mobile-devoir-title">${devoir.titre}</div>`;
        html += `<div class="mobile-devoir-matiere" style="color: ${couleur};">${devoir.matiere_nom || 'Sans matière'}</div>`;
        html += `</div>`;
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

  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const prevLastDay = new Date(currentYear, currentMonth, 0);

  const firstDayIndex = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const lastDayDate = lastDay.getDate();
  const prevLastDayDate = prevLastDay.getDate();
  const nextDays = 7 - (lastDay.getDay() === 0 ? 6 : lastDay.getDay() - 1) - 1;

  let calendarHTML = '<div class="calendar-days">';
  dayNames.forEach(day => {
    calendarHTML += `<div class="calendar-day-header">${day}</div>`;
  });
  calendarHTML += '</div><div class="calendar-dates">';

  // Previous month days
  for (let x = firstDayIndex; x > 0; x--) {
    const date = new Date(currentYear, currentMonth - 1, prevLastDayDate - x + 1);
    calendarHTML += renderDateCell(date, true);
  }

  // Current month days
  for (let i = 1; i <= lastDayDate; i++) {
    const date = new Date(currentYear, currentMonth, i);
    calendarHTML += renderDateCell(date, false);
  }

  // Next month days
  for (let j = 1; j <= nextDays; j++) {
    const date = new Date(currentYear, currentMonth + 1, j);
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
    if (!d.date_limite) return false;
    const devoirDate = new Date(d.date_limite).toISOString().split('T')[0];
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
    html += `${devoir.titre}`;
    html += '</div>';
  });

  html += '</div></div>';
  return html;
}

async function toggleDevoirStatut(devoirId, fait) {
  await apiCall(`/api/devoirs/${devoirId}/statut`, {
    method: 'POST',
    body: JSON.stringify({ fait }),
  });
  loadDevoirs();
}

// Navigation calendrier
document.getElementById('prev-month')?.addEventListener('click', () => {
  if (isMobileView) {
    // Semaine précédente
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
  } else {
    // Mois précédent
    currentMonth--;
    if (currentMonth < 0) {
      currentMonth = 11;
      currentYear--;
    }
  }
  renderCalendar();
});

document.getElementById('next-month')?.addEventListener('click', () => {
  if (isMobileView) {
    // Semaine suivante
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
  } else {
    // Mois suivant
    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
  }
  renderCalendar();
});

// Gestion des clics sur le calendrier
document.addEventListener('click', (e) => {
  // Clic sur un devoir (mobile)
  if (e.target.closest('.mobile-devoir-item')) {
    e.stopPropagation();
    const item = e.target.closest('.mobile-devoir-item');
    const devoirId = parseInt(item.dataset.devoirId);
    showDevoirModal(devoirId);
    return;
  }

  // Clic sur un devoir (desktop)
  if (e.target.classList.contains('devoir-item')) {
    e.stopPropagation();
    const devoirId = parseInt(e.target.dataset.devoirId);
    showDevoirModal(devoirId);
    return;
  }

  // Clic sur header de jour (mobile) - ouvre le formulaire d'ajout
  if (e.target.closest('.week-day-header')) {
    e.stopPropagation();
    const header = e.target.closest('.week-day-header');
    const dateStr = header.dataset.date;
    selectedDate = dateStr;
    showAddDevoirModal(dateStr);
    return;
  }

  // Clic sur une date (desktop)
  if (e.target.closest('.calendar-date')) {
    const dateCell = e.target.closest('.calendar-date');
    const dateStr = dateCell.dataset.date;
    selectedDate = dateStr;
    showAddDevoirModal(dateStr);
  }
});

// Afficher modal devoir
function showDevoirModal(devoirId) {
  const devoir = devoirs.find(d => d.id === devoirId);
  if (!devoir) return;

  const matiere = matieres.find(m => m.id === devoir.matiere_id);
  const modal = document.getElementById('devoir-modal');
  const modalBody = document.getElementById('modal-body');

  let html = `
    <h3>${devoir.titre}</h3>
    <p><strong>Matière:</strong> ${devoir.matiere_nom || 'Non définie'}</p>
    ${devoir.description ? `<p><strong>Description:</strong> ${devoir.description}</p>` : ''}
    ${devoir.date_limite ? `<p><strong>Date limite:</strong> ${formatDate(devoir.date_limite)}</p>` : ''}
    <p><strong>Créé par:</strong> ${devoir.created_by_username}</p>
    <div class="modal-actions">
      <label class="checkbox-container">
        <input type="checkbox" ${devoir.fait ? 'checked' : ''} onchange="toggleDevoirStatut(${devoir.id}, this.checked); document.getElementById('devoir-modal').classList.remove('active');">
        <span>Marquer comme fait</span>
      </label>
      <button class="btn-secondary" onclick="editDevoir(${devoir.id})">Modifier</button>
      <button class="btn-danger" onclick="deleteDevoir(${devoir.id})">Supprimer</button>
    </div>
  `;

  modalBody.innerHTML = html;
  modal.classList.add('active');
}

// Afficher modal ajout devoir
function showAddDevoirModal(dateStr) {
  const modal = document.getElementById('add-devoir-modal');
  const dateLimiteInput = document.getElementById('devoir-date-limite');

  // Pré-remplir la date
  if (dateStr) {
    dateLimiteInput.value = dateStr;
  }

  updateMatiereSelect();
  modal.classList.add('active');
}

// Fermer les modals
document.getElementById('close-modal')?.addEventListener('click', () => {
  document.getElementById('devoir-modal').classList.remove('active');
});

document.getElementById('close-add-modal')?.addEventListener('click', () => {
  document.getElementById('add-devoir-modal').classList.remove('active');
});

document.getElementById('cancel-devoir-btn')?.addEventListener('click', () => {
  document.getElementById('add-devoir-modal').classList.remove('active');
  document.getElementById('devoir-form').reset();
});

document.getElementById('close-edit-devoir-modal')?.addEventListener('click', () => {
  document.getElementById('edit-devoir-modal').classList.remove('active');
});

document.getElementById('cancel-edit-devoir-btn')?.addEventListener('click', () => {
  document.getElementById('edit-devoir-modal').classList.remove('active');
  document.getElementById('edit-devoir-form').reset();
});

// Fermer modal en cliquant en dehors
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
});

document.getElementById('devoir-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const data = await apiCall('/api/devoirs', {
    method: 'POST',
    body: JSON.stringify({
      titre: document.getElementById('devoir-titre').value,
      description: document.getElementById('devoir-description').value,
      matiere_id: document.getElementById('devoir-matiere').value,
      date_limite: document.getElementById('devoir-date-limite').value
    })
  });

  if (data.error) {
    alert(data.error);
  } else {
    document.getElementById('add-devoir-modal').classList.remove('active');
    document.getElementById('devoir-form').reset();
    loadDevoirs();
  }
});

document.getElementById('edit-devoir-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('edit-devoir-id').value;

  const data = await apiCall(`/api/devoirs/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      titre: document.getElementById('edit-devoir-titre').value,
      description: document.getElementById('edit-devoir-description').value,
      matiere_id: document.getElementById('edit-devoir-matiere').value,
      date_limite: document.getElementById('edit-devoir-date-limite').value
    })
  });

  if (data.error) {
    alert(data.error);
  } else {
    document.getElementById('edit-devoir-modal').classList.remove('active');
    document.getElementById('edit-devoir-form').reset();
    loadDevoirs();
  }
});

async function editDevoir(id) {
  const devoir = devoirs.find(d => d.id === id);
  if (!devoir) return;

  // Fermer le modal de détails
  document.getElementById('devoir-modal')?.classList.remove('active');

  // Pré-remplir le formulaire d'édition
  document.getElementById('edit-devoir-id').value = devoir.id;
  document.getElementById('edit-devoir-titre').value = devoir.titre;
  document.getElementById('edit-devoir-description').value = devoir.description || '';
  document.getElementById('edit-devoir-date-limite').value = devoir.date_limite || '';

  // Remplir le select des matières
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

  // Ouvrir le modal d'édition
  document.getElementById('edit-devoir-modal').classList.add('active');
}

async function deleteDevoir(id) {
  if (!confirm('Supprimer ce devoir ?')) return;

  await apiCall(`/api/devoirs/${id}`, { method: 'DELETE' });
  document.getElementById('devoir-modal')?.classList.remove('active');
  loadDevoirs();
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

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});
