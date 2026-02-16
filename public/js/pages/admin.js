import { apiCall, checkAuth, logout } from '../utils/api.js';
import { escapeHTML, formatDate, toggleModal, setupModalClose, showAlert, showConfirm } from '../utils/dom.js';

let eleves = [];
let matieres = [];
let invitations = [];
let logs = [];
let joinRequests = [];

async function init() {
  const auth = await checkAuth();

  if (!auth.authenticated || !auth.is_admin) {
    window.location.href = '/dashboard';
    return;
  }

  document.getElementById('user-info').textContent = auth.username;

  loadThemePreference();

  await loadAllData();
  setupEventListeners();
  setupUserMenu();
}

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

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeButton(isDark);
}

function updateThemeButton(isDark) {
  const themeIcon = document.getElementById('theme-icon');
  const themeText = document.getElementById('theme-text');

  if (!themeIcon || !themeText) return;

  if (isDark) {
    themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    themeText.textContent = 'Theme clair';
  } else {
    themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    themeText.textContent = 'Theme sombre';
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

  document.getElementById('dashboard-btn').addEventListener('click', () => {
    window.location.href = '/dashboard';
  });

  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('settings-btn').addEventListener('click', () => {
    window.location.href = '/settings';
  });

  const notesBtn = document.getElementById('notes-btn');
  if (notesBtn) {
    notesBtn.addEventListener('click', () => {
      window.open('https://iut-notes.unice.fr', '_blank');
      dropdown.classList.add('hidden');
    });
  }

  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

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

async function loadAllData() {
  await Promise.all([
    loadEleves(),
    loadMatieres(),
    loadJoinRequests(),
    loadInvitations(),
    loadLogs(),
    loadSettings(),
    loadInviteLink()
  ]);
}

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Add eleve
  document.getElementById('add-eleve-btn').addEventListener('click', () => toggleModal('add-eleve-modal', true));
  document.getElementById('cancel-add-eleve').addEventListener('click', () => toggleModal('add-eleve-modal', false));
  setupModalClose('add-eleve-modal', 'close-add-eleve-modal');
  document.getElementById('add-eleve-form').addEventListener('submit', handleAddEleve);

  // Edit eleve
  document.getElementById('cancel-edit-eleve').addEventListener('click', () => toggleModal('edit-eleve-modal', false));
  setupModalClose('edit-eleve-modal', 'close-edit-eleve-modal');
  document.getElementById('edit-eleve-form').addEventListener('submit', handleEditEleve);

  // Add matiere
  document.getElementById('add-matiere-btn').addEventListener('click', () => toggleModal('add-matiere-modal', true));
  document.getElementById('cancel-add-matiere').addEventListener('click', () => toggleModal('add-matiere-modal', false));
  setupModalClose('add-matiere-modal', 'close-add-matiere-modal');
  document.getElementById('add-matiere-form').addEventListener('submit', handleAddMatiere);

  // Edit matiere
  document.getElementById('cancel-edit-matiere').addEventListener('click', () => toggleModal('edit-matiere-modal', false));
  setupModalClose('edit-matiere-modal', 'close-edit-matiere-modal');
  document.getElementById('edit-matiere-form').addEventListener('submit', handleEditMatiere);

  // Copy invite link
  document.getElementById('copy-invite-link').addEventListener('click', async () => {
    const input = document.getElementById('invite-link-input');
    try {
      await navigator.clipboard.writeText(input.value);
      await showAlert('Lien copié dans le presse-papiers !', 'Succès');
    } catch (e) {
      input.select();
      document.execCommand('copy');
      await showAlert('Lien copié !', 'Succès');
    }
  });

  // Settings forms
  document.getElementById('password-form').addEventListener('submit', handleChangePassword);
  document.getElementById('emploi-temps-form').addEventListener('submit', handleSaveEmploiTemps);
  document.getElementById('discord-webhook-form').addEventListener('submit', handleSaveDiscordWebhook);
}

// ==== ELEVES ====

async function loadEleves() {
  const data = await apiCall('/api/admin/eleves');
  if (!data.error) {
    eleves = data;
    renderEleves();
  }
}

function renderEleves() {
  const list = document.getElementById('eleves-list');
  if (eleves.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucun élève pour le moment.</p>';
    return;
  }

  list.innerHTML = eleves.map(eleve => `
    <div class="list-item">
      <div class="list-item-info">
        <div>
          <h3>${escapeHTML(eleve.prenom || '')} ${escapeHTML(eleve.nom || '')}</h3>
          <p>${escapeHTML(eleve.username)}</p>
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary edit-eleve-btn" data-id="${eleve.id}">Modifier</button>
        <button class="btn-danger delete-eleve-btn" data-id="${eleve.id}">Supprimer</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.edit-eleve-btn').forEach(btn => {
    btn.addEventListener('click', () => prepareEditEleve(parseInt(btn.dataset.id)));
  });

  list.querySelectorAll('.delete-eleve-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteEleve(parseInt(btn.dataset.id)));
  });
}

async function handleAddEleve(e) {
  e.preventDefault();
  const email = document.getElementById('eleve-email').value;

  const data = await apiCall('/api/invitations/create', {
    method: 'POST',
    body: JSON.stringify({ email, role: 'eleve' })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    toggleModal('add-eleve-modal', false);
    await showAlert('Invitation envoyée à ' + email, 'Succès');
    document.getElementById('add-eleve-form').reset();
    await loadEleves();
    await loadInvitations();
  }
}

function prepareEditEleve(id) {
  const eleve = eleves.find(e => e.id === id);
  if (!eleve) return;

  document.getElementById('edit-eleve-id').value = eleve.id;
  document.getElementById('edit-eleve-username').value = eleve.username;
  document.getElementById('edit-eleve-email').value = eleve.email || '';
  document.getElementById('edit-eleve-nom').value = eleve.nom || '';
  document.getElementById('edit-eleve-prenom').value = eleve.prenom || '';
  document.getElementById('edit-eleve-password').value = '';

  toggleModal('edit-eleve-modal', true);
}

async function handleEditEleve(e) {
  e.preventDefault();
  const id = document.getElementById('edit-eleve-id').value;

  const data = await apiCall(`/api/admin/eleves/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      username: document.getElementById('edit-eleve-username').value,
      email: document.getElementById('edit-eleve-email').value,
      nom: document.getElementById('edit-eleve-nom').value,
      prenom: document.getElementById('edit-eleve-prenom').value,
      password: document.getElementById('edit-eleve-password').value || undefined
    })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    toggleModal('edit-eleve-modal', false);
    await showAlert('Modifications enregistrées', 'Succès');
    await loadEleves();
  }
}

