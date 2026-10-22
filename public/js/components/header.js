import { apiCall, logout } from '../utils/api.js';

const NOTES_URL = 'https://iut-notes.unice.fr';

const CHEVRON_ICON = '<polyline points="6 9 12 15 18 9"></polyline>';
const ADMIN_ICON = '<path d="M12 2.5L14.36 9.76H21.99L15.81 14.24L18.17 21.5L12 17.01L5.83 21.5L8.19 14.24L2.01 9.76H9.64Z"></path>';
const DASHBOARD_ICON = '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>';
const SETTINGS_ICON = '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>';
const TIMETABLE_ICON = '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>';
const GRADES_ICON = '<path d="M16 1C17.6569 1 19 2.34315 19 4C19 4.55228 18.5523 5 18 5C17.4477 5 17 4.55228 17 4C17 3.44772 16.5523 3 16 3H4C3.44772 3 3 3.44772 3 4V20C3 20.5523 3.44772 21 4 21H16C16.5523 21 17 20.5523 17 20V19C17 18.4477 17.4477 18 18 18C18.5523 18 19 18.4477 19 19V20C19 21.6569 17.6569 23 16 23H4C2.34315 23 1 21.6569 1 20V4C1 2.34315 2.34315 1 4 1H16Z" fill="#0F0F0F"/><path fill-rule="evenodd" clip-rule="evenodd" d="M20.7991 8.20087C20.4993 7.90104 20.0132 7.90104 19.7133 8.20087L11.9166 15.9977C11.7692 16.145 11.6715 16.3348 11.6373 16.5404L11.4728 17.5272L12.4596 17.3627C12.6652 17.3285 12.855 17.2308 13.0023 17.0835L20.7991 9.28666C21.099 8.98682 21.099 8.5007 20.7991 8.20087ZM18.2991 6.78666C19.38 5.70578 21.1325 5.70577 22.2134 6.78665C23.2942 7.86754 23.2942 9.61999 22.2134 10.7009L14.4166 18.4977C13.9744 18.9398 13.4052 19.2327 12.7884 19.3355L11.8016 19.5C10.448 19.7256 9.2744 18.5521 9.50001 17.1984L9.66448 16.2116C9.76728 15.5948 10.0602 15.0256 10.5023 14.5834L18.2991 6.78666Z" fill="#0F0F0F"/><path d="M5 7C5 6.44772 5.44772 6 6 6H14C14.5523 6 15 6.44772 15 7C15 7.55228 14.5523 8 14 8H6C5.44772 8 5 7.55228 5 7Z" fill="#0F0F0F"/><path d="M5 11C5 10.4477 5.44772 10 6 10H10C10.5523 10 11 10.4477 11 11C11 11.5523 10.5523 12 10 12H6C5.44772 12 5 11.5523 5 11Z" fill="#0F0F0F"/><path d="M5 15C5 14.4477 5.44772 14 6 14H7C7.55228 14 8 14.4477 8 15C8 15.5523 7.55228 16 7 16H6C5.44772 16 5 15.5523 5 15Z" fill="#0F0F0F"/>';
const MOON_ICON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
const SUN_ICON = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
const LOGOUT_ICON = '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>';

function icon(content, attributes = 'fill="none" stroke="currentColor" stroke-width="2"') {
  return `<svg width="16" height="16" viewBox="0 0 24 24" ${attributes} aria-hidden="true">${content}</svg>`;
}

const HEADER_HTML = `
  <h1><a id="header-home" href="/dashboard">Eniv</a></h1>
  <div class="header-actions">
    <div class="user-menu">
      <button id="user-menu-btn" class="user-menu-btn" aria-haspopup="true" aria-expanded="false">
        <span id="user-info"></span>
        ${icon(CHEVRON_ICON)}
      </button>
      <div id="user-dropdown" class="user-dropdown hidden">
        <button id="admin-btn" class="dropdown-item hidden">
          ${icon(ADMIN_ICON, 'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"')}
          Admin
          <span id="admin-pending-badge" class="dropdown-badge hidden">0</span>
        </button>
        <button id="dashboard-btn" class="dropdown-item">
          ${icon(DASHBOARD_ICON)}
          Tableau de bord
        </button>
        <button id="settings-btn" class="dropdown-item">
          ${icon(SETTINGS_ICON, 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"')}
          Paramètres
        </button>
        <button id="timetable-btn" class="dropdown-item hidden">
          ${icon(TIMETABLE_ICON)}
          Emploi du temps
        </button>
        <button id="notes-btn" class="dropdown-item">
          ${icon(GRADES_ICON, 'fill="none"')}
          Notes
        </button>
        <button id="theme-toggle-btn" class="dropdown-item">
          <svg id="theme-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"></svg>
          <span id="theme-text"></span>
        </button>
        <button id="logout-btn" class="dropdown-item logout">
          ${icon(LOGOUT_ICON)}
          Déconnexion
        </button>
      </div>
    </div>
  </div>
`;

