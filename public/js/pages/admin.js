import { apiCall, checkAuth } from '../utils/api.js';
import { mountHeader, setHeaderUser } from '../components/header.js';
import { escapeHtml, formatDate, toggleModal, setupModalClose, showAlert, showConfirm } from '../utils/dom.js';

let currentUserId = null;
let students = [];
let subjects = [];
let invitations = [];
let logs = [];
let joinRequests = [];

async function init() {
  mountHeader({ page: 'admin', title: 'Admin' });

  const auth = await checkAuth();

  if (!auth.authenticated || !auth.is_admin) {
    window.location.href = '/dashboard';
    return;
  }

  currentUserId = auth.userId;

  setHeaderUser(auth);

  await loadAllData();
  setupEventListeners();
}

async function loadAllData() {
  await Promise.all([
    loadStudents(),
    loadSubjects(),
    loadJoinRequests(),
    loadInvitations(),
    loadLogs(),
    loadSettings(),
    loadInviteLink(),
    loadClass()
  ]);
}

function setupEventListeners() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  document.getElementById('add-student-btn').addEventListener('click', () => toggleModal('add-student-modal', true));
  document.getElementById('cancel-add-student').addEventListener('click', () => toggleModal('add-student-modal', false));
  setupModalClose('add-student-modal', 'close-add-student-modal');
  document.getElementById('add-student-form').addEventListener('submit', handleAddStudent);

  document.getElementById('cancel-edit-student').addEventListener('click', () => toggleModal('edit-student-modal', false));
  setupModalClose('edit-student-modal', 'close-edit-student-modal');
  document.getElementById('edit-student-form').addEventListener('submit', handleEditStudent);

  document.getElementById('add-subject-btn').addEventListener('click', () => toggleModal('add-subject-modal', true));
  document.getElementById('cancel-add-subject').addEventListener('click', () => toggleModal('add-subject-modal', false));
  setupModalClose('add-subject-modal', 'close-add-subject-modal');
  document.getElementById('add-subject-form').addEventListener('submit', handleAddSubject);

  document.getElementById('cancel-edit-subject').addEventListener('click', () => toggleModal('edit-subject-modal', false));
  setupModalClose('edit-subject-modal', 'close-edit-subject-modal');
  document.getElementById('edit-subject-form').addEventListener('submit', handleEditSubject);

  document.getElementById('copy-invite-link').addEventListener('click', async () => {
    const input = document.getElementById('invite-link-input');
    try {
      await navigator.clipboard.writeText(input.value);
      await showAlert('Lien copié dans le presse-papiers !', 'Succès');
    } catch {
      input.select();
      document.execCommand('copy');
      await showAlert('Lien copié !', 'Succès');
    }
  });

  document.getElementById('rename-class-form').addEventListener('submit', handleRenameClass);
  document.getElementById('timetable-form').addEventListener('submit', handleSaveTimetableLink);
  document.getElementById('timetable-ics-form').addEventListener('submit', handleSaveTimetableIcs);
  document.getElementById('discord-webhook-form').addEventListener('submit', handleSaveDiscordWebhook);
}


async function loadStudents() {
  const data = await apiCall('/api/admin/eleves');
  if (!data.error) {
    students = data;
    renderStudents();
  }
}

