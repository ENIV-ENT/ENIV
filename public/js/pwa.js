// Enregistre le service worker (app installable + consultation hors ligne)
// et signale quand les données affichées viennent du cache.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker non enregistré :', error);
    });
  });
}

(function () {
  let banner;

  function update() {
    if (navigator.onLine) {
      if (banner) banner.hidden = true;
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.textContent = 'Hors ligne : affichage des dernières données enregistrées.';
      banner.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:10000;'
        + 'padding:0.5rem 1rem;background:#343a40;color:#fff;text-align:center;font:14px sans-serif';
      document.body.appendChild(banner);
    }
    banner.hidden = false;
  }

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', update);
  } else {
    update();
  }
})();
