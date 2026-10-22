import { apiCall } from '../utils/api.js';
import { escapeHtml, showAlert } from '../utils/dom.js';

let currentStep = 1;
let selectedEtab = null;
let selectedClasse = null;
let newClasseName = '';
let usernameCheckTimeout = null;
let isUsernameAvailable = false;
let map = null;
let marker = null;

// Données pré-remplies depuis l'URL
let prefilledClasseId = null;
let prefilledEtabId = null;

async function init() {
  // Masquer le loading screen
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) loadingScreen.classList.add('hidden');

  // Vérifier les paramètres URL pour lien pré-rempli
  const urlParams = new URLSearchParams(window.location.search);
  prefilledClasseId = urlParams.get('classe_id');
  prefilledEtabId = urlParams.get('etab_id');

  // Si ancien format avec token, rediriger vers l'ancien flow
  const token = urlParams.get('token');
  if (token) {
    await handleLegacyToken(token);
    return;
  }

  if (prefilledClasseId && prefilledEtabId) {
    await handlePrefilledLink();
  }

  setupEventListeners();
}

async function handleLegacyToken(token) {
  // Garder la compatibilité avec l'ancien système d'invitation par token
  try {
    const data = await apiCall(`/api/invitations/verify/${token}`);
    if (data.valid) {
      // Aller directement à l'étape 3 (informations) avec le contexte du token
      window._legacyToken = token;
      goToStep(3);
      setupEventListeners();
    } else {
      document.querySelector('.register-container').innerHTML = `
        <div class="form-container" style="text-align: center;">
          <h2>Invitation invalide</h2>
          <p style="color: var(--secondary); margin: 1rem 0;">${data.error || 'Cette invitation n\'est plus valide ou a déjà été utilisée.'}</p>
          <a href="/" class="btn-primary" style="display: inline-block; margin-top: 1rem;">Retour à l'accueil</a>
        </div>
      `;
    }
  } catch {
    document.querySelector('.register-container').innerHTML = `
      <div class="form-container" style="text-align: center;">
        <h2>Erreur</h2>
        <p style="color: var(--secondary);">Impossible de vérifier l'invitation.</p>
        <a href="/" class="btn-primary" style="display: inline-block; margin-top: 1rem;">Retour à l'accueil</a>
      </div>
    `;
  }
}

async function handlePrefilledLink() {
  try {
    const data = await apiCall(`/api/registration/invite-info?classe_id=${prefilledClasseId}&etab_id=${prefilledEtabId}`);

    if (data.error) {
      return; // Continuer avec le flow normal
    }

    // Pré-remplir l'établissement
    selectedEtab = data.etablissement;

    // Pré-remplir la classe
    selectedClasse = { id: parseInt(prefilledClasseId), nom: data.classe.nom };

    // Aller directement à l'étape 3
    goToStep(3);

    // Afficher les infos pré-remplies
    const step3Container = document.querySelector('#step-3 .form-container');
    const prefilledDiv = document.createElement('div');
    prefilledDiv.className = 'prefilled-info';
    prefilledDiv.innerHTML = `
      <h3>Inscription pré-remplie</h3>
      <p><strong>Établissement :</strong> ${escapeHtml(data.etablissement.nom)}</p>
      <p><strong>Classe :</strong> ${escapeHtml(data.classe.nom)}</p>
    `;
    step3Container.insertBefore(prefilledDiv, step3Container.querySelector('.form-group'));
  } catch {
    // Continuer avec le flow normal
  }
}