function formatLastLogin(dateString) {
  if (!dateString) return 'Jamais connecté';
  const date = new Date(dateString);
  return `Dernière connexion : ${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderStudents() {
  const list = document.getElementById('students-list');
  if (students.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucun élève pour le moment.</p>';
    return;
  }

  list.innerHTML = students.map(student => {
    const isAdmin = student.role === 'admin';
    return `
    <div class="list-item">
      <div class="list-item-info">
        <div>
          <h3>${escapeHtml(student.prenom || '')} ${escapeHtml(student.nom || '')}${isAdmin ? ' <span class="role-badge role-admin">Admin</span>' : ''}</h3>
          <p>${escapeHtml(student.username)}</p>
          <p class="list-item-meta">${formatLastLogin(student.last_login_at)}</p>
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary toggle-admin-btn" data-id="${student.id}" data-admin="${isAdmin ? '1' : '0'}">${isAdmin ? 'Retirer admin' : 'Promouvoir admin'}</button>
        <button class="btn-secondary edit-student-btn" data-id="${student.id}">Modifier</button>
        <button class="btn-danger delete-student-btn" data-id="${student.id}">Supprimer</button>
      </div>
    </div>
  `;
  }).join('');

  list.querySelectorAll('.toggle-admin-btn').forEach(btn => {
    btn.addEventListener('click', () => handleToggleAdmin(parseInt(btn.dataset.id), btn.dataset.admin !== '1'));
  });

  list.querySelectorAll('.edit-student-btn').forEach(btn => {
    btn.addEventListener('click', () => prepareEditStudent(parseInt(btn.dataset.id)));
  });

  list.querySelectorAll('.delete-student-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteStudent(parseInt(btn.dataset.id)));
  });
}

async function handleAddStudent(e) {
  e.preventDefault();
  const email = document.getElementById('student-email').value;

  const data = await apiCall('/api/invitations/create', {
    method: 'POST',
    body: JSON.stringify({ email, role: 'eleve' })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    toggleModal('add-student-modal', false);
    await showAlert('Invitation envoyée à ' + email, 'Succès');
    document.getElementById('add-student-form').reset();
    await loadStudents();
    await loadInvitations();
  }
}

function prepareEditStudent(id) {
  const student = students.find(e => e.id === id);
  if (!student) return;

  document.getElementById('edit-student-id').value = student.id;
  document.getElementById('edit-student-username').value = student.username;
  document.getElementById('edit-student-email').value = student.email || '';
  document.getElementById('edit-student-last-name').value = student.nom || '';
  document.getElementById('edit-student-first-name').value = student.prenom || '';
  document.getElementById('edit-student-password').value = '';

  toggleModal('edit-student-modal', true);
}

async function handleEditStudent(e) {
  e.preventDefault();
  const id = document.getElementById('edit-student-id').value;

  const data = await apiCall(`/api/admin/eleves/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      username: document.getElementById('edit-student-username').value,
      email: document.getElementById('edit-student-email').value,
      nom: document.getElementById('edit-student-last-name').value,
      prenom: document.getElementById('edit-student-first-name').value,
      password: document.getElementById('edit-student-password').value || undefined
    })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    toggleModal('edit-student-modal', false);
    await showAlert('Modifications enregistrées', 'Succès');
    await loadStudents();
  }
}

async function handleToggleAdmin(id, makeAdmin) {
  const student = students.find(e => e.id === id);
  if (!student) return;

  const displayName = `${student.prenom || ''} ${student.nom || ''}`.trim() || student.username;
  let message;
  if (makeAdmin) {
    message = `Accorder le statut administrateur à ${displayName} ?`;
  } else if (id === currentUserId) {
    message = 'Retirer votre propre statut administrateur ? Vous perdrez immédiatement l\'accès à cette page.';
  } else {
    message = `Retirer le statut administrateur de ${displayName} ?`;
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

  await loadStudents();
}

async function handleDeleteStudent(id) {
  const confirmed = await showConfirm('Êtes-vous sûr de vouloir supprimer cet élève ?', 'Confirmation');
  if (!confirmed) return;
  await apiCall(`/api/admin/eleves/${id}`, { method: 'DELETE' });
  await loadStudents();
}


async function loadSubjects() {
  const data = await apiCall('/api/admin/matieres');
  if (!data.error) {
    subjects = data;
    renderSubjects();
  }
}

function renderSubjects() {
  const list = document.getElementById('subjects-list');
  if (subjects.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucune matière pour le moment.</p>';
    return;
  }

  list.innerHTML = subjects.map(m => `
    <div class="list-item">
      <div class="list-item-info">
        <div style="width:40px;height:40px;border-radius:8px;background:${m.couleur || '#999'};flex-shrink:0;"></div>
        <div>
          <h3>${escapeHtml(m.nom)}</h3>
          ${m.lien ? `<p><a href="${m.lien}" target="_blank">Lien</a></p>` : ''}
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary edit-subject-btn" data-id="${m.id}">Modifier</button>
        <button class="btn-danger delete-subject-btn" data-id="${m.id}">Supprimer</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.edit-subject-btn').forEach(btn => {
    btn.addEventListener('click', () => prepareEditSubject(parseInt(btn.dataset.id)));
  });

  list.querySelectorAll('.delete-subject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm('Supprimer cette matière ?', 'Confirmation');
      if (!confirmed) return;
      await apiCall(`/api/admin/matieres/${btn.dataset.id}`, { method: 'DELETE' });
      await loadSubjects();
    });
  });
}

async function handleAddSubject(e) {
  e.preventDefault();
  const data = await apiCall('/api/admin/matieres', {
    method: 'POST',
    body: JSON.stringify({
      nom: document.getElementById('add-subject-name').value,
      lien: document.getElementById('add-subject-link').value,
      couleur: document.getElementById('add-subject-color').value
    })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    toggleModal('add-subject-modal', false);
    document.getElementById('add-subject-form').reset();
    await loadSubjects();
  }
}

function prepareEditSubject(id) {
  const subject = subjects.find(m => m.id === id);
  if (!subject) return;

  document.getElementById('edit-subject-id').value = subject.id;
  document.getElementById('edit-subject-name').value = subject.nom;
  document.getElementById('edit-subject-link').value = subject.lien || '';
  document.getElementById('edit-subject-color').value = subject.couleur || '#4a90e2';
  toggleModal('edit-subject-modal', true);
}

async function handleEditSubject(e) {
  e.preventDefault();
  const id = document.getElementById('edit-subject-id').value;

  const data = await apiCall(`/api/admin/matieres/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      nom: document.getElementById('edit-subject-name').value,
      lien: document.getElementById('edit-subject-link').value,
      couleur: document.getElementById('edit-subject-color').value
    })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    toggleModal('edit-subject-modal', false);
    await loadSubjects();
  }
}