async function handleDeleteEleve(id) {
  const confirmed = await showConfirm('Êtes-vous sûr de vouloir supprimer cet élève ?', 'Confirmation');
  if (!confirmed) return;
  await apiCall(`/api/admin/eleves/${id}`, { method: 'DELETE' });
  await loadEleves();
}

// ==== MATIERES ====

async function loadMatieres() {
  const data = await apiCall('/api/admin/matieres');
  if (!data.error) {
    matieres = data;
    renderMatieres();
  }
}

function renderMatieres() {
  const list = document.getElementById('matieres-list');
  if (matieres.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucune matière pour le moment.</p>';
    return;
  }

  list.innerHTML = matieres.map(m => `
    <div class="list-item">
      <div class="list-item-info">
        <div style="width:40px;height:40px;border-radius:8px;background:${m.couleur || '#999'};flex-shrink:0;"></div>
        <div>
          <h3>${escapeHTML(m.nom)}</h3>
          ${m.lien ? `<p><a href="${m.lien}" target="_blank">Lien</a></p>` : ''}
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary edit-matiere-btn" data-id="${m.id}">Modifier</button>
        <button class="btn-danger delete-matiere-btn" data-id="${m.id}">Supprimer</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.edit-matiere-btn').forEach(btn => {
    btn.addEventListener('click', () => prepareEditMatiere(parseInt(btn.dataset.id)));
  });

  list.querySelectorAll('.delete-matiere-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm('Supprimer cette matière ?', 'Confirmation');
      if (!confirmed) return;
      await apiCall(`/api/admin/matieres/${btn.dataset.id}`, { method: 'DELETE' });
      await loadMatieres();
    });
  });
}

async function handleAddMatiere(e) {
  e.preventDefault();
  const data = await apiCall('/api/admin/matieres', {
    method: 'POST',
    body: JSON.stringify({
      nom: document.getElementById('add-matiere-nom').value,
      lien: document.getElementById('add-matiere-lien').value,
      couleur: document.getElementById('add-matiere-couleur').value
    })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    toggleModal('add-matiere-modal', false);
    document.getElementById('add-matiere-form').reset();
    await loadMatieres();
  }
}

function prepareEditMatiere(id) {
  const matiere = matieres.find(m => m.id === id);
  if (!matiere) return;

  document.getElementById('edit-matiere-id').value = matiere.id;
  document.getElementById('edit-matiere-nom').value = matiere.nom;
  document.getElementById('edit-matiere-lien').value = matiere.lien || '';
  document.getElementById('edit-matiere-couleur').value = matiere.couleur || '#4a90e2';
  toggleModal('edit-matiere-modal', true);
}

async function handleEditMatiere(e) {
  e.preventDefault();
  const id = document.getElementById('edit-matiere-id').value;

  const data = await apiCall(`/api/admin/matieres/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      nom: document.getElementById('edit-matiere-nom').value,
      lien: document.getElementById('edit-matiere-lien').value,
      couleur: document.getElementById('edit-matiere-couleur').value
    })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    toggleModal('edit-matiere-modal', false);
    await loadMatieres();
  }
}