function setupEventListeners() {
  // Étape 1 - Recherche établissement
  const etabSearch = document.getElementById('etab-search');
  if (etabSearch) {
    let searchTimeout = null;
    etabSearch.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const q = e.target.value.trim();
      if (q.length < 3) {
        document.getElementById('etab-results').classList.remove('visible');
        return;
      }
      searchTimeout = setTimeout(() => searchEtablissements(q), 400);
    });
  }

  const etabChangeBtn = document.getElementById('etab-change-btn');
  if (etabChangeBtn) {
    etabChangeBtn.addEventListener('click', () => {
      selectedEtab = null;
      document.getElementById('etab-selected').style.display = 'none';
      document.getElementById('map-container').style.display = 'none';
      document.getElementById('etab-search').style.display = 'block';
      document.getElementById('etab-search').value = '';
      document.getElementById('step1-next').disabled = true;
    });
  }

  // Navigation
  const step1Next = document.getElementById('step1-next');
  if (step1Next) step1Next.addEventListener('click', () => goToStep(2));

  const step2Prev = document.getElementById('step2-prev');
  if (step2Prev) step2Prev.addEventListener('click', () => goToStep(1));

  const step2Next = document.getElementById('step2-next');
  if (step2Next) step2Next.addEventListener('click', () => goToStep(3));

  const step3Prev = document.getElementById('step3-prev');
  if (step3Prev) step3Prev.addEventListener('click', () => goToStep(2));

  const step3Next = document.getElementById('step3-next');
  if (step3Next) step3Next.addEventListener('click', () => validateStep3());

  const step4Prev = document.getElementById('step4-prev');
  if (step4Prev) step4Prev.addEventListener('click', () => goToStep(3));

  const step4Submit = document.getElementById('step4-submit');
  if (step4Submit) step4Submit.addEventListener('click', handleSubmit);

  // Étape 2 - Nouvelle classe input
  const newClasseInput = document.getElementById('new-classe-nom');
  if (newClasseInput) {
    newClasseInput.addEventListener('input', (e) => {
      newClasseName = e.target.value.trim();
      if (newClasseName) {
        // Désélectionner les classes existantes
        selectedClasse = null;
        document.querySelectorAll('.classe-item').forEach(item => item.classList.remove('selected'));
        document.getElementById('step2-next').disabled = false;
      } else if (!selectedClasse) {
        document.getElementById('step2-next').disabled = true;
      }
    });
  }

  // Étape 3 - Username check
  const usernameInput = document.getElementById('reg-username');
  if (usernameInput) {
    usernameInput.addEventListener('input', (e) => {
      clearTimeout(usernameCheckTimeout);
      const username = e.target.value.trim();
      const feedbackDiv = document.getElementById('username-feedback');

      if (username.length === 0) {
        feedbackDiv.className = 'username-feedback';
        feedbackDiv.textContent = '';
        isUsernameAvailable = false;
        return;
      }

      if (username.length < 3) {
        feedbackDiv.className = 'username-feedback unavailable';
        feedbackDiv.textContent = 'Minimum 3 caractères';
        isUsernameAvailable = false;
        return;
      }

      feedbackDiv.className = 'username-feedback checking';
      feedbackDiv.innerHTML = '<span class="loading-spinner"></span> Vérification...';

      usernameCheckTimeout = setTimeout(async () => {
        const data = await apiCall('/api/registration/check-username', {
          method: 'POST',
          body: JSON.stringify({ username })
        });

        if (data.available) {
          feedbackDiv.className = 'username-feedback available';
          feedbackDiv.textContent = '✓ ' + data.message;
          isUsernameAvailable = true;
        } else {
          feedbackDiv.className = 'username-feedback unavailable';
          feedbackDiv.textContent = '✗ ' + data.message;
          isUsernameAvailable = false;
        }
      }, 500);
    });
  }

  // Demande d'ajout d'établissement
  const etabRequestLink = document.getElementById('etab-request-link');
  if (etabRequestLink) {
    etabRequestLink.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('etab-request-form').style.display = 'block';
      document.getElementById('etab-not-found').style.display = 'none';
    });
  }

  const etabRequestSubmit = document.getElementById('request-etab-submit');
  if (etabRequestSubmit) {
    etabRequestSubmit.addEventListener('click', handleEtabRequest);
  }

  // Fermer l'autocomplete quand on clique ailleurs
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.form-group')) {
      const results = document.getElementById('etab-results');
      if (results) results.classList.remove('visible');
    }
  });
}

async function searchEtablissements(query) {
  const resultsDiv = document.getElementById('etab-results');

  try {
    const data = await apiCall(`/api/registration/etablissements?q=${encodeURIComponent(query)}`);

    if (!data || data.length === 0) {
      resultsDiv.innerHTML = '<div class="autocomplete-item"><div class="autocomplete-item-name">Aucun résultat</div></div>';
      resultsDiv.classList.add('visible');
      // Afficher le lien "Votre établissement n'apparaît pas ?"
      const notFoundDiv = document.getElementById('etab-not-found');
      if (notFoundDiv) notFoundDiv.style.display = 'block';
      return;
    }

    resultsDiv.innerHTML = data.map(etab => `
      <div class="autocomplete-item" data-id="${etab.id}" data-uai="${etab.uai}" data-nom="${escapeHtml(etab.nom)}" data-commune="${escapeHtml(etab.commune || '')}" data-cp="${etab.code_postal || ''}" data-lat="${etab.latitude || ''}" data-lng="${etab.longitude || ''}">
        <div class="autocomplete-item-name">${escapeHtml(etab.nom)}</div>
        <div class="autocomplete-item-details">${escapeHtml(etab.commune || '')} ${etab.code_postal ? '(' + etab.code_postal + ')' : ''}</div>
      </div>
    `).join('');

    resultsDiv.classList.add('visible');

    // Ajouter les event listeners
    resultsDiv.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => selectEtablissement(item));
    });
  } catch (error) {
    console.error('Erreur recherche:', error);
  }
}

