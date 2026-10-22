const { notifyClass } = require('../services/realtime');

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Allow list: only these routes trigger a broadcast. The first matching pattern
 * wins, and `null` means "no broadcast" (status, quiz results and account routes
 * only concern one user). An allow list is preferred on purpose: a future route
 * missing here broadcasts nothing, a much better default than waking the whole
 * class on every personal action.
 */
const RESOURCE_RULES = [
  [/^\/api\/devoirs\/\d+\/statut$/, null],
  [/^\/api\/quiz\/results$/, null],
  [/^\/api\/auth\//, null],
  [/^\/api\/devoirs\/fichiers\//, 'fichiers'],
  [/^\/api\/devoirs\/\d+\/upload$/, 'fichiers'],
  [/^\/api\/devoirs\/\d+\/generate-quiz$/, 'quiz'],
  [/^\/api\/devoirs\/\d+\/commentaires(\/|$)/, 'commentaires'],
  [/^\/api\/devoirs/, 'devoirs'],
  [/^\/api\/admin\/matieres/, 'matieres'],
  [/^\/api\/quiz/, 'quiz'],
];

function deriveResource(path) {
  const rule = RESOURCE_RULES.find(([pattern]) => pattern.test(path));
  return rule ? rule[1] : null;
}

/**
 * Only assignment ids: in /api/devoirs/fichiers/7, 7 is a file id and must not be
 * taken for an assignment.
 */
function deriveAssignmentId(path) {
  const match = path.match(/^\/api\/devoirs\/(\d+)(\/|$)/);
  return match ? Number(match[1]) : null;
}

/**
 * Broadcasts a realtime notification after each successful mutation, only to the
 * class concerned (the authenticated user's).
 *
 * - The full path is captured before the request enters a router, since mounted
 *   routers rewrite req.url.
 * - The response is sent first: a slow broadcast must never delay it, and a failed
 *   broadcast must never break it.
 * - res.locals.realtimeClassId lets a route target another class than the user's.
 * - res.locals.realtimeData is merged into the message, so clients do not have to
 *   reload everything (comment count for instance).
 * - The tab that made the change (X-Realtime-Id header) already reloaded its data
 *   and is excluded from the broadcast.
 */
function realtimeNotifier(req, res, next) {
  if (!MUTATING_METHODS.includes(req.method)) return next();

  const fullPath = req.originalUrl.split('?')[0];
  if (!fullPath.startsWith('/api/')) return next();

  const resource = deriveResource(fullPath);
  if (!resource) return next();

  const originalJson = res.json;
  res.json = function (data) {
    const result = originalJson.call(this, data);

    try {
      const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
      const hasError = data && typeof data === 'object' && data.error !== undefined;
      if (!isSuccess || hasError) return result;

      const classId = res.locals.realtimeClassId ?? req.user?.classe_id ?? null;
      if (!classId) return result;

      const origin = req.headers['x-realtime-id'];

      notifyClass(classId, {
        type: 'update',
        resource,
        devoirId: deriveAssignmentId(fullPath),
        method: req.method,
        at: Date.now(),
        ...res.locals.realtimeData
      }, typeof origin === 'string' ? origin : null);
    } catch (error) {
      console.error('Realtime notification failed:', error);
    }

    return result;
  };

  next();
}

module.exports = realtimeNotifier;
