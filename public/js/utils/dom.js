export function escapeHTML(string) {
  const container = document.createElement('div');
  container.innerText = string;
  return container.innerHTML;
}

export function localDate(year, month, day) {
  return new Date(year, month, day, 0, -new Date().getTimezoneOffset());
}

export function formatDate(dateString) {
  if (!dateString) return 'Aucune date limite';
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

export function toInputDate(dateString) {
  if (!dateString) return '';

  // Si la date est déjà au format YYYY-MM-DD, la retourner directement
  if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }

  // Parser la date
  let date;
  if (typeof dateString === 'string') {
    // Ajouter l'heure pour éviter les problèmes de timezone
    if (dateString.includes('T') || dateString.includes(' ')) {
      date = new Date(dateString);
    } else {
      date = new Date(dateString + 'T12:00:00');
    }
  } else {
    date = new Date(dateString);
  }

  // Vérifier que la date est valide
  if (isNaN(date.getTime())) {
    console.error('Date invalide:', dateString);
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toggleModal(modalId, show = true) {
  const modal = document.getElementById(modalId);
  if (modal) {
    if (show) {
      modal.classList.add('active');
    } else {
      modal.classList.remove('active');
    }
  }
}

export function setupModalClose(modalId, closeButtonId) {
  const closeBtn = document.getElementById(closeButtonId);
  const modal = document.getElementById(modalId);

  if (closeBtn) {
    closeBtn.addEventListener('click', () => toggleModal(modalId, false));
  }

  if (modal) {
    let clickStartTarget = null;

    modal.addEventListener('mousedown', (e) => {
      clickStartTarget = e.target;
    });

    modal.addEventListener('mouseup', (e) => {
      if (e.target === modal && clickStartTarget === modal) {
        toggleModal(modalId, false);
      }
      clickStartTarget = null;
    });
  }
}

// Système de modal pour les alertes et confirmations
let alertModalElement = null;
let confirmModalElement = null;

function createAlertModal() {
  if (alertModalElement) return;

  const modalHTML = `
    <div id="global-alert-modal" class="modal">
      <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
          <h2 id="alert-modal-title">Information</h2>
          <button class="modal-close" id="close-alert-modal">&times;</button>
        </div>
        <div class="modal-body">
          <p id="alert-modal-message" style="margin: 0; line-height: 1.6;"></p>
        </div>
        <div class="form-actions" style="margin-top: 20px;">
          <button class="btn-primary" id="alert-modal-ok">OK</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  alertModalElement = document.getElementById('global-alert-modal');

  document.getElementById('close-alert-modal').addEventListener('click', () => {
    toggleModal('global-alert-modal', false);
  });

  document.getElementById('alert-modal-ok').addEventListener('click', () => {
    toggleModal('global-alert-modal', false);
  });

  alertModalElement.addEventListener('mousedown', (e) => {
    if (e.target === alertModalElement) {
      alertModalElement.dataset.clickStart = 'true';
    }
  });

  alertModalElement.addEventListener('mouseup', (e) => {
    if (e.target === alertModalElement && alertModalElement.dataset.clickStart === 'true') {
      toggleModal('global-alert-modal', false);
    }
    delete alertModalElement.dataset.clickStart;
  });
}

function createConfirmModal() {
  if (confirmModalElement) return;

  const modalHTML = `
    <div id="global-confirm-modal" class="modal">
      <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
          <h2 id="confirm-modal-title">Confirmation</h2>
          <button class="modal-close" id="close-confirm-modal">&times;</button>
        </div>
        <div class="modal-body">
          <p id="confirm-modal-message" style="margin: 0; line-height: 1.6;"></p>
          <label id="confirm-modal-checkbox-row" style="align-items: center; gap: 10px; width: fit-content; margin-top: 16px; font-size: 0.95rem; cursor: pointer;">
            <!-- Styles en ligne : certaines pages donnent width: 100% à tous les input des modales -->
            <input type="checkbox" id="confirm-modal-checkbox" style="width: 18px; height: 18px; margin: 0; padding: 0; flex-shrink: 0; accent-color: var(--primary); cursor: pointer;">
            <span id="confirm-modal-checkbox-label"></span>
          </label>
        </div>
        <div class="form-actions" style="margin-top: 20px; display: flex; gap: 10px;">
          <button class="btn-secondary" id="confirm-modal-cancel">Annuler</button>
          <button class="btn-primary" id="confirm-modal-ok">Confirmer</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  confirmModalElement = document.getElementById('global-confirm-modal');

  document.getElementById('close-confirm-modal').addEventListener('click', () => {
    toggleModal('global-confirm-modal', false);
    if (confirmModalElement.rejectCallback) {
      confirmModalElement.rejectCallback();
    }
  });

  // « Annuler » est une réponse ; la croix et le clic à côté ferment sans répondre
  document.getElementById('confirm-modal-cancel').addEventListener('click', () => {
    toggleModal('global-confirm-modal', false);
    if (confirmModalElement.resolveCallback) {
      confirmModalElement.resolveCallback(false);
    }
  });

  document.getElementById('confirm-modal-ok').addEventListener('click', () => {
    toggleModal('global-confirm-modal', false);
    if (confirmModalElement.resolveCallback) {
      confirmModalElement.resolveCallback(true);
    }
  });

  confirmModalElement.addEventListener('mousedown', (e) => {
    if (e.target === confirmModalElement) {
      confirmModalElement.dataset.clickStart = 'true';
    }
  });

  confirmModalElement.addEventListener('mouseup', (e) => {
    if (e.target === confirmModalElement && confirmModalElement.dataset.clickStart === 'true') {
      toggleModal('global-confirm-modal', false);
      if (confirmModalElement.rejectCallback) {
        confirmModalElement.rejectCallback();
      }
    }
    delete confirmModalElement.dataset.clickStart;
  });
}

export function showAlert(message, title = 'Information') {
  createAlertModal();

  document.getElementById('alert-modal-title').textContent = title;
  document.getElementById('alert-modal-message').textContent = message;

  toggleModal('global-alert-modal', true);

  return new Promise((resolve) => {
    const okButton = document.getElementById('alert-modal-ok');
    const closeButton = document.getElementById('close-alert-modal');

    function handleClose() {
      toggleModal('global-alert-modal', false);
      okButton.removeEventListener('click', handleClose);
      closeButton.removeEventListener('click', handleClose);
      resolve();
    }

    okButton.addEventListener('click', handleClose, { once: true });
    closeButton.addEventListener('click', handleClose, { once: true });
  });
}

/**
 * Avec checkboxLabel, une case à cocher est affichée et la promesse renvoie
 * { confirmed, checked }, ou null si la fenêtre est fermée sans répondre.
 * Sans, elle renvoie un booléen.
 */
export function showConfirm(message, title = 'Confirmation', { confirmLabel = 'Confirmer', cancelLabel = 'Annuler', checkboxLabel = null } = {}) {
  createConfirmModal();

  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-message').textContent = message;
  document.getElementById('confirm-modal-ok').textContent = confirmLabel;
  document.getElementById('confirm-modal-cancel').textContent = cancelLabel;
  const checkbox = document.getElementById('confirm-modal-checkbox');
  checkbox.checked = false;
  document.getElementById('confirm-modal-checkbox-label').textContent = checkboxLabel || '';
  document.getElementById('confirm-modal-checkbox-row').style.display = checkboxLabel ? 'flex' : 'none';

  toggleModal('global-confirm-modal', true);

  return new Promise((resolve) => {
    confirmModalElement.resolveCallback = (confirmed) => resolve(
      checkboxLabel ? { confirmed, checked: checkbox.checked } : confirmed
    );
    confirmModalElement.rejectCallback = () => resolve(checkboxLabel ? null : false);
  });
}

// Calcule si le texte doit être blanc ou noir selon la luminosité de la couleur de fond
export function getContrastColor(hexColor) {
  // Retirer le # si présent
  const hex = hexColor.replace('#', '');

  // Convertir en RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  // Calculer la luminosité selon la formule W3C
  // https://www.w3.org/TR/WCAG20/#relativeluminancedef
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Si la couleur est sombre (luminance < 0.5), utiliser du blanc, sinon du noir
  return luminance < 0.5 ? '#ffffff' : '#000000';
}
