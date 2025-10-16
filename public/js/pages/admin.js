import { apiCall, checkAuth, logout } from '../utils/api.js';
import { escapeHTML, formatDate, toggleModal, setupModalClose } from '../utils/dom.js';
import { initWebSocket } from '../utils/websocket.js';

let eleves = [];
let matieres = [];

const availableColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
  '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80',
  '#EC7063', '#5DADE2', '#F39C12', '#AF7AC5', '#48C9B0',
  '#E74C3C', '#3498DB', '#2ECC71', '#E67E22', '#9B59B6',
  '#1ABC9C', '#34495E', '#16A085', '#27AE60', '#2980B9',
  '#8E44AD', '#2C3E50', '#F1C40F', '#E08E79', '#73C6B6'
];

async function init() {
  const auth = await checkAuth();

  if (!auth.authenticated) {
    window.location.href = '/login';
    return;
  }

  if (auth.role !== 'admin') {
    window.location.href = '/dashboard';
    return;
  }

  document.getElementById('user-info').textContent = `Admin: ${auth.username}`;

  initWebSocket(loadAllData);
  await loadAllData();

  setupEventListeners();
}

async function loadAllData() {
  await Promise.all([
    loadEleves(),
    loadMatieres(),
    loadSettings()
  ]);
}

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
        <h3>${escapeHTML(eleve.username)}</h3>
        <p>Créé le: ${formatDate(eleve.created_at)}</p>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary edit-eleve-btn" data-id="${eleve.id}">Modifier</button>
        <button class="btn-danger delete-eleve-btn" data-id="${eleve.id}">Supprimer</button>
      </div>
    `;
    list.appendChild(item);
  });

  document.querySelectorAll('.edit-eleve-btn').forEach(btn => {
    btn.addEventListener('click', () => editEleve(parseInt(btn.dataset.id)));
  });

  document.querySelectorAll('.delete-eleve-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteEleve(parseInt(btn.dataset.id)));
  });
}

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
          <h3>${escapeHTML(matiere.nom)}</h3>
          ${matiere.lien ? `<p><a href="${matiere.lien}" target="_blank">Lien</a></p>` : ''}
          <p style="color: #666; font-size: 0.9rem;">Couleur: ${matiere.couleur || 'Non définie'}</p>
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary edit-matiere-btn" data-id="${matiere.id}">Modifier</button>
        <button class="btn-danger delete-matiere-btn" data-id="${matiere.id}">Supprimer</button>
      </div>
    `;
    list.appendChild(item);
  });

  document.querySelectorAll('.edit-matiere-btn').forEach(btn => {
    btn.addEventListener('click', () => editMatiere(parseInt(btn.dataset.id)));
  });

  document.querySelectorAll('.delete-matiere-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteMatiere(parseInt(btn.dataset.id)));
  });
}

async function loadSettings() {
  const data = await apiCall('/api/admin/settings/emploi-temps');
  if (!data.error) {
    document.getElementById('emploi-temps-lien').value = data.lien || '';
  }
}

function setupEventListeners() {
  document.getElementById('logout-btn').addEventListener('click', logout);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  document.getElementById('add-eleve-btn').addEventListener('click', () => {
    document.getElementById('add-eleve-form').classList.toggle('hidden');
  });

  document.getElementById('cancel-eleve-btn').addEventListener('click', () => {
    document.getElementById('add-eleve-form').classList.add('hidden');
    document.getElementById('eleve-form').reset();
  });

  document.getElementById('eleve-form').addEventListener('submit', handleAddEleve);

  document.getElementById('add-matiere-btn').addEventListener('click', showAddMatiereModal);

  setupModalClose('add-matiere-modal', 'close-add-matiere-modal');
  setupModalClose('edit-matiere-modal', 'close-edit-matiere-modal');
  setupModalClose('edit-eleve-modal', 'close-edit-eleve-modal');

  document.getElementById('cancel-add-matiere-btn').addEventListener('click', () => {
    toggleModal('add-matiere-modal', false);
    document.getElementById('add-matiere-form').reset();
  });

  document.getElementById('cancel-edit-matiere-btn').addEventListener('click', () => {
    toggleModal('edit-matiere-modal', false);
  });

  document.getElementById('cancel-edit-eleve-btn').addEventListener('click', () => {
    toggleModal('edit-eleve-modal', false);
  });

  document.getElementById('add-matiere-form').addEventListener('submit', handleAddMatiere);
  document.getElementById('edit-matiere-form').addEventListener('submit', handleEditMatiere);
  document.getElementById('edit-eleve-form').addEventListener('submit', handleEditEleve);

  document.getElementById('admin-password-form').addEventListener('submit', handleChangePassword);
  document.getElementById('settings-form').addEventListener('submit', handleSaveSettings);
}

