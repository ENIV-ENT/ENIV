import { apiCall, checkAuth, logout } from '../utils/api.js';
import { showAlert, showConfirm, escapeHTML, toggleModal } from '../utils/dom.js';

async function init() {
  const auth = await checkAuth();

  document.getElementById('user-info').textContent = auth.username;
  setupAdminButton(auth);

  loadThemePreference();

  await loadUserInfo();
  await loadMcpTokens();
  await checkEmploiTempsButton();
  setupEventListeners();
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

function setupAdminButton(auth) {
  const adminBtn = document.getElementById('admin-btn');
  if (!adminBtn) return;

  if (auth.is_admin) {
    adminBtn.classList.remove('hidden');
    adminBtn.addEventListener('click', () => {
      window.location.href = '/admin';
    });
  } else {
    adminBtn.classList.add('hidden');
  }
}

async function loadUserInfo() {
  const data = await apiCall('/api/auth/user-info');

  if (data && !data.error) {
    document.getElementById('email').value = data.email || '';
    document.getElementById('nom').value = data.nom || '';
    document.getElementById('prenom').value = data.prenom || '';
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

  if (userMenuBtn && userDropdown) {
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
  }

  // Bouton tableau de bord
  const dashboardBtn = document.getElementById('dashboard-btn');
  if (dashboardBtn) {
    dashboardBtn.addEventListener('click', () => {
      window.location.href = '/dashboard';
    });
  }

  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      window.location.href = '/settings';
    });
  }

  const notesBtn = document.getElementById('notes-btn');
  if (notesBtn) {
    notesBtn.addEventListener('click', () => {
      window.open('https://iut-notes.unice.fr', '_blank');
      document.getElementById('user-dropdown').classList.add('hidden');
    });
  }

  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('info-form').addEventListener('submit', handleUpdateInfo);
  document.getElementById('password-form').addEventListener('submit', handleChangePassword);

  setupMcpTokens();
}

async function handleUpdateInfo(e) {
  e.preventDefault();

  const email = document.getElementById('email').value;
  const nom = document.getElementById('nom').value;
  const prenom = document.getElementById('prenom').value;

  if (!email || !nom || !prenom) {
    await showAlert('Tous les champs sont requis', 'Erreur');
    return;
  }

  const data = await apiCall('/api/auth/update-info', {
    method: 'POST',
    body: JSON.stringify({ email, nom, prenom }),
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    await showAlert('Informations mises à jour avec succès', 'Succès');
  }
}

async function handleChangePassword(e) {
  e.preventDefault();

  const oldPassword = document.getElementById('old-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (newPassword !== confirmPassword) {
    await showAlert('Les nouveaux mots de passe ne correspondent pas', 'Erreur');
    return;
  }

  if (newPassword.length < 4) {
    await showAlert('Le nouveau mot de passe doit contenir au moins 4 caractères', 'Erreur');
    return;
  }

  const data = await apiCall('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
  } else {
    await showAlert('Mot de passe modifié avec succès', 'Succès');
    document.getElementById('password-form').reset();
  }
}

// Liens MCP : un jeton n'est affiché qu'une fois, à sa création ; la liste ne montre que nom et dates
let mcpTokens = [];
let mcpEditingId = null;

function formatDateFr(value, withTime = false) {
  const date = new Date(value);
  return withTime
    ? date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : date.toLocaleDateString('fr-FR');
}

// Valeur d'un <input type="date"> pour une date ISO, dans le fuseau du navigateur
function toDateInputValue(value) {
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function loadMcpTokens() {
  const data = await apiCall('/api/auth/mcp-tokens');
  if (data.error) return;
  mcpTokens = data;
  renderMcpTokens();
}

function renderMcpTokens() {
  const list = document.getElementById('mcp-list');

  if (mcpTokens.length === 0) {
    list.innerHTML = '<li class="token-empty">Aucun lien. Créez-en un pour connecter un assistant.</li>';
    return;
  }

  list.innerHTML = mcpTokens.map((token) => {
    const meta = [`Créé le ${formatDateFr(token.created_at)}`];
    meta.push(token.last_used_at ? `utilisé le ${formatDateFr(token.last_used_at, true)}` : 'jamais utilisé');
    if (token.expires_at) {
      meta.push(`${token.expired ? 'expiré le' : 'expire le'} ${formatDateFr(token.expires_at)}`);
    }

    return `
      <li class="token-item${token.expired ? ' expired' : ''}">
        <div>
          <div class="token-name">${escapeHTML(token.nom)}${token.expired ? '<span class="token-badge">Expiré</span>' : ''}</div>
          <div class="token-meta">${meta.join(' · ')}</div>
        </div>
        <div class="token-actions">
          <button type="button" class="btn-link" data-action="edit" data-id="${token.id}">Modifier</button>
          <button type="button" class="btn-link danger" data-action="revoke" data-id="${token.id}">Révoquer</button>
        </div>
      </li>`;
  }).join('');
}

function setupMcpTokens() {
  document.getElementById('mcp-new-btn').addEventListener('click', () => openMcpForm(null));
  document.getElementById('mcp-form').addEventListener('submit', handleMcpFormSubmit);
  document.getElementById('mcp-form-close').addEventListener('click', () => toggleModal('mcp-form-modal', false));
  document.getElementById('mcp-form-cancel').addEventListener('click', () => toggleModal('mcp-form-modal', false));
  document.getElementById('mcp-copy-btn').addEventListener('click', handleCopyMcpUrl);
  document.getElementById('mcp-created-done').addEventListener('click', closeMcpCreated);

  document.getElementById('mcp-list').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const token = mcpTokens.find(t => String(t.id) === button.dataset.id);
    if (!token) return;
    if (button.dataset.action === 'edit') openMcpForm(token);
    if (button.dataset.action === 'revoke') handleRevokeMcpToken(token);
  });
}

