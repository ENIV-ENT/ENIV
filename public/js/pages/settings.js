import { apiCall, checkAuth, logout } from '../utils/api.js';
import { showAlert } from '../utils/dom.js';

async function init() {
  const auth = await checkAuth();

  document.getElementById('user-info').textContent = auth.username;

  await loadUserInfo();
  await checkEmploiTempsButton();
  setupEventListeners();
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

  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('info-form').addEventListener('submit', handleUpdateInfo);
  document.getElementById('password-form').addEventListener('submit', handleChangePassword);
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

init();
