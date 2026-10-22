export function escapeHtml(string) {
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

/**
 * Formats a date for an `<input type="date">`. A bare `YYYY-MM-DD` string is
 * returned as is; other date-only strings get a noon time so that the time zone
 * cannot shift them to the previous day.
 * @param {string|Date} dateString
 * @returns {string} `YYYY-MM-DD`, or an empty string for a missing or invalid date.
 */
export function toInputDate(dateString) {
  if (!dateString) return '';

  if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }

  let date;
  if (typeof dateString === 'string') {
    if (dateString.includes('T') || dateString.includes(' ')) {
      date = new Date(dateString);
    } else {
      date = new Date(dateString + 'T12:00:00');
    }
  } else {
    date = new Date(dateString);
  }

  if (isNaN(date.getTime())) {
    console.error('Invalid date:', dateString);
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

let alertModalElement = null;
let confirmModalElement = null;

function createAlertModal() {
  if (alertModalElement) return;

  const modalHtml = `
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

  document.body.insertAdjacentHTML('beforeend', modalHtml);
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

/**
 * Builds the shared confirmation dialog. "Annuler" is an answer (resolves
 * `false`); the close button and a click outside close it without answering.
 * The checkbox has inline styles because some pages give `width: 100%` to every
 * input inside a modal.
 */
function createConfirmModal() {
  if (confirmModalElement) return;

  const modalHtml = `
    <div id="global-confirm-modal" class="modal">
      <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
          <h2 id="confirm-modal-title">Confirmation</h2>
          <button class="modal-close" id="close-confirm-modal">&times;</button>
        </div>
        <div class="modal-body">
          <p id="confirm-modal-message" style="margin: 0; line-height: 1.6;"></p>
          <label id="confirm-modal-checkbox-row" style="align-items: center; gap: 10px; width: fit-content; margin-top: 16px; font-size: 0.95rem; cursor: pointer;">
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

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  confirmModalElement = document.getElementById('global-confirm-modal');

  document.getElementById('close-confirm-modal').addEventListener('click', () => {
    toggleModal('global-confirm-modal', false);
    if (confirmModalElement.rejectCallback) {
      confirmModalElement.rejectCallback();
    }
  });

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
 * Asks for a confirmation.
 * With `checkboxLabel`, a checkbox is shown and the promise resolves to
 * `{ confirmed, checked }`, or `null` when the dialog is closed without an
 * answer. Without it, the promise resolves to a boolean.
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

/**
 * Picks a readable text color (white or black) for a background color, from its
 * perceived brightness.
 * @param {string} hexColor - `#rrggbb`
 * @returns {string}
 */
export function getContrastColor(hexColor) {
  const hex = hexColor.replace('#', '');

  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance < 0.5 ? '#ffffff' : '#000000';
}