function openMcpForm(token) {
  mcpEditingId = token ? token.id : null;
  document.getElementById('mcp-form-title').textContent = token ? 'Modifier le lien' : 'Nouveau lien';
  document.getElementById('mcp-form-submit').textContent = token ? 'Enregistrer' : 'Créer';
  document.getElementById('mcp-nom').value = token ? token.nom : '';

  const expiration = document.getElementById('mcp-expiration');
  expiration.value = token && token.expires_at ? toDateInputValue(token.expires_at) : '';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  expiration.min = toDateInputValue(tomorrow);

  toggleModal('mcp-form-modal', true);
  document.getElementById('mcp-nom').focus();
}

async function handleMcpFormSubmit(e) {
  e.preventDefault();

  const nom = document.getElementById('mcp-nom').value.trim();
  const day = document.getElementById('mcp-expiration').value;
  // Le lien reste valable toute la journée choisie
  const expires_at = day ? new Date(`${day}T23:59:59`).toISOString() : null;

  const editing = mcpEditingId !== null;
  const data = await apiCall(editing ? `/api/auth/mcp-tokens/${mcpEditingId}` : '/api/auth/mcp-tokens', {
    method: editing ? 'PUT' : 'POST',
    body: JSON.stringify({ nom, expires_at }),
  });

  if (data.error) {
    await showAlert(data.error, 'Erreur');
    return;
  }

  toggleModal('mcp-form-modal', false);
  if (!editing) showMcpCreated(data.token);
  await loadMcpTokens();
}

function showMcpCreated(token) {
  const url = `${window.location.origin}/api/mcp/${token}`;
  document.getElementById('mcp-url').value = url;
  document.getElementById('mcp-cli').textContent = `claude mcp add --transport http eniv ${url}`;
  toggleModal('mcp-created-modal', true);
}

// Le lien est effacé de la page : il ne peut plus être réaffiché
function closeMcpCreated() {
  document.getElementById('mcp-url').value = '';
  document.getElementById('mcp-cli').textContent = '';
  toggleModal('mcp-created-modal', false);
}

async function handleCopyMcpUrl() {
  const input = document.getElementById('mcp-url');
  const button = document.getElementById('mcp-copy-btn');
  try {
    await navigator.clipboard.writeText(input.value);
    button.textContent = 'Copié ✓';
    setTimeout(() => { button.textContent = 'Copier'; }, 2000);
  } catch {
    input.select();
  }
}

async function handleRevokeMcpToken(token) {
  const confirmed = await showConfirm(
    `Les assistants connectés avec « ${token.nom} » perdront l'accès.`,
    'Révoquer le lien'
  );
  if (!confirmed) return;

  const data = await apiCall(`/api/auth/mcp-tokens/${token.id}`, { method: 'DELETE' });
  if (data.error) {
    await showAlert(data.error, 'Erreur');
    return;
  }
  await loadMcpTokens();
}

init();
