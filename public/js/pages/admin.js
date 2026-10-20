import { apiCall, checkAuth, logout } from '../utils/api.js';
import { escapeHTML, formatDate, toggleModal, setupModalClose, showAlert, showConfirm } from '../utils/dom.js';

let currentUserId = null;
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

  currentUserId = auth.userId;

  document.getElementById('user-info').textContent = auth.username;

  loadThemePreference();

  await loadAllData();
  setupEventListeners();
  setupUserMenu();
}

// Le thème lui-même est déjà appliqué par /js/theme-init.js avant le premier rendu,
// il ne reste qu'à synchroniser le bouton du menu.
function loadThemePreference() {
  updateThemeButton(document.documentElement.classList.contains('dark-theme'));
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark-theme');
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
    loadInviteLink(),
    loadClasse()
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
  document.getElementById('rename-classe-form').addEventListener('submit', handleRenameClasse);
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

function formatLastLogin(dateString) {
  if (!dateString) return 'Jamais connecté';
  const date = new Date(dateString);
  return `Dernière connexion : ${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderEleves() {
  const list = document.getElementById('eleves-list');
  if (eleves.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucun élève pour le moment.</p>';
    return;
  }

  list.innerHTML = eleves.map(eleve => {
    const isAdmin = eleve.role === 'admin';
    return `
    <div class="list-item">
      <div class="list-item-info">
        <div>
          <h3>${escapeHTML(eleve.prenom || '')} ${escapeHTML(eleve.nom || '')}${isAdmin ? ' <span class="role-badge role-admin">Admin</span>' : ''}</h3>
          <p>${escapeHTML(eleve.username)}</p>
          <p class="list-item-meta">${formatLastLogin(eleve.last_login_at)}</p>
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary toggle-admin-btn" data-id="${eleve.id}" data-admin="${isAdmin ? '1' : '0'}">${isAdmin ? 'Retirer admin' : 'Promouvoir admin'}</button>
        <button class="btn-secondary edit-eleve-btn" data-id="${eleve.id}">Modifier</button>
        <button class="btn-danger delete-eleve-btn" data-id="${eleve.id}">Supprimer</button>
      </div>
    </div>
  `;
  }).join('');

  list.querySelectorAll('.toggle-admin-btn').forEach(btn => {
    btn.addEventListener('click', () => handleToggleAdmin(parseInt(btn.dataset.id), btn.dataset.admin !== '1'));
  });

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

async function handleToggleAdmin(id, makeAdmin) {
  const eleve = eleves.find(e => e.id === id);
  if (!eleve) return;

  const nom = `${eleve.prenom || ''} ${eleve.nom || ''}`.trim() || eleve.username;
  let message;
  if (makeAdmin) {
    message = `Accorder le statut administrateur à ${nom} ?`;
  } else if (id === currentUserId) {
    message = 'Retirer votre propre statut administrateur ? Vous perdrez immédiatement l\'accès à cette page.';
  } else {
    message = `Retirer le statut administrateur de ${nom} ?`;
  }

  const confirmed = await showConfirm(message, 'Confirmation');
  if (!confirmed) return;

  const data = await apiCall(`/api/admin/eleves/${id}/admin`, {
    method: 'PUT',
    body: JSON.stringify({ admin: makeAdmin })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
    return;
  }

  if (!makeAdmin && id === currentUserId) {
    window.location.href = '/dashboard';
    return;
  }

  await loadEleves();
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

// Actions journalisées : libellé du badge, style et formulation de la phrase
const LOG_ACTIONS = {
  create: { badge: 'création', badgeClass: 'log-create', verbe: 'a créé', cible: 'devoir' },
  update: { badge: 'modification', badgeClass: 'log-update', verbe: 'a modifié', cible: 'devoir' },
  delete: { badge: 'suppression', badgeClass: 'log-delete', verbe: 'a supprimé', cible: 'devoir' },
  upload_pdf: { badge: 'document ajouté', badgeClass: 'log-create', verbe: 'a ajouté', cible: 'fichier', preposition: 'au devoir' },
  delete_pdf: { badge: 'document supprimé', badgeClass: 'log-delete', verbe: 'a supprimé', cible: 'fichier', preposition: 'du devoir' },
  delete_commentaire: { badge: 'commentaire supprimé', badgeClass: 'log-delete', verbe: 'a supprimé', cible: 'commentaire', preposition: 'sous le devoir' }
};

// Champs du devoir suivis dans l'historique, dans l'ordre d'affichage
const LOG_FIELDS = [
  { field: 'titre', label: 'Titre' },
  { field: 'description', label: 'Description' },
  { field: 'matiere_id', label: 'Matière' },
  { field: 'date', label: 'Pour le' }
];

const LOG_FIELD_LABELS = Object.fromEntries(LOG_FIELDS.map(({ field, label }) => [field, label]));

const LOG_EMPTY_VALUE = '<em class="log-empty">vide</em>';

async function loadLogs() {
  const data = await apiCall('/api/admin/logs/devoirs');
  if (!data.error) {
    logs = data;
    renderLogs();
  }
}

function formatLogDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Taille de fichier lisible (o, Ko, Mo, Go)
 * @param {number} size - Taille en octets
 * @returns {string|null} Null si la taille n'a pas été enregistrée
 */
function formatFileSize(size) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;

  const units = ['o', 'Ko', 'Mo', 'Go'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString('fr-FR')} ${units[unit]}`;
}

/**
 * Nom affichable de l'auteur d'une action : nom complet si connu, sinon username
 */
function formatLogAuthor(log, details) {
  const author = details.author || {};
  const nomComplet = [author.prenom || log.user_prenom, author.nom || log.user_nom].filter(Boolean).join(' ');

  if (!log.username) return nomComplet || 'Utilisateur supprimé';
  return nomComplet ? `${nomComplet} (${log.username})` : log.username;
}

/**
 * Met en forme la valeur d'un champ de devoir, prête à être insérée dans le HTML
 * @param {string} field - Nom du champ
 * @param {*} value - Valeur brute enregistrée
 * @param {string} [matiereNom] - Nom de la matière, utilisé pour le champ matiere_id
 * @returns {string} HTML échappé
 */
function formatLogFieldValue(field, value, matiereNom) {
  if (field === 'matiere_id') {
    const nom = matiereNom || (value ? `Matière n° ${value}` : null);
    return nom ? escapeHTML(nom) : LOG_EMPTY_VALUE;
  }

  if (field === 'date') {
    return value ? escapeHTML(formatDate(value)) : LOG_EMPTY_VALUE;
  }

  if (value === null || value === undefined || value === '') return LOG_EMPTY_VALUE;
  return escapeHTML(String(value));
}

/**
 * Lit les détails d'un log et les ramène au format courant.
 *
 * Les logs écrits avant la version 2 stockaient moins d'informations : on en
 * reconstruit le maximum, mais le nom des matières n'y figurait pas.
 *
 * @param {Object} log - Ligne de devoir_logs
 * @returns {Object} Détails normalisés
 */
function normalizeLogDetails(log) {
  let details;
  try {
    details = JSON.parse(log.details) || {};
  } catch (e) {
    details = {};
  }

  if (details.version >= 2) return details;

  // Modification, ancien format : { old: {...}, new: {...} }
  if (details.old && details.new) {
    return {
      titre: details.new.titre,
      changes: LOG_FIELDS
        .map(({ field, label }) => ({ field, label, before: details.old[field], after: details.new[field] }))
        .filter(({ field, before, after }) => formatLogFieldValue(field, before) !== formatLogFieldValue(field, after))
    };
  }

  // Ajout ou suppression de document, ancien format : { filename, size }
  if (details.filename) {
    return {
      titre: log.devoir_titre,
      fichier: { original_name: details.filename, size: details.size }
    };
  }

  // Création ou suppression de devoir, ancien format : champs stockés à plat
  if (details.titre) {
    return { titre: details.titre, devoir: details };
  }

  return {};
}

function renderLogDetailRow(label, valueHTML) {
  return `
    <div class="log-detail">
      <span class="log-detail-label">${escapeHTML(label)}</span>
      <span class="log-detail-value">${valueHTML}</span>
    </div>`;
}

/**
 * Construit le bloc de détails d'un log : champs modifiés, état du devoir,
 * caractéristiques du document concerné.
 */
function renderLogDetails(details) {
  const rows = [];

  // Modification : une ligne par champ modifié, avant → après
  if (details.changes) {
    details.changes.forEach(change => {
      const before = formatLogFieldValue(change.field, change.before, change.before_label);
      const after = formatLogFieldValue(change.field, change.after, change.after_label);
      rows.push(renderLogDetailRow(
        change.label || LOG_FIELD_LABELS[change.field] || change.field,
        `<span class="log-value log-value-before">${before}</span>
         <span class="log-arrow">→</span>
         <span class="log-value log-value-after">${after}</span>`
      ));
    });
  }

  // Création ou suppression : état complet du devoir
  if (details.devoir) {
    LOG_FIELDS.forEach(({ field, label }) => {
      const value = formatLogFieldValue(field, details.devoir[field], details.devoir.matiere_nom);
      rows.push(renderLogDetailRow(label, `<span class="log-value">${value}</span>`));
    });
  }

  // Document ajouté ou supprimé
  const fichier = details.fichier;
  if (fichier) {
    const taille = formatFileSize(fichier.size);
    if (taille) {
      rows.push(renderLogDetailRow('Taille', `<span class="log-value">${escapeHTML(taille)}</span>`));
    }
    if (fichier.mimetype) {
      rows.push(renderLogDetailRow('Type', `<span class="log-value">${escapeHTML(fichier.mimetype)}</span>`));
    }
    if (fichier.uploaded_by_username) {
      rows.push(renderLogDetailRow('Ajouté par', `<span class="log-value">${escapeHTML(fichier.uploaded_by_username)}</span>`));
    }
    if (fichier.uploaded_at) {
      rows.push(renderLogDetailRow('Ajouté le', `<span class="log-value">${escapeHTML(formatLogDateTime(fichier.uploaded_at))}</span>`));
    }
  }

  // Commentaire supprimé : son texte et sa date
  const commentaire = details.commentaire;
  if (commentaire) {
    rows.push(renderLogDetailRow('Message', `<span class="log-value">${formatLogFieldValue('contenu', commentaire.contenu)}</span>`));
    if (commentaire.created_at) {
      rows.push(renderLogDetailRow('Écrit le', `<span class="log-value">${escapeHTML(formatLogDateTime(commentaire.created_at))}</span>`));
    }
  }

  // Suppression d'un devoir : documents joints perdus au passage
  if (details.fichiers && details.fichiers.length > 0) {
    const items = details.fichiers.map(f => {
      const auteur = f.uploaded_by_username ? `ajouté par ${f.uploaded_by_username}` : null;
      const ajoutLe = f.uploaded_at ? `le ${formatLogDateTime(f.uploaded_at)}` : null;
      const origine = [auteur, ajoutLe].filter(Boolean).join(' ');
      const taille = formatFileSize(f.size);
      const complement = [origine || null, taille].filter(Boolean).join(', ');
      return `<li>${escapeHTML(f.original_name || 'Document sans nom')}${complement ? ` <span class="log-empty">(${escapeHTML(complement)})</span>` : ''}</li>`;
    }).join('');

    rows.push(renderLogDetailRow(
      `Documents joints (${details.fichiers.length})`,
      `<ul class="log-file-list">${items}</ul>`
    ));
  }

  if (rows.length === 0) return '';
  return `<div class="log-details">${rows.join('')}</div>`;
}

/**
 * Phrase résumant l'action, avec l'auteur, le devoir et le document concernés
 */
function renderLogSummary(log, config, details) {
  const auteur = `<strong>${escapeHTML(formatLogAuthor(log, details))}</strong>`;
  const titre = details.titre || log.devoir_titre;
  const devoir = titre ? `<strong>« ${escapeHTML(titre)} »</strong>` : null;

  if (config.cible === 'fichier') {
    const nom = details.fichier?.original_name;
    const document = nom ? `<strong>« ${escapeHTML(nom)} »</strong>` : 'un document';
    const rattachement = devoir ? ` ${config.preposition} ${devoir}` : '';
    return `${auteur} ${config.verbe} le document ${document}${rattachement}`;
  }

  if (config.cible === 'commentaire') {
    const a = details.commentaire?.auteur || {};
    const nomComplet = [a.prenom, a.nom].filter(Boolean).join(' ');
    const ecritPar = a.username ? ` de <strong>${escapeHTML(nomComplet ? `${nomComplet} (${a.username})` : a.username)}</strong>` : '';
    const rattachement = devoir ? ` ${config.preposition} ${devoir}` : '';
    return `${auteur} ${config.verbe} un commentaire${ecritPar}${rattachement}`;
  }

  return devoir
    ? `${auteur} ${config.verbe} le devoir ${devoir}`
    : `${auteur} ${config.verbe} un devoir`;
}

/**
 * Référence du devoir concerné : lien ouvrant le devoir dans le dashboard tant
 * qu'il existe, sinon mention signalant qu'il a été supprimé depuis.
 */
function renderLogDevoirReference(log) {
  if (!log.devoir_id) return '';

  const numero = `devoir n° ${escapeHTML(String(log.devoir_id))}`;

  if (log.devoir_existe) {
    return `<a class="log-link" href="/dashboard?devoir=${encodeURIComponent(log.devoir_id)}">${numero}</a>`;
  }

  // Le badge indique déjà la suppression du devoir : ne pas la répéter
  const supprimeDepuis = log.action === 'delete' ? '' : ' (supprimé depuis)';
  return `<span class="log-note">${numero}${supprimeDepuis}</span>`;
}

function renderLogItem(log) {
  const config = LOG_ACTIONS[log.action] || { badge: log.action, badgeClass: '', verbe: log.action, cible: 'devoir' };
  const details = normalizeLogDetails(log);

  // Référence du devoir : lien vers le dashboard tant qu'il existe (même lien que
  // le bouton « Exporter / Partager »), simple mention sinon
  const reference = renderLogDevoirReference(log);

  return `
    <div class="list-item log-item">
      <div class="log-header">
        <span class="log-badge ${config.badgeClass}">${escapeHTML(config.badge)}</span>
        <span class="log-date">${escapeHTML(formatLogDateTime(log.created_at))}</span>
        ${reference}
      </div>
      <p class="log-summary">${renderLogSummary(log, config, details)}</p>
      ${renderLogDetails(details)}
    </div>`;
}

function renderLogs() {
  const list = document.getElementById('logs-list');

  if (logs.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucun log.</p>';
    return;
  }

  list.innerHTML = logs.map(renderLogItem).join('');
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

async function loadClasse() {
  const data = await apiCall('/api/admin/classe');
  if (!data.error) {
    document.getElementById('classe-nom').value = data.nom || '';
  }
}

async function handleRenameClasse(e) {
  e.preventDefault();
  const nom = document.getElementById('classe-nom').value;

  const data = await apiCall('/api/admin/classe', {
    method: 'PUT',
    body: JSON.stringify({ nom })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    await showAlert('Classe renommée avec succès', 'Succès');
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