async function selectEtablissement(item) {
  const id = item.dataset.id;
  const nom = item.dataset.nom;
  const commune = item.dataset.commune;
  const cp = item.dataset.cp;
  const lat = parseFloat(item.dataset.lat);
  const lng = parseFloat(item.dataset.lng);

  // Si pas d'id en base, on doit refetcher pour l'obtenir
  if (!id || id === 'null') {
    // L'établissement a été mis en cache par la recherche, refaire une requête
    const uai = item.dataset.uai;
    const etab = await apiCall(`/api/registration/etablissements?q=${encodeURIComponent(uai)}`);
    if (etab && etab.length > 0 && etab[0].id) {
      selectedEtab = { id: etab[0].id, nom, commune, code_postal: cp, latitude: lat, longitude: lng };
    } else {
      selectedEtab = { id: null, uai: uai, nom, commune, code_postal: cp, latitude: lat, longitude: lng };
    }
  } else {
    selectedEtab = { id: parseInt(id), nom, commune, code_postal: cp, latitude: lat, longitude: lng };
  }

  // Afficher la sélection
  document.getElementById('etab-search').style.display = 'none';
  document.getElementById('etab-results').classList.remove('visible');
  document.getElementById('etab-selected').style.display = 'flex';
  document.getElementById('etab-selected-nom').textContent = nom;
  document.getElementById('etab-selected-details').textContent = `${commune || ''} ${cp ? '(' + cp + ')' : ''}`;
  document.getElementById('step1-next').disabled = false;

  // Afficher la carte
  if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
    document.getElementById('map-container').style.display = 'block';
    if (!map) {
      map = L.map('map').setView([lat, lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);
    } else {
      map.setView([lat, lng], 15);
    }
    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup(nom).openPopup();
    // Force map to resize properly
    setTimeout(() => map.invalidateSize(), 100);
  }
}

