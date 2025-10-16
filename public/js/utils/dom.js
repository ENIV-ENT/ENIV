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
