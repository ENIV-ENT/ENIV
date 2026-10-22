/**
 * Applies the saved theme before the first render, to avoid a flash of the
 * light theme.
 *
 * This script must stay synchronous (neither defer nor module) and sit at the
 * very start of <head>, before the stylesheets: it is the only way to set the
 * class on <html> before the first paint. Pages cannot do it themselves, since
 * their scripts are modules (thus deferred) and only apply the theme after the
 * authentication call. When localStorage is unavailable (private mode, blocked
 * cookies), the light theme stays.
 */
(function () {
  var savedTheme;

  try {
    savedTheme = localStorage.getItem('theme');
  } catch {
    return;
  }

  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark-theme');
  }
})();
