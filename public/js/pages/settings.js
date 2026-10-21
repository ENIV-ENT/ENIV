import { apiCall, checkAuth } from '../utils/api.js';
import { mountHeader, setHeaderUser } from '../components/header.js';
import { showAlert, showConfirm, escapeHTML, toggleModal } from '../utils/dom.js';
import { isPushSupported, needsHomeScreenInstall, getPushSubscription, enablePush, disablePush, syncPushSubscription } from '../utils/push.js';

async function init() {
  // En premier : un chargement qui traîne ne doit pas rendre la page inerte
  mountHeader({ page: 'settings' });
  setupEventListeners();

  const auth = await checkAuth();

  setHeaderUser(auth);

  // En parallèle : une section lente ne retarde pas les autres
  await Promise.all([loadUserInfo(), loadMcpTokens(), setupPush(), setupCalendar()]);
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

// Notifications push : l'abonnement est propre à ce navigateur, les préférences
// au compte (elles valent pour tous ses appareils).
async function setupPush() {
  const toggleBtn = document.getElementById('push-toggle-btn');
  const testBtn = document.getElementById('push-test-btn');
  const fieldset = document.getElementById('push-preferences');

  // Gestionnaires d'abord, chargements ensuite (voir init)
  // Cases à cocher et listes de choix (la dernière valeur enregistrée d'une
  // liste est gardée dans dataset.saved pour revenir en arrière en cas d'erreur)
  fieldset.addEventListener('change', async (e) => {
    const input = e.target;
    const isCheckbox = input.type === 'checkbox';
    const result = await apiCall('/api/push/preferences', {
      method: 'PUT',
      body: JSON.stringify({ [input.name]: isCheckbox ? input.checked : input.value }),
    });
    if (result.error) {
      if (isCheckbox) input.checked = !input.checked;
      else input.value = input.dataset.saved;
      await showAlert(result.error, 'Erreur');
    } else if (!isCheckbox) {
      input.dataset.saved = input.value;
    }
  });

  toggleBtn.addEventListener('click', async () => {
    toggleBtn.disabled = true;
    const active = Boolean(await getPushSubscription());
    const result = active ? await disablePush() : await enablePush();
    if (!result.ok) await showAlert(result.error, 'Notifications');
    await renderPushState();
    await loadPushDevices();
  });

  testBtn.addEventListener('click', async () => {
    const result = await apiCall('/api/push/test', { method: 'POST' });
    if (result.error) await showAlert(result.error, 'Erreur');
  });

  document.getElementById('push-devices').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action="remove"]');
    const device = button && pushDevices.find((d) => String(d.id) === button.dataset.id);
    if (device) handleRemovePushDevice(device);
  });

  // Les cases restent désactivées tant que renderPushState ne les a pas activées
  const data = await apiCall('/api/push/preferences');
  if (!data.error) {
    for (const [key, value] of Object.entries(data.preferences)) {
      const input = fieldset.querySelector(`[name="${key}"]`);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = value;
      else input.value = input.dataset.saved = value;
    }
  }

  await syncPushSubscription();
  await renderPushState();
  await loadPushDevices();
}

// Appareils abonnés du compte : permet de retirer un appareil perdu. Celui-ci
// se gère avec le bouton Activer/Désactiver, il n'a donc pas de bouton Retirer.
let pushDevices = [];

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadPushDevices() {
  const data = await apiCall('/api/push/subscriptions');
  if (data.error) return;
  const subscription = await getPushSubscription().catch(() => null);
  const currentHash = subscription ? await sha256Hex(subscription.endpoint) : null;
  pushDevices = data.map((device) => ({ ...device, current: device.endpoint_hash === currentHash }));
  renderPushDevices();
}

function renderPushDevices() {
  document.getElementById('push-devices-block').hidden = pushDevices.length === 0;
  document.getElementById('push-devices').innerHTML = pushDevices.map((device) => {
    const meta = [`Ajouté le ${formatDateFr(device.created_at)}`];
    meta.push(device.last_success_at
      ? `dernière notification le ${formatDateFr(device.last_success_at, true)}`
      : 'aucune notification reçue');

    return `
      <li class="token-item">
        <div>
          <div class="token-name">${escapeHTML(device.appareil)}${device.current ? '<span class="token-badge info">Cet appareil</span>' : ''}</div>
          <div class="token-meta">${meta.join(' · ')}</div>
        </div>
        ${device.current ? '' : `
        <div class="token-actions">
          <button type="button" class="btn-link danger" data-action="remove" data-id="${device.id}">Retirer</button>
        </div>`}
      </li>`;
  }).join('');
}