// ==== DEMANDES D'ADHESION ====

async function loadJoinRequests() {
  const data = await apiCall('/api/admin/join-requests');
  if (Array.isArray(data)) {
    joinRequests = data;
    renderJoinRequests();
    
    // Update badge
    const badge = document.getElementById('pending-badge');
    if (joinRequests.length > 0) {
      badge.textContent = joinRequests.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

function renderJoinRequests() {
  const list = document.getElementById('join-requests-list');

  if (joinRequests.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucune demande en attente.</p>';
    return;
  }

  list.innerHTML = joinRequests.map(req => `
    <div class="list-item">
      <div class="list-item-info">
        <div>
          <h3>${escapeHTML(req.prenom || '')} ${escapeHTML(req.nom || '')}</h3>
          <p>${escapeHTML(req.username)} ${req.email ? '- ' + escapeHTML(req.email) : ''}</p>
          <p style="font-size: 0.8rem; color: var(--secondary);">Demande le ${formatDate(req.created_at)}</p>
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-primary accept-request-btn" data-id="${req.id}">Accepter</button>
        <button class="btn-danger reject-request-btn" data-id="${req.id}">Refuser</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.accept-request-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const data = await apiCall(`/api/admin/join-requests/${btn.dataset.id}/accept`, { method: 'POST' });
      if (data.error) {
        await showAlert(data.error, 'Erreur');
      } else {
        await showAlert('Demande acceptée', 'Succès');
        await loadJoinRequests();
        await loadEleves();
      }
    });
  const data = await apiCall('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });

  list.querySelectorAll('.reject-request-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm('Refuser cette demande ?', 'Confirmation');
      if (!confirmed) return;
      const data = await apiCall(`/api/admin/join-requests/${btn.dataset.id}/reject`, { method: 'POST' });
      if (data.error) {
        await showAlert(data.error, 'Erreur');
      } else {
        await loadJoinRequests();
      }
    });
  });
}

// ==== INVITATIONS ====

async function loadInvitations() {
  const data = await apiCall('/api/invitations/list');
  if (Array.isArray(data)) {
    invitations = data;
    renderInvitations();
  }
}

function renderInvitations() {
  const list = document.getElementById('invitations-list');

  if (invitations.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucune invitation en attente.</p>';
    return;
  }

  list.innerHTML = invitations.map(inv => `
    <div class="list-item">
      <div class="list-item-info">
        <div>
          <h3>${escapeHTML(inv.email)}</h3>
          <p style="font-size: 0.8rem; color: var(--secondary);">
            Envoyée le ${new Date(inv.created_at).toLocaleDateString('fr-FR')}
          </p>
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary resend-inv-btn" data-id="${inv.id}">Renvoyer</button>
        <button class="btn-danger delete-inv-btn" data-id="${inv.id}">Supprimer</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.resend-inv-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const data = await apiCall(`/api/invitations/resend/${btn.dataset.id}`, { method: 'POST' });
      if (data.success) {
        await showAlert(data.message, 'Succès');
      } else if (data.error) {
        await showAlert(data.error, 'Erreur');
      }
    });
  });

  list.querySelectorAll('.delete-inv-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm('Supprimer cette invitation ?', 'Confirmation');
      if (!confirmed) return;
      await apiCall(`/api/invitations/${btn.dataset.id}`, { method: 'DELETE' });
      await loadInvitations();
    });
  });
}