let currentPage = null;
let homeUrl = '/dashboard';

function closeMenu() {
  document.getElementById('user-dropdown').classList.add('hidden');
  document.getElementById('user-menu-btn').setAttribute('aria-expanded', 'false');
}

function updateThemeButton(isDark) {
  document.getElementById('theme-icon').innerHTML = isDark ? SUN_ICON : MOON_ICON;
  document.getElementById('theme-text').textContent = isDark ? 'Thème clair' : 'Thème sombre';
}

/**
 * Builds the shared header in #app-header and wires the menu. Each page has an
 * empty `<header id="app-header"></header>` and loads /css/header.css:
 *
 *   mountHeader({ page: 'dashboard' });  // right away, the menu works
 *   setHeaderUser(auth);                 // once the user is known
 *
 * Call it when the page loads, without waiting for authentication. The menu
 * entry leading to the current page is hidden. The theme itself is already
 * applied by /js/theme-init.js before the first paint; only the button is
 * synchronized here.
 *
 * @param {object} options
 * @param {'dashboard'|'settings'|'timetable'|'admin'|'quiz'} options.page current page, whose entry is hidden
 * @param {string} [options.title] subtitle shown after "Eniv / "
 */
export function mountHeader({ page, title = null }) {
  currentPage = page;
  document.getElementById('app-header').innerHTML = HEADER_HTML;

  if (title) {
    const subtitle = document.createElement('span');
    subtitle.className = 'header-subtitle';
    subtitle.textContent = ` / ${title}`;
    document.querySelector('#app-header h1').append(subtitle);
  }

  const menuBtn = document.getElementById('user-menu-btn');
  const dropdown = document.getElementById('user-dropdown');

  menuBtn.addEventListener('click', () => {
    const open = !dropdown.classList.toggle('hidden');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.classList.contains('hidden') && !e.target.closest('.user-menu')) {
      closeMenu();
    }
  });

  const dashboardBtn = document.getElementById('dashboard-btn');
  const settingsBtn = document.getElementById('settings-btn');
  dashboardBtn.classList.toggle('hidden', page === 'dashboard');
  settingsBtn.classList.toggle('hidden', page === 'settings');

  document.getElementById('admin-btn').addEventListener('click', () => {
    window.location.href = '/admin';
  });
  dashboardBtn.addEventListener('click', () => {
    window.location.href = homeUrl;
  });
  settingsBtn.addEventListener('click', () => {
    window.location.href = '/settings';
  });
  document.getElementById('notes-btn').addEventListener('click', () => {
    window.open(NOTES_URL, '_blank');
    closeMenu();
  });

  updateThemeButton(document.documentElement.classList.contains('dark-theme'));
  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeButton(isDark);
  });

  document.getElementById('logout-btn').addEventListener('click', logout);
}

/**
 * Completes the header with the logged-in user: name, Admin entry (with the
 * pending join requests) and Timetable entry when the class has one.
 * @param {object} auth response of /api/auth/me (see checkAuth)
 */
export function setHeaderUser(auth) {
  if (!auth?.authenticated) return;

  document.getElementById('user-info').textContent = auth.username;

  homeUrl = auth.role === 'superadmin' ? '/superadmin/dashboard' : '/dashboard';
  document.getElementById('header-home').href = homeUrl;

  if (auth.is_admin && currentPage !== 'admin') {
    document.getElementById('admin-btn').classList.remove('hidden');
    loadPendingJoinRequests();
  }

  if (currentPage !== 'timetable') {
    showTimetableEntry();
  }
}

async function loadPendingJoinRequests() {
  const data = await apiCall('/api/admin/join-requests');
  if (Array.isArray(data) && data.length > 0) {
    const badge = document.getElementById('admin-pending-badge');
    badge.textContent = data.length;
    badge.classList.remove('hidden');
  }
}

/**
 * Shows the Timetable entry. With an ICS link the timetable is displayed in
 * Eniv; otherwise the class link opens in a new tab.
 */
async function showTimetableEntry() {
  const data = await apiCall('/api/devoirs/settings/emploi-temps');
  if (!data.ics && !data.lien) return;

  const btn = document.getElementById('timetable-btn');
  btn.classList.remove('hidden');
  btn.addEventListener('click', () => {
    if (data.ics) {
      window.location.href = '/emploi-du-temps';
      return;
    }
    window.open(data.lien, '_blank');
    closeMenu();
  });
}
