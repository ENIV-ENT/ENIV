import { apiCall, checkAuth, logout } from '../utils/api.js';
import { escapeHTML, formatDate, toggleModal, setupModalClose, showAlert, showConfirm } from '../utils/dom.js';

let eleves = [];
let matieres = [];
let invitations = [];
let logs = [];

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

  document.getElementById('user-info').textContent = `Admin: ${auth.username}`;

  await loadAllData();

  setupEventListeners();
}

async function loadAllData() {
  await Promise.all([
    loadEleves(),
    loadMatieres(),
    loadSettings(),
    loadInvitations(),
    loadLogs()
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

  const webhookData = await apiCall('/api/admin/settings/discord-webhook');
  if (!webhookData.error) {
    document.getElementById('discord-webhook-url').value = webhookData.webhook || '';
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
    toggleModal('add-eleve-modal', true);
  });

  document.getElementById('cancel-add-eleve-btn').addEventListener('click', () => {
    toggleModal('add-eleve-modal', false);
    document.getElementById('add-eleve-form').reset();
  });

  document.getElementById('add-eleve-form').addEventListener('submit', handleAddEleve);

  document.getElementById('add-matiere-btn').addEventListener('click', showAddMatiereModal);

  setupModalClose('add-eleve-modal', 'close-add-eleve-modal');
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
  document.getElementById('discord-webhook-form').addEventListener('submit', handleSaveDiscordWebhook);
}

async function handleAddEleve(e) {
  e.preventDefault();

  const email = document.getElementById('eleve-email').value;

  const data = await apiCall('/api/invitations/create', {
    method: 'POST',
    body: JSON.stringify({ email, role: 'eleve' }),
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    toggleModal('add-eleve-modal', false);
    await showAlert('Invitation envoyée avec succès à ' + email, 'Succès');
    document.getElementById('add-eleve-form').reset();
    await loadEleves();
    await loadInvitations();
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
      await showAlert('Les mots de passe ne correspondent pas', 'Erreur');
      return;
    }
  }

  const data = await apiCall(`/api/admin/eleves/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ username, password: password || undefined })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
    return;
  }

  toggleModal('edit-eleve-modal', false);
  await showAlert('Modifications enregistrées', 'Succès');
  await loadEleves();
}

async function deleteEleve(id) {
  const confirmed = await showConfirm('Êtes-vous sûr de vouloir supprimer cet élève ?', 'Confirmation');
  if (!confirmed) return;

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
    await showAlert(data.error, 'Erreur');
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
    await showAlert(data.error, 'Erreur');
  } else {
    toggleModal('edit-matiere-modal', false);
    await loadMatieres();
  }
}

async function deleteMatiere(id) {
  const confirmed = await showConfirm('Êtes-vous sûr de vouloir supprimer cette matière ?', 'Confirmation');
  if (!confirmed) return;

  await apiCall(`/api/admin/matieres/${id}`, { method: 'DELETE' });
  await loadMatieres();
}

async function handleChangePassword(e) {
  e.preventDefault();

  const oldPassword = document.getElementById('admin-old-password').value;
  const newPassword = document.getElementById('admin-new-password').value;
  const confirmPassword = document.getElementById('admin-confirm-password').value;

  if (newPassword !== confirmPassword) {
    await showAlert('Les nouveaux mots de passe ne correspondent pas', 'Erreur');
    return;
  }

  const data = await apiCall('/api/admin/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    await showAlert('Mot de passe modifié avec succès', 'Succès');
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
    await showAlert(data.error, 'Erreur');
  } else {
    await showAlert('Paramètres enregistrés', 'Succès');
  }
}

async function handleSaveDiscordWebhook(e) {
  e.preventDefault();

  const webhook = document.getElementById('discord-webhook-url').value;

  if (webhook && !webhook.match(/^https:\/\/discord\.com\/api\/webhooks\/.+/)) {
    await showAlert('URL de webhook Discord invalide. Elle doit commencer par https://discord.com/api/webhooks/', 'Erreur');
    return;
  }

  const data = await apiCall('/api/admin/settings/discord-webhook', {
    method: 'POST',
    body: JSON.stringify({ webhook }),
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    await showAlert('Webhook Discord enregistré avec succès', 'Succès');
  }
}

async function loadInvitations() {
  const data = await apiCall("/api/invitations/list");
  if (data && Array.isArray(data)) {
    invitations = data;
    renderInvitations();
  }
}

function renderInvitations() {
  const container = document.getElementById("invitations-list");
  container.innerHTML = "";

  if (invitations.length === 0) {
    container.innerHTML = "<p>Aucune invitation en attente.</p>";
    return;
  }

  invitations.forEach((invitation) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const createdDate = new Date(invitation.created_at).toLocaleDateString('fr-FR');
    const expiresDate = new Date(invitation.expires_at).toLocaleDateString('fr-FR');

    item.innerHTML = `
      <div class="list-item-info">
        <h3>${escapeHTML(invitation.email)}</h3>
        <p style="font-size: 0.8rem; color: var(--secondary);">
          Envoyée le ${createdDate} - Expire le ${expiresDate}
        </p>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary resend-invitation-btn" data-id="${invitation.id}">Renvoyer l'email</button>
        <button class="btn-danger delete-invitation-btn" data-id="${invitation.id}">Supprimer</button>
      </div>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll(".resend-invitation-btn").forEach((btn) => {
    btn.addEventListener("click", () => resendInvitation(parseInt(btn.dataset.id)));
  });

  document.querySelectorAll(".delete-invitation-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteInvitation(parseInt(btn.dataset.id)));
  });
}

async function resendInvitation(id) {
  const data = await apiCall(`/api/invitations/resend/${id}`, {
    method: "POST",
  });

  if (data.success) {
    await showAlert(data.message, 'Succès');
  } else if (data.error) {
    await showAlert(data.error, 'Erreur');
  }
}

async function deleteInvitation(id) {
  const confirmed = await showConfirm('Êtes-vous sûr de vouloir supprimer cette invitation ?', 'Confirmation');
  if (!confirmed) {
    return;
  }

  const data = await apiCall(`/api/invitations/${id}`, {
    method: "DELETE",
  });

  if (data.success) {
    await loadInvitations();
  } else if (data.error) {
    await showAlert(data.error, 'Erreur');
  }
}

async function loadLogs() {
  const data = await apiCall('/api/admin/logs/devoirs');
  if (!data.error) {
    logs = data;
    renderLogs();
  }
}

function renderLogs() {
  const list = document.getElementById('logs-list');
  list.innerHTML = '';

  if (logs.length === 0) {
    list.innerHTML = '<p>Aucun log pour le moment.</p>';
    return;
  }

  logs.forEach(log => {
    const item = document.createElement('div');
    item.className = 'list-item';

    let actionText = '';
    let actionClass = '';
    let detailsHtml = '';

    try {
      const details = JSON.parse(log.details);

      switch(log.action) {
        case 'create':
          actionText = 'a créé le devoir';
          actionClass = 'log-create';
          detailsHtml = `<strong>${escapeHTML(details.titre)}</strong>`;
          if (details.description) {
            detailsHtml += `<br><small>${escapeHTML(details.description)}</small>`;
          }
          break;
        case 'update':
          actionText = 'a modifié le devoir';
          actionClass = 'log-update';
          detailsHtml = `<strong>${escapeHTML(details.old.titre)}</strong>`;
          if (details.old.titre !== details.new.titre) {
            detailsHtml += ` → <strong>${escapeHTML(details.new.titre)}</strong>`;
          }
          break;
        case 'delete':
          actionText = 'a supprimé le devoir';
          actionClass = 'log-delete';
          detailsHtml = `<strong>${escapeHTML(details.titre)}</strong>`;
          break;
        case 'upload_pdf':
          actionText = 'a ajouté un document';
          actionClass = 'log-create';
          detailsHtml = `<strong>${escapeHTML(details.filename)}</strong>`;
          if (details.size) {
            const sizeKB = Math.round(details.size / 1024);
            detailsHtml += `<br><small>Taille: ${sizeKB} Ko</small>`;
          }
          break;
        case 'delete_pdf':
          actionText = 'a supprimé un document';
          actionClass = 'log-delete';
          detailsHtml = `<strong>${escapeHTML(details.filename)}</strong>`;
          if (details.deleted_by) {
            detailsHtml += `<br><small>Supprimé par: ${escapeHTML(details.deleted_by)}</small>`;
          }
          break;
        default:
          actionText = 'action inconnue';
          actionClass = '';
          detailsHtml = 'Détails non disponibles';
      }
    } catch (e) {
      detailsHtml = 'Détails non disponibles';
    }

    const date = new Date(log.created_at);
    const dateStr = date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    item.innerHTML = `
      <div class="list-item-info">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
          <span class="log-badge ${actionClass}">${actionText}</span>
          <span style="color: var(--secondary); font-size: 0.9rem;">${dateStr}</span>
        </div>
        <div style="margin-bottom: 0.25rem;">
          <strong>${escapeHTML(log.username)}</strong> ${actionText}
        </div>
        <div style="color: var(--text);">
          ${detailsHtml}
        </div>
      </div>
    `;
    list.appendChild(item);
  });
}

init();