// ==== LOGS ====

async function loadLogs() {
  const data = await apiCall('/api/admin/logs/devoirs');
  if (!data.error) {
    logs = data;
    renderLogs();
  }
}

function renderLogs() {
  const list = document.getElementById('logs-list');
  if (logs.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucun log.</p>';
    return;
  }

  list.innerHTML = logs.map(log => {
    let actionText = log.action;
    let actionClass = '';

    switch (log.action) {
      case 'create': actionText = 'a créé'; actionClass = 'log-create'; break;
      case 'update': actionText = 'a modifié'; actionClass = 'log-update'; break;
      case 'delete': actionText = 'a supprimé'; actionClass = 'log-delete'; break;
      case 'upload_pdf': actionText = 'a ajouté un document'; actionClass = 'log-create'; break;
      case 'delete_pdf': actionText = 'a supprimé un document'; actionClass = 'log-delete'; break;
    }

    let details = '';
    try {
      const d = JSON.parse(log.details);
      details = d.titre || d.filename || '';
    } catch (e) {}

    const date = new Date(log.created_at).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    return `
      <div class="list-item">
        <div class="list-item-info">
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
              <span class="log-badge ${actionClass}">${actionText}</span>
              <span style="color:var(--secondary);font-size:0.85rem;">${date}</span>
            </div>
            <p><strong>${escapeHTML(log.username)}</strong> ${actionText} <strong>${escapeHTML(details)}</strong></p>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ==== SETTINGS ====

async function loadSettings() {
  const [emploi, webhook] = await Promise.all([
    apiCall('/api/admin/settings/emploi-temps'),
    apiCall('/api/admin/settings/discord-webhook')
  ]);

  if (!emploi.error) {
    document.getElementById('emploi-temps-lien').value = emploi.lien || '';
  }
  if (!webhook.error) {
    document.getElementById('discord-webhook-url').value = webhook.webhook || '';
  }
}

async function loadInviteLink() {
  const data = await apiCall('/api/admin/invite-link');
  const input = document.getElementById('invite-link-input');
  if (data.link) {
    input.value = data.link;
  } else {
    input.value = data.message || 'Lien non disponible';
  }
}

async function handleChangePassword(e) {
  e.preventDefault();
  const oldPw = document.getElementById('old-password').value;
  const newPw = document.getElementById('new-password').value;
  const confirmPw = document.getElementById('confirm-password').value;

  if (newPw !== confirmPw) {
    await showAlert('Les mots de passe ne correspondent pas', 'Erreur');
    return;
  }

  const data = await apiCall('/api/admin/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    await showAlert('Mot de passe modifié', 'Succès');
    document.getElementById('password-form').reset();
  }
}

async function handleSaveEmploiTemps(e) {
  e.preventDefault();
  const data = await apiCall('/api/admin/settings/emploi-temps', {
    method: 'POST',
    body: JSON.stringify({ lien: document.getElementById('emploi-temps-lien').value })
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
  if (webhook && !webhook.match(/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/.+/)) {
    await showAlert('URL de webhook Discord invalide', 'Erreur');
    return;
  }
  const data = await apiCall('/api/admin/settings/discord-webhook', {
    method: 'POST',
    body: JSON.stringify({ webhook })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    await showAlert('Webhook enregistré', 'Succès');
  }
}

init();