async function loadJoinRequests() {
  const data = await apiCall('/api/admin/join-requests');
  if (Array.isArray(data)) {
    joinRequests = data;
    renderJoinRequests();
    
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
          <h3>${escapeHtml(req.prenom || '')} ${escapeHtml(req.nom || '')}</h3>
          <p>${escapeHtml(req.username)} ${req.email ? '- ' + escapeHtml(req.email) : ''}</p>
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
        await loadStudents();
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
          <h3>${escapeHtml(inv.email)}</h3>
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


/**
 * Logged actions, keyed by the server's action code: badge label and style,
 * and wording of the summary sentence.
 */
const LOG_ACTIONS = {
  create: { badge: 'création', badgeClass: 'log-create', verb: 'a créé', target: 'assignment' },
  update: { badge: 'modification', badgeClass: 'log-update', verb: 'a modifié', target: 'assignment' },
  delete: { badge: 'suppression', badgeClass: 'log-delete', verb: 'a supprimé', target: 'assignment' },
  upload_pdf: { badge: 'document ajouté', badgeClass: 'log-create', verb: 'a ajouté', target: 'file', preposition: 'au devoir' },
  delete_pdf: { badge: 'document supprimé', badgeClass: 'log-delete', verb: 'a supprimé', target: 'file', preposition: 'du devoir' },
  delete_commentaire: { badge: 'commentaire supprimé', badgeClass: 'log-delete', verb: 'a supprimé', target: 'comment', preposition: 'sous le devoir' }
};

/** Assignment fields tracked in the history, in display order. */
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
 * Readable file size (o, Ko, Mo, Go).
 * @param {number} size - Size in bytes
 * @returns {string|null} Null when the size was not recorded
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

/** Display name of the author of an action: full name when known, otherwise username. */
function formatLogAuthor(log, details) {
  const author = details.author || {};
  const fullName = [author.prenom || log.user_prenom, author.nom || log.user_nom].filter(Boolean).join(' ');

  if (!log.username) return fullName || 'Utilisateur supprimé';
  return fullName ? `${fullName} (${log.username})` : log.username;
}

/**
 * Formats the value of an assignment field, ready to be inserted in the HTML.
 * @param {string} field - Field name
 * @param {*} value - Raw recorded value
 * @param {string} [subjectName] - Subject name, used for the matiere_id field
 * @returns {string} Escaped HTML
 */
function formatLogFieldValue(field, value, subjectName) {
  if (field === 'matiere_id') {
    const name = subjectName || (value ? `Matière n° ${value}` : null);
    return name ? escapeHtml(name) : LOG_EMPTY_VALUE;
  }

  if (field === 'date') {
    return value ? escapeHtml(formatDate(value)) : LOG_EMPTY_VALUE;
  }

  if (value === null || value === undefined || value === '') return LOG_EMPTY_VALUE;
  return escapeHtml(String(value));
}

/**
 * Reads the details of a log and brings them to the current format.
 *
 * Logs written before version 2 stored less information: as much as possible
 * is rebuilt, but subject names were not recorded. Old formats:
 * - update: `{ old: {...}, new: {...} }`
 * - file added or deleted: `{ filename, size }`
 * - assignment created or deleted: fields stored flat
 *
 * @param {Object} log - Row of devoir_logs
 * @returns {Object} Normalized details
 */
function normalizeLogDetails(log) {
  let details;
  try {
    details = JSON.parse(log.details) || {};
  } catch {
    details = {};
  }

  if (details.version >= 2) return details;

  if (details.old && details.new) {
    return {
      titre: details.new.titre,
      changes: LOG_FIELDS
        .map(({ field, label }) => ({ field, label, before: details.old[field], after: details.new[field] }))
        .filter(({ field, before, after }) => formatLogFieldValue(field, before) !== formatLogFieldValue(field, after))
    };
  }

  if (details.filename) {
    return {
      titre: log.devoir_titre,
      fichier: { original_name: details.filename, size: details.size }
    };
  }

  if (details.titre) {
    return { titre: details.titre, devoir: details };
  }

  return {};
}

function renderLogDetailRow(label, valueHtml) {
  return `
    <div class="log-detail">
      <span class="log-detail-label">${escapeHtml(label)}</span>
      <span class="log-detail-value">${valueHtml}</span>
    </div>`;
}

/**
 * Builds the details block of a log:
 * - update: one row per changed field, before → after;
 * - creation or deletion: the full state of the assignment;
 * - file added or deleted: its size, type and uploader;
 * - deleted comment: its text and date;
 * - deleted assignment: the attached files lost with it.
 */
function renderLogDetails(details) {
  const rows = [];

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

  if (details.devoir) {
    LOG_FIELDS.forEach(({ field, label }) => {
      const value = formatLogFieldValue(field, details.devoir[field], details.devoir.matiere_nom);
      rows.push(renderLogDetailRow(label, `<span class="log-value">${value}</span>`));
    });
  }

  const file = details.fichier;
  if (file) {
    const formattedSize = formatFileSize(file.size);
    if (formattedSize) {
      rows.push(renderLogDetailRow('Taille', `<span class="log-value">${escapeHtml(formattedSize)}</span>`));
    }
    if (file.mimetype) {
      rows.push(renderLogDetailRow('Type', `<span class="log-value">${escapeHtml(file.mimetype)}</span>`));
    }
    if (file.uploaded_by_username) {
      rows.push(renderLogDetailRow('Ajouté par', `<span class="log-value">${escapeHtml(file.uploaded_by_username)}</span>`));
    }
    if (file.uploaded_at) {
      rows.push(renderLogDetailRow('Ajouté le', `<span class="log-value">${escapeHtml(formatLogDateTime(file.uploaded_at))}</span>`));
    }
  }

  const comment = details.commentaire;
  if (comment) {
    rows.push(renderLogDetailRow('Message', `<span class="log-value">${formatLogFieldValue('contenu', comment.contenu)}</span>`));
    if (comment.created_at) {
      rows.push(renderLogDetailRow('Écrit le', `<span class="log-value">${escapeHtml(formatLogDateTime(comment.created_at))}</span>`));
    }
  }

  if (details.fichiers && details.fichiers.length > 0) {
    const items = details.fichiers.map(f => {
      const uploader = f.uploaded_by_username ? `ajouté par ${f.uploaded_by_username}` : null;
      const addedOn = f.uploaded_at ? `le ${formatLogDateTime(f.uploaded_at)}` : null;
      const origin = [uploader, addedOn].filter(Boolean).join(' ');
      const formattedSize = formatFileSize(f.size);
      const extra = [origin || null, formattedSize].filter(Boolean).join(', ');
      return `<li>${escapeHtml(f.original_name || 'Document sans nom')}${extra ? ` <span class="log-empty">(${escapeHtml(extra)})</span>` : ''}</li>`;
    }).join('');

    rows.push(renderLogDetailRow(
      `Documents joints (${details.fichiers.length})`,
      `<ul class="log-file-list">${items}</ul>`
    ));
  }

  if (rows.length === 0) return '';
  return `<div class="log-details">${rows.join('')}</div>`;
}

/** Sentence summing up the action, with the author, the assignment and the file involved. */
function renderLogSummary(log, config, details) {
  const author = `<strong>${escapeHtml(formatLogAuthor(log, details))}</strong>`;
  const title = details.titre || log.devoir_titre;
  const assignment = title ? `<strong>« ${escapeHtml(title)} »</strong>` : null;

  if (config.target === 'file') {
    const fileName = details.fichier?.original_name;
    const fileLabel = fileName ? `<strong>« ${escapeHtml(fileName)} »</strong>` : 'un document';
    const context = assignment ? ` ${config.preposition} ${assignment}` : '';
    return `${author} ${config.verb} le document ${fileLabel}${context}`;
  }

  if (config.target === 'comment') {
    const commentAuthor = details.commentaire?.auteur || {};
    const fullName = [commentAuthor.prenom, commentAuthor.nom].filter(Boolean).join(' ');
    const writtenBy = commentAuthor.username ? ` de <strong>${escapeHtml(fullName ? `${fullName} (${commentAuthor.username})` : commentAuthor.username)}</strong>` : '';
    const context = assignment ? ` ${config.preposition} ${assignment}` : '';
    return `${author} ${config.verb} un commentaire${writtenBy}${context}`;
  }

  return assignment
    ? `${author} ${config.verb} le devoir ${assignment}`
    : `${author} ${config.verb} un devoir`;
}

/**
 * Reference to the assignment involved: a link opening it in the dashboard (the
 * same link as the "Exporter / Partager" button) while it exists, otherwise a
 * note saying it was deleted since. A deleted assignment's own log already says
 * so in its badge, so the note is not repeated there.
 */
function renderLogAssignmentReference(log) {
  if (!log.devoir_id) return '';

  const reference = `devoir n° ${escapeHtml(String(log.devoir_id))}`;

  if (log.devoir_existe) {
    return `<a class="log-link" href="/dashboard?devoir=${encodeURIComponent(log.devoir_id)}">${reference}</a>`;
  }

  const deletedNote = log.action === 'delete' ? '' : ' (supprimé depuis)';
  return `<span class="log-note">${reference}${deletedNote}</span>`;
}

function renderLogItem(log) {
  const config = LOG_ACTIONS[log.action] || { badge: log.action, badgeClass: '', verb: log.action, target: 'assignment' };
  const details = normalizeLogDetails(log);

  const reference = renderLogAssignmentReference(log);

  return `
    <div class="list-item log-item">
      <div class="log-header">
        <span class="log-badge ${config.badgeClass}">${escapeHtml(config.badge)}</span>
        <span class="log-date">${escapeHtml(formatLogDateTime(log.created_at))}</span>
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


async function loadSettings() {
  const [timetableLink, ics, webhook] = await Promise.all([
    apiCall('/api/admin/settings/emploi-temps'),
    apiCall('/api/admin/settings/emploi-temps-ics'),
    apiCall('/api/admin/settings/discord-webhook')
  ]);

  if (!timetableLink.error) {
    document.getElementById('timetable-link').value = timetableLink.lien || '';
  }
  if (!ics.error) {
    document.getElementById('timetable-ics-link').value = ics.lien || '';
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

async function loadClass() {
  const data = await apiCall('/api/admin/classe');
  if (!data.error) {
    document.getElementById('class-name').value = data.nom || '';
  }
}

async function handleRenameClass(e) {
  e.preventDefault();
  const name = document.getElementById('class-name').value;

  const data = await apiCall('/api/admin/classe', {
    method: 'PUT',
    body: JSON.stringify({ nom: name })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    await showAlert('Classe renommée avec succès', 'Succès');
  }
}

async function handleSaveTimetableLink(e) {
  e.preventDefault();
  const data = await apiCall('/api/admin/settings/emploi-temps', {
    method: 'POST',
    body: JSON.stringify({ lien: document.getElementById('timetable-link').value })
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    await showAlert('Paramètres enregistrés', 'Succès');
  }
}

/** Saves the ICS link. The server fetches the calendar before answering, which can take a few seconds. */
async function handleSaveTimetableIcs(e) {
  e.preventDefault();
  const button = e.submitter;
  if (button) button.disabled = true;

  const data = await apiCall('/api/admin/settings/emploi-temps-ics', {
    method: 'POST',
    body: JSON.stringify({ lien: document.getElementById('timetable-ics-link').value })
  });

  if (button) button.disabled = false;

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else if (data.avertissement) {
    await showAlert(data.avertissement, 'Attention');
  } else if (data.nombreCours !== undefined) {
    const lessonCount = data.nombreCours > 1 ? `${data.nombreCours} cours importés` : `${data.nombreCours} cours importé`;
    await showAlert(`Lien ICS enregistré : ${lessonCount}.`, 'Succès');
  } else {
    await showAlert(data.message || 'Lien ICS enregistré', 'Succès');
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
