/**
 * Contenu des notifications push. Fonctions pures, sans accès à la base,
 * pour pouvoir être testées isolément.
 *
 * Chaque message porte :
 * - url : page ouverte au clic (le tableau de bord ouvre ?devoir=ID tout seul) ;
 * - tag : une nouvelle notification avec le même tag remplace la précédente
 *   au lieu de s'empiler (ex. trois modifications du même devoir).
 */

const MAX_BODY = 140;

function truncate(text, max = MAX_BODY) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function devoirUrl(devoirId) {
  return `/dashboard/?devoir=${devoirId}`;
}

// « 2026-10-20 » -> « mardi 20 octobre »
function formatJour(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function nouveauDevoir({ id, titre, matiere_nom, date }) {
  const jour = formatJour(date);
  return {
    title: `📚 Nouveau devoir${matiere_nom ? ` · ${matiere_nom}` : ''}`,
    body: truncate(jour ? `${titre} — pour ${jour}` : titre),
    url: devoirUrl(id),
    tag: `devoir-${id}`,
  };
}

// Nom affiché et genre, pour accorder « modifié »
const CHAMPS = {
  titre: { nom: 'titre', feminin: false },
  description: { nom: 'description', feminin: true },
  matiere_id: { nom: 'matière', feminin: true },
  date: { nom: 'date', feminin: true },
};

function devoirModifie({ id, titre, matiere_nom, date }, changes = []) {
  const champs = changes.map((c) => CHAMPS[c.field]).filter(Boolean);
  const dateChange = changes.find((c) => c.field === 'date');
  let detail;
  if (dateChange && formatJour(date)) {
    detail = `désormais pour ${formatJour(date)}`;
  } else if (champs.length) {
    // Masculin dès qu'un champ masculin est concerné
    const accord = `${champs.every((c) => c.feminin) ? 'e' : ''}${champs.length > 1 ? 's' : ''}`;
    detail = `${champs.map((c) => c.nom).join(', ')} modifié${accord}`;
  } else {
    detail = 'modifié';
  }
  return {
    title: `✏️ Devoir modifié${matiere_nom ? ` · ${matiere_nom}` : ''}`,
    body: truncate(`${titre} — ${detail}`),
    url: devoirUrl(id),
    tag: `devoir-${id}`,
  };
}

/**
 * Rappel de la veille : un seul message pour tous les devoirs non faits.
 * @param {Array<{id, titre, matiere_nom}>} devoirs
 */
function rappelVeille(devoirs) {
  if (devoirs.length === 1) {
    const [d] = devoirs;
    return {
      title: '⏰ Pour demain',
      body: truncate(`${d.matiere_nom ? `${d.matiere_nom} : ` : ''}${d.titre}`),
      url: devoirUrl(d.id),
      tag: 'rappel-veille',
    };
  }
  const lignes = devoirs.map((d) => `• ${d.matiere_nom ? `${d.matiere_nom} : ` : ''}${d.titre}`);
  return {
    title: `⏰ ${devoirs.length} devoirs pour demain`,
    body: truncate(lignes.join('\n'), 300),
    url: '/dashboard/',
    tag: 'rappel-veille',
  };
}

/**
 * Nouveau commentaire sur un devoir. Le tag est propre au fil de discussion :
 * plusieurs messages d'affilée ne s'empilent pas, et ne remplacent pas une
 * notification « Nouveau devoir » ou « Devoir modifié » encore affichée.
 * L'url déplie directement la discussion.
 */
function nouveauCommentaire({ devoirId, titre, auteur, contenu }) {
  // Une seule ligne : les retours à la ligne du commentaire gaspillent la place
  const texte = String(contenu || '').replace(/\s+/g, ' ').trim();
  return {
    title: `💬 ${titre}`,
    body: truncate(`${auteur} : ${texte}`),
    url: `${devoirUrl(devoirId)}&commentaires=1`,
    tag: `commentaire-${devoirId}`,
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

module.exports = { nouveauDevoir, devoirModifie, rappelVeille, nouveauCommentaire, test, formatJour, truncate };
