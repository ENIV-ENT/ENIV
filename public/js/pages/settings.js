import { apiCall, checkAuth, logout } from '../utils/api.js';

async function init() {
  const auth = await checkAuth();

  document.getElementById('user-info').textContent = auth.username;

  await loadUserInfo();
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

function setupEventListeners() {
  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = '/dashboard';
  });

  document.getElementById('info-form').addEventListener('submit', handleUpdateInfo);
  document.getElementById('password-form').addEventListener('submit', handleChangePassword);
}

async function handleUpdateInfo(e) {
  e.preventDefault();

  const email = document.getElementById('email').value;
  const nom = document.getElementById('nom').value;
  const prenom = document.getElementById('prenom').value;

  if (!email || !nom || !prenom) {
    alert('Tous les champs sont requis');
    return;
  }

  const data = await apiCall('/api/auth/update-info', {
    method: 'POST',
    body: JSON.stringify({ email, nom, prenom }),
  });

  if (data.error) {
    alert(data.error);
  } else {
    alert('Informations mises à jour avec succès');
  }
}

async function handleChangePassword(e) {
  e.preventDefault();

  const oldPassword = document.getElementById('old-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (newPassword !== confirmPassword) {
    alert('Les nouveaux mots de passe ne correspondent pas');
    return;
  }

  if (newPassword.length < 4) {
    alert('Le nouveau mot de passe doit contenir au moins 4 caractères');
    return;
  }

  const data = await apiCall('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });

  if (data.error) {
    alert(data.error);
  } else {
    alert('Mot de passe modifié avec succès');
    document.getElementById('password-form').reset();
  }
}

init();
