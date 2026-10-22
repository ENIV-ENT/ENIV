// Applique le theme enregistre avant le premier rendu, pour eviter un flash de theme clair.
// Ce script doit rester synchrone (ni defer, ni module) et etre place en tout debut de <head>,
// avant les feuilles de style : c'est la seule facon de poser la classe sur <html> avant la
// premiere peinture. Les pages ne peuvent pas s'en charger elles-memes, leurs scripts sont
// des modules (donc differes) et n'appliquent le theme qu'apres l'appel d'authentification.
(function () {
  var savedTheme = null;

  try {
    savedTheme = localStorage.getItem('theme');
  } catch {
    // localStorage indisponible (mode prive, cookies bloques) : on reste sur le theme clair.
  }

  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark-theme');
  }
})();