async function loadClasses() {
  if (!selectedEtab || !selectedEtab.id) return;

  const classesList = document.getElementById('classes-list');
  classesList.innerHTML = '<p style="color: var(--secondary); text-align: center;">Chargement...</p>';

  const data = await apiCall(`/api/registration/classes?etablissement_id=${selectedEtab.id}`);

  if (!data || data.length === 0) {
    classesList.innerHTML = '';
    document.getElementById('no-classes-message').style.display = 'block';
  } else {
    document.getElementById('no-classes-message').style.display = 'none';
    classesList.innerHTML = data.map(classe => `
      <div class="classe-item" data-id="${classe.id}" data-nom="${escapeHtml(classe.nom)}">
        <div>
          <div class="classe-item-name">${escapeHtml(classe.nom)}</div>
          <div class="classe-item-info">${classe.nb_eleves} élève(s)${classe.admin_username ? ' - Admin: ' + escapeHtml(classe.admin_username) : ''}</div>
        </div>
      </div>
    `).join('');

    classesList.querySelectorAll('.classe-item').forEach(item => {
      item.addEventListener('click', () => {
        // Désélectionner les autres
        classesList.querySelectorAll('.classe-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedClasse = { id: parseInt(item.dataset.id), nom: item.dataset.nom };
        newClasseName = '';
        document.getElementById('new-classe-nom').value = '';
        document.getElementById('step2-next').disabled = false;
      });
    });
  }
}

function goToStep(step) {
  // Quand on arrive à l'étape 2, charger les classes
  if (step === 2) {
    loadClasses();
    // Réinitialiser
    selectedClasse = null;
    newClasseName = '';
    document.getElementById('new-classe-nom').value = '';
    document.getElementById('step2-next').disabled = true;
  }

  // Quand on arrive à l'étape 4, remplir le résumé
  if (step === 4) {
    fillSummary();
  }

  currentStep = step;
  updateStepper();

  // Masquer tous les steps
  document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
  const stepEl = document.getElementById(`step-${step}`);
  if (stepEl) stepEl.classList.add('active');
}

function updateStepper() {
  const steps = document.querySelectorAll('.stepper .step');
  const lines = document.querySelectorAll('.stepper .step-line');

  steps.forEach((step, index) => {
    const stepNum = index + 1;
    step.classList.remove('active', 'completed');
    if (stepNum === currentStep) {
      step.classList.add('active');
    } else if (stepNum < currentStep) {
      step.classList.add('completed');
    }
  });

  lines.forEach((line, index) => {
    line.classList.remove('completed');
    if (index + 1 < currentStep) {
      line.classList.add('completed');
    }
  });
}

async function validateStep3() {
  const nom = document.getElementById('reg-nom').value.trim();
  const prenom = document.getElementById('reg-prenom').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const passwordConfirm = document.getElementById('reg-password-confirm').value;

  if (!nom || !prenom || !username || !password) {
    await showAlert('Tous les champs obligatoires doivent être remplis', 'Erreur');
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

  if (password !== passwordConfirm) {
    await showAlert('Les mots de passe ne correspondent pas', 'Erreur');
    return;
  }

  goToStep(4);
}

function fillSummary() {
  document.getElementById('summary-etab').textContent = selectedEtab ? selectedEtab.nom : '-';

  if (selectedClasse) {
    document.getElementById('summary-classe').textContent = selectedClasse.nom;
    document.getElementById('summary-role').textContent = 'Élève (demande en attente d\'approbation)';
    const infoMsg = document.getElementById('summary-info-message');
    infoMsg.style.display = 'block';
    infoMsg.textContent = 'Votre demande sera envoyée à l\'administrateur de la classe. Vous pourrez vous connecter une fois la demande acceptée.';
  } else if (newClasseName) {
    document.getElementById('summary-classe').textContent = newClasseName + ' (nouvelle)';
    document.getElementById('summary-role').textContent = 'Administrateur de la classe';
    document.getElementById('summary-info-message').style.display = 'none';
  }

  document.getElementById('summary-nom').textContent = document.getElementById('reg-nom').value;
  document.getElementById('summary-prenom').textContent = document.getElementById('reg-prenom').value;
  document.getElementById('summary-username').textContent = document.getElementById('reg-username').value;
}

async function handleSubmit() {
  const submitBtn = document.getElementById('step4-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Création en cours...';

  function resetSubmitBtn() {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Créer mon compte';
  }

  try {
    // Si on a un legacy token, utiliser l'ancien système
    if (window._legacyToken) {
      const data = await apiCall('/api/invitations/complete', {
        method: 'POST',
        body: JSON.stringify({
          token: window._legacyToken,
          username: document.getElementById('reg-username').value.trim(),
          password: document.getElementById('reg-password').value,
          nom: document.getElementById('reg-nom').value.trim(),
          prenom: document.getElementById('reg-prenom').value.trim()
        })
      });

      if (data.error) {
        await showAlert(data.error, 'Erreur');
        resetSubmitBtn();
        return;
      }

      showSuccess('Compte créé avec succès !', 'Vous pouvez maintenant vous connecter.');
      return;
    }

    // Nouveau système d'inscription
    const body = {
      username: document.getElementById('reg-username').value.trim(),
      password: document.getElementById('reg-password').value,
      email: document.getElementById('reg-email').value.trim() || null,
      nom: document.getElementById('reg-nom').value.trim(),
      prenom: document.getElementById('reg-prenom').value.trim(),
      etablissement_id: selectedEtab.id
    };

    if (selectedClasse) {
      body.classe_id = selectedClasse.id;
    } else if (newClasseName) {
      body.classe_nom = newClasseName;
    }

    const data = await apiCall('/api/registration/register', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    if (data.error) {
      await showAlert(data.error, 'Erreur');
      resetSubmitBtn();
      return;
    }

    if (data.success) {
      showSuccess(
        data.pending ? 'Compte créé !' : 'Compte créé avec succès !',
        data.message
      );
    }
  } catch (error) {
    console.error('Erreur inscription:', error);
    await showAlert('Erreur lors de la création du compte', 'Erreur');
    resetSubmitBtn();
  }
}

async function handleEtabRequest() {
  const nom = document.getElementById('request-etab-nom').value.trim();
  const commune = document.getElementById('request-etab-commune').value.trim();
  const code_postal = document.getElementById('request-etab-cp').value.trim();
  const email_demandeur = document.getElementById('request-etab-email').value.trim();

  if (!nom || !email_demandeur) {
    await showAlert('Le nom de l\'établissement et votre email sont requis.', 'Erreur');
    return;
  }

  const submitBtn = document.getElementById('request-etab-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Envoi en cours...';

  try {
    const data = await apiCall('/api/registration/etablissement-request', {
      method: 'POST',
      body: JSON.stringify({ nom, commune, code_postal, email_demandeur })
    });

    if (data.success) {
      document.getElementById('etab-request-form').style.display = 'none';
      document.getElementById('etab-request-success').style.display = 'block';
    } else if (data.error) {
      await showAlert(data.error, 'Erreur');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Envoyer la demande';
    }
  } catch (error) {
    console.error('Erreur demande etablissement:', error);
    await showAlert('Erreur lors de l\'envoi de la demande', 'Erreur');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Envoyer la demande';
  }
}

function showSuccess(title, message) {
  document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
  document.querySelector('.stepper').style.display = 'none';
  document.getElementById('success-state').style.display = 'block';
  document.getElementById('success-title').textContent = title;
  document.getElementById('success-message').textContent = message;
}

init();
