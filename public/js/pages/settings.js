import { apiCall, checkAuth, logout } from '../utils/api.js?v=4';
import { showAlert, showConfirm } from '../utils/dom.js?v=2';

async function init() {
  const auth = await checkAuth();

  document.getElementById('user-info').textContent = auth.username;
  setupAdminButton(auth);

  loadThemePreference();

  await loadUserInfo();
  await loadMcpToken();
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

  document.getElementById('mcp-generate-btn').addEventListener('click', handleGenerateMcpToken);
  document.getElementById('mcp-copy-btn').addEventListener('click', handleCopyMcpUrl);
  document.getElementById('mcp-revoke-btn').addEventListener('click', handleRevokeMcpToken);
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

// Jeton MCP : seul son état est connu après coup, le jeton lui-même n'est affiché qu'à sa création
async function loadMcpToken() {
  const data = await apiCall('/api/auth/mcp-token');
  if (data.error) return;

  const status = document.getElementById('mcp-status');
  const generateBtn = document.getElementById('mcp-generate-btn');
  const revokeBtn = document.getElementById('mcp-revoke-btn');

  if (data.exists) {
    const used = data.last_used_at
      ? `dernière utilisation le ${new Date(data.last_used_at).toLocaleString('fr-FR')}`
      : 'jamais utilisé';
    status.textContent = `Un lien est actif (créé le ${new Date(data.created_at).toLocaleDateString('fr-FR')}, ${used}).`;
    generateBtn.textContent = 'Générer un nouveau lien';
    revokeBtn.classList.remove('hidden');
  } else {
    status.textContent = 'Aucun lien actif.';
    generateBtn.textContent = 'Générer un lien';
    revokeBtn.classList.add('hidden');
  }
}

async function handleGenerateMcpToken() {
  const hasToken = !document.getElementById('mcp-revoke-btn').classList.contains('hidden');
  if (hasToken && !await showConfirm('Le lien actuel cessera de fonctionner. Continuer ?', 'Nouveau lien')) {
    return;
  }

  const data = await apiCall('/api/auth/mcp-token', { method: 'POST' });
  if (data.error) {
    await showAlert(data.error, 'Erreur');
    return;
  }

  const url = `${window.location.origin}/api/mcp/${data.token}`;
  document.getElementById('mcp-url').value = url;
  document.getElementById('mcp-cli').textContent = `claude mcp add --transport http eniv ${url}`;
  document.getElementById('mcp-new-token').classList.remove('hidden');
  document.getElementById('mcp-copy-btn').classList.remove('hidden');
  await loadMcpToken();
}

async function handleCopyMcpUrl() {
  const input = document.getElementById('mcp-url');
  try {
    await navigator.clipboard.writeText(input.value);
    await showAlert('Lien copié', 'Succès');
  } catch {
    input.select();
  }
}

async function handleRevokeMcpToken() {
  if (!await showConfirm('Les assistants connectés avec ce lien perdront l\'accès. Révoquer ?', 'Révoquer le lien')) {
    return;
  }

  const data = await apiCall('/api/auth/mcp-token', { method: 'DELETE' });
  if (data.error) {
    await showAlert(data.error, 'Erreur');
    return;
  }

  document.getElementById('mcp-new-token').classList.add('hidden');
  document.getElementById('mcp-copy-btn').classList.add('hidden');
  await loadMcpToken();
}

init();
