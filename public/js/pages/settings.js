import { apiCall, checkAuth, logout } from '../utils/api.js';

async function init() {
  const auth = await checkAuth();

  if (!auth.authenticated) {
    window.location.href = '/login';
    return;
  }

  if (auth.role === 'admin') {
    window.location.href = '/admin/dashboard';
    return;
  }

  document.getElementById('user-info').textContent = auth.username;

  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = '/dashboard';
  });

  document.getElementById('password-form').addEventListener('submit', handleChangePassword);
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
