import { apiCall } from '../utils/api.js';
import { showAlert } from '../utils/dom.js';

let invitationToken = null;
let usernameCheckTimeout = null;
let lastCheckedUsername = '';
let isUsernameAvailable = false;

async function init() {
  // Récupérer le token depuis l'URL
  const urlParams = new URLSearchParams(window.location.search);
  invitationToken = urlParams.get('token');

  if (!invitationToken) {
    showError('Aucun token d\'invitation fourni');
    return;
  }

  // Vérifier la validité de l'invitation
  await verifyInvitation();
}

async function verifyInvitation() {
  try {
    const data = await apiCall(`/api/invitations/verify/${invitationToken}`);

    if (data.error) {
      showError(data.error);
      return;
    }

    if (data.valid) {
      showRegisterForm(data);
    } else {
      showError('Cette invitation n\'est plus valide ou a déjà été utilisée');
    }
  } catch (error) {
    showError('Impossible de vérifier l\'invitation');
  }
}

function showRegisterForm(invitationData) {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('register-form-container').style.display = 'block';

  // Afficher les informations de l'invitation
  document.getElementById('invite-email').textContent = invitationData.email;

  const roleText = invitationData.role === 'admin' ? 'Administrateur' : 'Élève';
  document.getElementById('invite-role').textContent = roleText;

  if (invitationData.classe) {
    document.getElementById('invite-classe-container').style.display = 'flex';
    document.getElementById('invite-classe').textContent = invitationData.classe;
  }

  setupEventListeners();
}

function showError(message) {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('error-state').style.display = 'block';
  document.getElementById('error-message').textContent = message;
}

function showSuccess() {
  document.getElementById('register-form-container').style.display = 'none';
  document.getElementById('success-state').style.display = 'block';
}

function setupEventListeners() {
  const usernameInput = document.getElementById('username');
  const feedbackDiv = document.getElementById('username-feedback');

  // Vérification du username en temps réel
  usernameInput.addEventListener('input', (e) => {
    const username = e.target.value.trim();

    // Réinitialiser le timeout
    clearTimeout(usernameCheckTimeout);

    // Masquer le feedback si le champ est vide
    if (username.length === 0) {
      feedbackDiv.style.display = 'none';
      feedbackDiv.className = 'username-feedback';
      isUsernameAvailable = false;
      return;
    }

    // Vérifier la longueur minimale
    if (username.length < 3) {
      feedbackDiv.className = 'username-feedback unavailable';
      feedbackDiv.textContent = 'Le nom d\'utilisateur doit contenir au moins 3 caractères';
      isUsernameAvailable = false;
      return;
    }

    // Ne pas vérifier si c'est le même username
    if (username === lastCheckedUsername) {
      return;
    }

    // Afficher l'indicateur de chargement
    feedbackDiv.className = 'username-feedback checking';
    feedbackDiv.innerHTML = '<span class="loading-spinner"></span> Vérification de la disponibilité...';

    // Attendre 500ms avant de faire la requête
    usernameCheckTimeout = setTimeout(() => {
      checkUsernameAvailability(username);
    }, 500);
  });

  // Soumission du formulaire
  document.getElementById('register-form').addEventListener('submit', handleRegister);
}

async function checkUsernameAvailability(username) {
  lastCheckedUsername = username;
  const feedbackDiv = document.getElementById('username-feedback');

  try {
    const data = await apiCall('/api/invitations/check-username', {
      method: 'POST',
      body: JSON.stringify({ username })
    });

    if (data.error) {
      feedbackDiv.className = 'username-feedback unavailable';
      feedbackDiv.textContent = '⚠️ Erreur lors de la vérification';
      isUsernameAvailable = false;
      return;
    }

    if (data.available) {
      feedbackDiv.className = 'username-feedback available';
      feedbackDiv.textContent = '✓ ' + data.message;
      isUsernameAvailable = true;
    } else {
      feedbackDiv.className = 'username-feedback unavailable';
      feedbackDiv.textContent = '✗ ' + data.message;
      isUsernameAvailable = false;
    }
  } catch (error) {
    feedbackDiv.className = 'username-feedback unavailable';
    feedbackDiv.textContent = '⚠️ Erreur lors de la vérification';
    isUsernameAvailable = false;
  }
}

async function handleRegister(e) {
  e.preventDefault();

  const nom = document.getElementById('nom').value.trim();
  const prenom = document.getElementById('prenom').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  // Validations
  if (!nom || !prenom || !username || !password || !confirmPassword) {
    await showAlert('Tous les champs sont requis', 'Erreur');
    return;
  }

  if (username.length < 3) {
    await showAlert('Le nom d\'utilisateur doit contenir au moins 3 caractères', 'Erreur');
    return;
  }

  if (!isUsernameAvailable) {
    await showAlert('Ce nom d\'utilisateur n\'est pas disponible', 'Erreur');
    return;
  }

  if (password.length < 4) {
    await showAlert('Le mot de passe doit contenir au moins 4 caractères', 'Erreur');
    return;
  }

  if (password !== confirmPassword) {
    await showAlert('Les mots de passe ne correspondent pas', 'Erreur');
    return;
  }

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Création en cours...';

  try {
    const data = await apiCall('/api/invitations/complete', {
      method: 'POST',
      body: JSON.stringify({
        token: invitationToken,
        username,
        password,
        nom,
        prenom
      })
    });

    if (data.error) {
      await showAlert(data.error, 'Erreur');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Créer mon compte';
      return;
    }

    if (data.success) {
      showSuccess();
    }
  } catch (error) {
    await showAlert('Erreur lors de la création du compte', 'Erreur');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Créer mon compte';
  }
}

init();
