/**
 * Content of the push notifications. Pure functions, without database access, so
 * they can be tested on their own.
 *
 * Each message has:
 * - url: page opened on click (the dashboard opens ?devoir=ID by itself);
 * - tag: a new notification with the same tag replaces the previous one instead
 *   of piling up (e.g. three changes of the same assignment).
 * @module
 */

const MAX_BODY = 140;

function truncate(text, max = MAX_BODY) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function assignmentUrl(assignmentId) {
  return `/dashboard/?devoir=${assignmentId}`;
}

/** "2026-10-20" -> "mardi 20 octobre" */
function formatDay(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function newAssignment({ id, titre: title, matiere_nom: subjectName, date }) {
  const day = formatDay(date);
  return {
    title: `📚 Nouveau devoir${subjectName ? ` · ${subjectName}` : ''}`,
    body: truncate(day ? `${title} — pour ${day}` : title),
    url: assignmentUrl(id),
    tag: `devoir-${id}`,
  };
}

/** Displayed name and grammatical gender, to agree "modifié" in French. */
const FIELDS = {
  titre: { name: 'titre', feminine: false },
  description: { name: 'description', feminine: true },
  matiere_id: { name: 'matière', feminine: true },
  date: { name: 'date', feminine: true },
};

/**
 * @param {Object} assignment
 * @param {Array} changes - result of diffSnapshots
 */
function assignmentUpdated({ id, titre: title, matiere_nom: subjectName, date }, changes = []) {
  const fields = changes.map((c) => FIELDS[c.field]).filter(Boolean);
  const dateChange = changes.find((c) => c.field === 'date');
  let detail;
  if (dateChange && formatDay(date)) {
    detail = `désormais pour ${formatDay(date)}`;
  } else if (fields.length) {
    const agreement = `${fields.every((f) => f.feminine) ? 'e' : ''}${fields.length > 1 ? 's' : ''}`;
    detail = `${fields.map((f) => f.name).join(', ')} modifié${agreement}`;
  } else {
    detail = 'modifié';
  }
  return {
    title: `✏️ Devoir modifié${subjectName ? ` · ${subjectName}` : ''}`,
    body: truncate(`${title} — ${detail}`),
    url: assignmentUrl(id),
    tag: `devoir-${id}`,
  };
}

/**
 * Day-before reminder: a single message for all the assignments not done yet.
 * @param {Array<{id, titre, matiere_nom}>} assignments
 */
function dayBeforeReminder(assignments) {
  if (assignments.length === 1) {
    const [a] = assignments;
    return {
      title: '⏰ Pour demain',
      body: truncate(`${a.matiere_nom ? `${a.matiere_nom} : ` : ''}${a.titre}`),
      url: assignmentUrl(a.id),
      tag: 'rappel-veille',
    };
  }
  const lines = assignments.map((a) => `• ${a.matiere_nom ? `${a.matiere_nom} : ` : ''}${a.titre}`);
  return {
    title: `⏰ ${assignments.length} devoirs pour demain`,
    body: truncate(lines.join('\n'), 300),
    url: '/dashboard/',
    tag: 'rappel-veille',
  };
}

/**
 * New comment on an assignment. The tag is specific to the thread: several
 * messages in a row do not pile up, and do not replace a "Nouveau devoir" or
 * "Devoir modifié" notification still displayed. The url opens the thread
 * directly. The comment is put on a single line: its line breaks waste space.
 */
function newComment({ assignmentId, title, author, content }) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  return {
    title: `💬 ${title}`,
    body: truncate(`${author} : ${text}`),
    url: `${assignmentUrl(assignmentId)}&commentaires=1`,
    tag: `commentaire-${assignmentId}`,
  };
}

function test() {
  return {
    title: '🔔 Notifications activées',
    body: 'Tout fonctionne : vous serez prévenu des nouveaux devoirs et commentaires sur cet appareil.',
    url: '/settings/',
    tag: 'test',
  };
}

module.exports = { newAssignment, assignmentUpdated, dayBeforeReminder, newComment, test, formatDay, truncate };
