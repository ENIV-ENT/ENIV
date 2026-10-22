import { apiCall } from '../utils/api.js';
import { escapeHtml, showAlert } from '../utils/dom.js';

let currentStep = 1;
let selectedSchool = null;
let selectedClass = null;
let newClassName = '';
let usernameCheckTimeout = null;
let isUsernameAvailable = false;
let map = null;
let marker = null;
let legacyToken = null;

let prefilledClassId = null;
let prefilledSchoolId = null;

/**
 * Reads the registration link. `classe_id` and `etab_id` come from an admin's
 * invitation link and prefill the school and the class; `token` comes from the
 * older email invitations, which still go through /api/invitations.
 */
async function init() {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) loadingScreen.classList.add('hidden');

  const urlParams = new URLSearchParams(window.location.search);
  prefilledClassId = urlParams.get('classe_id');
  prefilledSchoolId = urlParams.get('etab_id');

  const token = urlParams.get('token');
  if (token) {
    await handleLegacyToken(token);
    return;
  }

  if (prefilledClassId && prefilledSchoolId) {
    await handlePrefilledLink();
  }

  setupEventListeners();
}

/** Email invitation with a token: goes straight to step 3 (personal details). */
async function handleLegacyToken(token) {
  try {
    const data = await apiCall(`/api/invitations/verify/${token}`);
    if (data.valid) {
      legacyToken = token;
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

/**
 * Invitation link: prefills the school and the class, then goes to step 3.
 * When the link cannot be resolved, the normal flow continues.
 */
async function handlePrefilledLink() {
  try {
    const data = await apiCall(`/api/registration/invite-info?classe_id=${prefilledClassId}&etab_id=${prefilledSchoolId}`);

    if (data.error) {
      return;
    }

    selectedSchool = data.etablissement;
    selectedClass = { id: parseInt(prefilledClassId), nom: data.classe.nom };

    goToStep(3);

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
    return;
  }
}

function setupEventListeners() {
  const schoolSearch = document.getElementById('school-search');
  if (schoolSearch) {
    let searchTimeout = null;
    schoolSearch.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const q = e.target.value.trim();
      if (q.length < 3) {
        document.getElementById('school-results').classList.remove('visible');
        return;
      }
      searchTimeout = setTimeout(() => searchSchools(q), 400);
    });
  }

  const schoolChangeBtn = document.getElementById('school-change-btn');
  if (schoolChangeBtn) {
    schoolChangeBtn.addEventListener('click', () => {
      selectedSchool = null;
      document.getElementById('school-selected').style.display = 'none';
      document.getElementById('map-container').style.display = 'none';
      document.getElementById('school-search').style.display = 'block';
      document.getElementById('school-search').value = '';
      document.getElementById('step-1-next').disabled = true;
    });
  }

  const step1Next = document.getElementById('step-1-next');
  if (step1Next) step1Next.addEventListener('click', () => goToStep(2));

  const step2Prev = document.getElementById('step-2-prev');
  if (step2Prev) step2Prev.addEventListener('click', () => goToStep(1));

  const step2Next = document.getElementById('step-2-next');
  if (step2Next) step2Next.addEventListener('click', () => goToStep(3));

  const step3Prev = document.getElementById('step-3-prev');
  if (step3Prev) step3Prev.addEventListener('click', () => goToStep(2));

  const step3Next = document.getElementById('step-3-next');
  if (step3Next) step3Next.addEventListener('click', () => validateStep3());

  const step4Prev = document.getElementById('step-4-prev');
  if (step4Prev) step4Prev.addEventListener('click', () => goToStep(3));

  const step4Submit = document.getElementById('step-4-submit');
  if (step4Submit) step4Submit.addEventListener('click', handleSubmit);

  const newClassInput = document.getElementById('new-class-name');
  if (newClassInput) {
    newClassInput.addEventListener('input', (e) => {
      newClassName = e.target.value.trim();
      if (newClassName) {
        selectedClass = null;
        document.querySelectorAll('.class-item').forEach(item => item.classList.remove('selected'));
        document.getElementById('step-2-next').disabled = false;
      } else if (!selectedClass) {
        document.getElementById('step-2-next').disabled = true;
      }
    });
  }

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

  const schoolRequestLink = document.getElementById('school-request-link');
  if (schoolRequestLink) {
    schoolRequestLink.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('school-request-form').style.display = 'block';
      document.getElementById('school-not-found').style.display = 'none';
    });
  }

  const schoolRequestSubmit = document.getElementById('request-school-submit');
  if (schoolRequestSubmit) {
    schoolRequestSubmit.addEventListener('click', handleSchoolRequest);
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.form-group')) {
      const results = document.getElementById('school-results');
      if (results) results.classList.remove('visible');
    }
  });
}