async function handleRemovePushDevice(device) {
  const confirmed = await showConfirm(
    `« ${device.appareil} » ne recevra plus les notifications de votre compte.`,
    'Retirer l\'appareil'
  );
  if (!confirmed) return;

  const data = await apiCall(`/api/push/subscriptions/${device.id}`, { method: 'DELETE' });
  if (data.error) {
    await showAlert(data.error, 'Erreur');
    return;
  }
  await loadPushDevices();
}

async function renderPushState() {
  const toggleBtn = document.getElementById('push-toggle-btn');
  const testBtn = document.getElementById('push-test-btn');
  const fieldset = document.getElementById('push-preferences');
  const status = document.getElementById('push-status');

  if (needsHomeScreenInstall()) {
    status.textContent = 'Sur iPhone et iPad, ajoutez d\'abord Eniv à l\'écran d\'accueil (bouton Partager › « Sur l\'écran d\'accueil »), puis ouvrez-le depuis l\'icône.';
    toggleBtn.disabled = true;
    return;
  }
  if (!isPushSupported()) {
    status.textContent = 'Ce navigateur ne prend pas en charge les notifications.';
    toggleBtn.disabled = true;
    return;
  }

  const active = Notification.permission === 'granted' && Boolean(await getPushSubscription());
  toggleBtn.disabled = Notification.permission === 'denied';
  toggleBtn.textContent = active ? 'Désactiver' : 'Activer';
  toggleBtn.className = active ? 'btn-secondary' : 'btn-primary';
  fieldset.disabled = !active;
  testBtn.hidden = !active;

  if (active) {
    status.textContent = 'Activées sur cet appareil. Choisissez ce que vous voulez recevoir :';
  } else if (Notification.permission === 'denied') {
    status.textContent = 'Les notifications sont bloquées pour Eniv dans ce navigateur. Autorisez-les dans ses réglages (icône à gauche de l\'adresse), puis rechargez la page.';
  } else {
    status.textContent = 'Recevez une alerte pour les nouveaux devoirs et commentaires, et un rappel la veille, même quand Eniv est fermé.';
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
  document.getElementById('mcp-copy-btn').addEventListener('click', () => copyField('mcp-url', 'mcp-copy-btn'));
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

async function copyField(inputId, buttonId) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
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

// Agenda : lien d'abonnement iCal, relu par les applications d'agenda.
// Contrairement aux liens MCP, il reste affichable : il ne donne qu'un accès en lecture.
async function setupCalendar() {
  document.getElementById('calendar-create-btn').addEventListener('click', () => createCalendarLink());
  document.getElementById('calendar-regenerate-btn').addEventListener('click', async () => {
    const confirmed = await showConfirm(
      'L\'ancien lien cessera de fonctionner : il faudra réabonner vos agendas avec le nouveau.',
      'Régénérer le lien'
    );
    if (confirmed) await createCalendarLink();
  });
  document.getElementById('calendar-delete-btn').addEventListener('click', async () => {
    const confirmed = await showConfirm('Vos agendas abonnés ne recevront plus vos devoirs.', 'Désactiver le lien');
    if (!confirmed) return;
    const data = await apiCall('/api/calendar/link', { method: 'DELETE' });
    if (data.error) {
      await showAlert(data.error, 'Erreur');
      return;
    }
    renderCalendarLink({ url: null });
  });
  document.getElementById('calendar-copy-btn').addEventListener('click', () => copyField('calendar-url', 'calendar-copy-btn'));

  const data = await apiCall('/api/calendar/link');
  if (!data.error) renderCalendarLink(data);
}

async function createCalendarLink() {
  const data = await apiCall('/api/calendar/link', { method: 'POST' });
  if (data.error) {
    await showAlert(data.error, 'Erreur');
    return;
  }
  renderCalendarLink(data);
}

function renderCalendarLink(link) {
  const linked = Boolean(link.url);
  document.getElementById('calendar-linked').hidden = !linked;
  document.getElementById('calendar-create-btn').hidden = linked;
  if (!linked) return;

  document.getElementById('calendar-url').value = link.url;
  document.getElementById('calendar-google').href = link.google;
  document.getElementById('calendar-webcal').href = link.webcal;
}

init();
