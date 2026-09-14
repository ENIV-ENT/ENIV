const { notifyClasse } = require('../services/realtime');

// Diffuse une notification temps réel après chaque mutation réussie, à la seule
// classe concernée (celle de l'utilisateur authentifié).

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Liste blanche : seules les routes présentes ici déclenchent une diffusion.
// Le premier motif correspondant l'emporte, et `null` signifie "aucune diffusion".
// Une liste blanche est volontairement préférée à une liste noire : si une future
// route n'est pas ajoutée ici, elle ne diffuse rien — ce qui est un bien meilleur
// défaut que de réveiller toute la classe à chaque action personnelle.
const RESOURCE_RULES = [
  [/^\/api\/devoirs\/\d+\/statut$/, null],        // "fait" : propre à un utilisateur
  [/^\/api\/quiz\/results$/, null],               // résultats : propres à un utilisateur
  [/^\/api\/auth\//, null],                       // compte : propre à un utilisateur
  [/^\/api\/devoirs\/fichiers\//, 'fichiers'],
  [/^\/api\/devoirs\/\d+\/upload$/, 'fichiers'],
  [/^\/api\/devoirs\/\d+\/generate-quiz$/, 'quiz'],
  [/^\/api\/devoirs/, 'devoirs'],
  [/^\/api\/admin\/matieres/, 'matieres'],
  [/^\/api\/quiz/, 'quiz'],
];

function deriveResource(path) {
  const rule = RESOURCE_RULES.find(([pattern]) => pattern.test(path));
  return rule ? rule[1] : null;
}

// Uniquement les identifiants de devoir : sur /api/devoirs/fichiers/7, le 7 est un
// identifiant de fichier et ne doit surtout pas être pris pour un devoir.
function deriveDevoirId(path) {
  const match = path.match(/^\/api\/devoirs\/(\d+)(\/|$)/);
  return match ? Number(match[1]) : null;
}

function realtimeNotifier(req, res, next) {
  if (!MUTATING_METHODS.includes(req.method)) return next();

  // req.url est réécrit par les routeurs montés : le chemin complet doit être figé
  // ici, avant que la requête n'entre dans un routeur.
  const fullPath = req.originalUrl.split('?')[0];
  if (!fullPath.startsWith('/api/')) return next();

  const resource = deriveResource(fullPath);
  if (!resource) return next();

  const originalJson = res.json;
  res.json = function (data) {
    // On répond d'abord : une diffusion lente ne doit jamais retarder la réponse.
    const result = originalJson.call(this, data);

    try {
      const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
      const hasError = data && typeof data === 'object' && data.error !== undefined;
      if (!isSuccess || hasError) return result;

      // res.locals.realtimeClasseId permet à une route de viser une autre classe
      // que celle de l'utilisateur (routes superadmin par exemple).
      const classeId = res.locals.realtimeClasseId ?? req.user?.classe_id ?? null;
      if (!classeId) return result;

      // L'onglet à l'origine de la modification a déjà rechargé ses données :
      // lui rediffuser l'événement provoquerait un appel d'API inutile.
      const origin = req.headers['x-realtime-id'];

      notifyClasse(classeId, {
        type: 'update',
        resource,
        devoirId: deriveDevoirId(fullPath),
        method: req.method,
        at: Date.now()
      }, typeof origin === 'string' ? origin : null);
    } catch (error) {
      // Une notification ratée ne doit jamais casser la réponse HTTP.
      console.error('Notification temps réel échouée:', error);
    }

    return result;
  };

  next();
}

module.exports = realtimeNotifier;