async function searchSchools(query) {
  const resultsDiv = document.getElementById('school-results');

  try {
    const data = await apiCall(`/api/registration/etablissements?q=${encodeURIComponent(query)}`);

    if (!data || data.length === 0) {
      resultsDiv.innerHTML = '<div class="autocomplete-item"><div class="autocomplete-item-name">Aucun résultat</div></div>';
      resultsDiv.classList.add('visible');
      const notFoundDiv = document.getElementById('school-not-found');
      if (notFoundDiv) notFoundDiv.style.display = 'block';
      return;
    }

    resultsDiv.innerHTML = data.map(school => `
      <div class="autocomplete-item" data-id="${school.id}" data-uai="${school.uai}" data-name="${escapeHtml(school.nom)}" data-city="${escapeHtml(school.commune || '')}" data-postcode="${school.code_postal || ''}" data-lat="${school.latitude || ''}" data-lng="${school.longitude || ''}">
        <div class="autocomplete-item-name">${escapeHtml(school.nom)}</div>
        <div class="autocomplete-item-details">${escapeHtml(school.commune || '')} ${school.code_postal ? '(' + school.code_postal + ')' : ''}</div>
      </div>
    `).join('');

    resultsDiv.classList.add('visible');

    resultsDiv.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => selectSchool(item));
    });
  } catch (error) {
    console.error('School search error:', error);
  }
}

/**
 * Selects a school from the search results. A school found in the national
 * directory but not yet stored has no id: the search is run again on its UAI
 * code, since the first search cached it on the server.
 */
async function selectSchool(item) {
  const id = item.dataset.id;
  const name = item.dataset.name;
  const city = item.dataset.city;
  const postcode = item.dataset.postcode;
  const lat = parseFloat(item.dataset.lat);
  const lng = parseFloat(item.dataset.lng);

  if (!id || id === 'null') {
    const uai = item.dataset.uai;
    const schools = await apiCall(`/api/registration/etablissements?q=${encodeURIComponent(uai)}`);
    if (schools && schools.length > 0 && schools[0].id) {
      selectedSchool = { id: schools[0].id, nom: name, commune: city, code_postal: postcode, latitude: lat, longitude: lng };
    } else {
      selectedSchool = { id: null, uai: uai, nom: name, commune: city, code_postal: postcode, latitude: lat, longitude: lng };
    }
  } else {
    selectedSchool = { id: parseInt(id), nom: name, commune: city, code_postal: postcode, latitude: lat, longitude: lng };
  }

  document.getElementById('school-search').style.display = 'none';
  document.getElementById('school-results').classList.remove('visible');
  document.getElementById('school-selected').style.display = 'flex';
  document.getElementById('school-selected-name').textContent = name;
  document.getElementById('school-selected-details').textContent = `${city || ''} ${postcode ? '(' + postcode + ')' : ''}`;
  document.getElementById('step-1-next').disabled = false;

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
    marker.bindPopup(name).openPopup();
    setTimeout(() => map.invalidateSize(), 100);
  }
}

