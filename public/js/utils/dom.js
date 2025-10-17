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

  document.getElementById('confirm-modal-cancel').addEventListener('click', () => {
    toggleModal('global-confirm-modal', false);
    if (confirmModalElement.rejectCallback) {
      confirmModalElement.rejectCallback();
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

export function showConfirm(message, title = 'Confirmation') {
  createConfirmModal();

  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-message').textContent = message;

  toggleModal('global-confirm-modal', true);

  return new Promise((resolve) => {
    confirmModalElement.resolveCallback = resolve;
    confirmModalElement.rejectCallback = () => resolve(false);
  });
}