async function handleAddEleve(e) {
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
    await loadEleves();
  }
}

function editEleve(id) {
  const eleve = eleves.find(e => e.id === id);
  if (!eleve) return;

  document.getElementById('edit-eleve-id').value = eleve.id;
  document.getElementById('edit-eleve-username').value = eleve.username;
  document.getElementById('edit-eleve-password').value = '';
  document.getElementById('edit-eleve-password-confirm').value = '';

  toggleModal('edit-eleve-modal', true);
}

async function handleEditEleve(e) {
  e.preventDefault();

  const id = document.getElementById('edit-eleve-id').value;
  const username = document.getElementById('edit-eleve-username').value;
  const password = document.getElementById('edit-eleve-password').value;
  const passwordConfirm = document.getElementById('edit-eleve-password-confirm').value;

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

  toggleModal('edit-eleve-modal', false);
  alert('Modifications enregistrées');
  await loadEleves();
}

async function deleteEleve(id) {
  if (!confirm('Supprimer cet élève ?')) return;

  await apiCall(`/api/admin/eleves/${id}`, { method: 'DELETE' });
  await loadEleves();
}

function getNextAvailableColor() {
  const usedColors = matieres.map(m => m.couleur).filter(c => c);
  const available = availableColors.filter(color => !usedColors.includes(color));

  if (available.length === 0) {
    return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
  }

  return available[0];
}

function showAddMatiereModal() {
  const couleur = getNextAvailableColor();

  const couleurInput = document.getElementById('add-matiere-couleur');
  const couleurPreview = document.getElementById('add-matiere-couleur-preview');
  const couleurCode = document.getElementById('add-matiere-couleur-code');

  couleurInput.value = couleur;
  couleurPreview.style.backgroundColor = couleur;
  couleurCode.textContent = couleur;

  couleurInput.onchange = function() {
    couleurPreview.style.backgroundColor = this.value;
    couleurCode.textContent = this.value;
  };

  toggleModal('add-matiere-modal', true);
}

async function handleAddMatiere(e) {
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
    toggleModal('add-matiere-modal', false);
    document.getElementById('add-matiere-form').reset();
    await loadMatieres();
  }
}

function editMatiere(id) {
  const matiere = matieres.find(m => m.id === id);
  if (!matiere) return;

  document.getElementById('edit-matiere-id').value = matiere.id;
  document.getElementById('edit-matiere-nom').value = matiere.nom;
  document.getElementById('edit-matiere-lien').value = matiere.lien || '';

  const couleurInput = document.getElementById('edit-matiere-couleur');
  const couleurPreview = document.getElementById('edit-matiere-couleur-preview');
  const couleurCode = document.getElementById('edit-matiere-couleur-code');

  const couleurActuelle = matiere.couleur || '#4A90E2';
  couleurInput.value = couleurActuelle;
  couleurPreview.style.backgroundColor = couleurActuelle;
  couleurCode.textContent = couleurActuelle;

  couleurInput.onchange = function() {
    couleurPreview.style.backgroundColor = this.value;
    couleurCode.textContent = this.value;
  };

  toggleModal('edit-matiere-modal', true);
}

async function handleEditMatiere(e) {
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
    toggleModal('edit-matiere-modal', false);
    await loadMatieres();
  }
}

async function deleteMatiere(id) {
  if (!confirm('Supprimer cette matière ?')) return;

  await apiCall(`/api/admin/matieres/${id}`, { method: 'DELETE' });
  await loadMatieres();
}

async function handleChangePassword(e) {
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
}

async function handleSaveSettings(e) {
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
}

init();