async function loadClasses() {
  if (!selectedSchool || !selectedSchool.id) return;

  const classesList = document.getElementById('classes-list');
  classesList.innerHTML = '<p style="color: var(--secondary); text-align: center;">Chargement...</p>';

  const data = await apiCall(`/api/registration/classes?etablissement_id=${selectedSchool.id}`);

  if (!data || data.length === 0) {
    classesList.innerHTML = '';
    document.getElementById('no-classes-message').style.display = 'block';
  } else {
    document.getElementById('no-classes-message').style.display = 'none';
    classesList.innerHTML = data.map(schoolClass => `
      <div class="class-item" data-id="${schoolClass.id}" data-name="${escapeHtml(schoolClass.nom)}">
        <div>
          <div class="class-item-name">${escapeHtml(schoolClass.nom)}</div>
          <div class="class-item-info">${schoolClass.nb_eleves} élève(s)${schoolClass.admin_username ? ' - Admin: ' + escapeHtml(schoolClass.admin_username) : ''}</div>
        </div>
      </div>
    `).join('');

    classesList.querySelectorAll('.class-item').forEach(item => {
      item.addEventListener('click', () => {
        classesList.querySelectorAll('.class-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedClass = { id: parseInt(item.dataset.id), nom: item.dataset.name };
        newClassName = '';
        document.getElementById('new-class-name').value = '';
        document.getElementById('step-2-next').disabled = false;
      });
    });
  }
}

/** Shows a step. Step 2 reloads the classes and resets the choice; step 4 fills the summary. */
function goToStep(step) {
  if (step === 2) {
    loadClasses();
    selectedClass = null;
    newClassName = '';
    document.getElementById('new-class-name').value = '';
    document.getElementById('step-2-next').disabled = true;
  }

  if (step === 4) {
    fillSummary();
  }

  currentStep = step;
  updateStepper();

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
  const lastName = document.getElementById('reg-last-name').value.trim();
  const firstName = document.getElementById('reg-first-name').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const passwordConfirm = document.getElementById('reg-password-confirm').value;

  if (!lastName || !firstName || !username || !password) {
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
  document.getElementById('summary-school').textContent = selectedSchool ? selectedSchool.nom : '-';

  if (selectedClass) {
    document.getElementById('summary-class').textContent = selectedClass.nom;
    document.getElementById('summary-role').textContent = 'Élève (demande en attente d\'approbation)';
    const infoMsg = document.getElementById('summary-info-message');
    infoMsg.style.display = 'block';
    infoMsg.textContent = 'Votre demande sera envoyée à l\'administrateur de la classe. Vous pourrez vous connecter une fois la demande acceptée.';
  } else if (newClassName) {
    document.getElementById('summary-class').textContent = newClassName + ' (nouvelle)';
    document.getElementById('summary-role').textContent = 'Administrateur de la classe';
    document.getElementById('summary-info-message').style.display = 'none';
  }

  document.getElementById('summary-last-name').textContent = document.getElementById('reg-last-name').value;
  document.getElementById('summary-first-name').textContent = document.getElementById('reg-first-name').value;
  document.getElementById('summary-username').textContent = document.getElementById('reg-username').value;
}

/** Creates the account, through the legacy invitation endpoint when the page was opened with a token. */
async function handleSubmit() {
  const submitBtn = document.getElementById('step-4-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Création en cours...';

  function resetSubmitBtn() {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Créer mon compte';
  }

  try {
    if (legacyToken) {
      const data = await apiCall('/api/invitations/complete', {
        method: 'POST',
        body: JSON.stringify({
          token: legacyToken,
          username: document.getElementById('reg-username').value.trim(),
          password: document.getElementById('reg-password').value,
          nom: document.getElementById('reg-last-name').value.trim(),
          prenom: document.getElementById('reg-first-name').value.trim()
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

    const body = {
      username: document.getElementById('reg-username').value.trim(),
      password: document.getElementById('reg-password').value,
      email: document.getElementById('reg-email').value.trim() || null,
      nom: document.getElementById('reg-last-name').value.trim(),
      prenom: document.getElementById('reg-first-name').value.trim(),
      etablissement_id: selectedSchool.id
    };

    if (selectedClass) {
      body.classe_id = selectedClass.id;
    } else if (newClassName) {
      body.classe_nom = newClassName;
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
    console.error('Registration error:', error);
    await showAlert('Erreur lors de la création du compte', 'Erreur');
    resetSubmitBtn();
  }
}

async function handleSchoolRequest() {
  const name = document.getElementById('request-school-name').value.trim();
  const city = document.getElementById('request-school-city').value.trim();
  const postcode = document.getElementById('request-school-postcode').value.trim();
  const requesterEmail = document.getElementById('request-school-email').value.trim();

  if (!name || !requesterEmail) {
    await showAlert('Le nom de l\'établissement et votre email sont requis.', 'Erreur');
    return;
  }

  const submitBtn = document.getElementById('request-school-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Envoi en cours...';

  try {
    const data = await apiCall('/api/registration/etablissement-request', {
      method: 'POST',
      body: JSON.stringify({ nom: name, commune: city, code_postal: postcode, email_demandeur: requesterEmail })
    });

    if (data.success) {
      document.getElementById('school-request-form').style.display = 'none';
      document.getElementById('school-request-success').style.display = 'block';
    } else if (data.error) {
      await showAlert(data.error, 'Erreur');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Envoyer la demande';
    }
  } catch (error) {
    console.error('School request error:', error);
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
