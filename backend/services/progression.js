/**
 * Statistiques personnelles d'un élève à partir des devoirs de sa classe.
 * Fonction pure : aucune requête ici, pour pouvoir la tester avec des dates fixes.
 *
 * Un devoir « est passé » quand sa date est strictement avant aujourd'hui :
 * un devoir pour aujourd'hui n'est pas encore en retard.
 */

const JOURS_HISTORIQUE = 30;
const JOURS_A_VENIR = 7;
const MAX_A_RATTRAPER = 10;

// « 2026-10-18 » + n jours (calcul en UTC : les dates sont des jours, pas des instants)
function ajouterJours(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function jourDuDevoir(devoir) {
  if (!devoir.date) return null;
  const iso = devoir.date instanceof Date ? devoir.date.toISOString() : String(devoir.date);
  return iso.slice(0, 10);
}

/**
 * @param {Array<{id, titre, date, fait, matiere_nom, matiere_couleur}>} devoirs
 * @param {string} aujourdhui - YYYY-MM-DD, dans le fuseau de l'établissement
 */
function calculerProgression(devoirs, aujourdhui) {
  const debutHistorique = ajouterJours(aujourdhui, -JOURS_HISTORIQUE);
  const finAVenir = ajouterJours(aujourdhui, JOURS_A_VENIR);

  const dates = devoirs
    .map((d) => ({ ...d, jour: jourDuDevoir(d), fait: Boolean(Number(d.fait)) }))
    .filter((d) => d.jour);

  const passes = dates.filter((d) => d.jour < aujourdhui);
  const recents = passes.filter((d) => d.jour >= debutHistorique);
  const aVenir = dates.filter((d) => d.jour >= aujourdhui);

  // Série : devoirs passés faits d'affilée, du plus récent au plus ancien
  let serie = 0;
  for (const d of [...passes].sort((a, b) => b.jour.localeCompare(a.jour) || b.id - a.id)) {
    if (!d.fait) break;
    serie++;
  }

  const parMatiere = new Map();
  for (const d of recents) {
    const nom = d.matiere_nom || 'Sans matière';
    if (!parMatiere.has(nom)) parMatiere.set(nom, { nom, couleur: d.matiere_couleur || null, total: 0, faits: 0 });
    const m = parMatiere.get(nom);
    m.total++;
    if (d.fait) m.faits++;
  }

  const semaine = [];
  for (let i = 0; i < JOURS_A_VENIR; i++) {
    const jour = ajouterJours(aujourdhui, i);
    const duJour = aVenir.filter((d) => d.jour === jour);
    semaine.push({ date: jour, total: duJour.length, restants: duJour.filter((d) => !d.fait).length });
  }

  const faitsRecents = recents.filter((d) => d.fait).length;

  return {
    aujourdhui,
    trente_jours: {
      total: recents.length,
      faits: faitsRecents,
      // null plutôt que 0 % quand il n'y a encore rien à évaluer
      taux: recents.length ? Math.round((faitsRecents / recents.length) * 100) : null,
    },
    a_venir: {
      total: aVenir.filter((d) => d.jour < finAVenir).length,
      restants: aVenir.filter((d) => d.jour < finAVenir && !d.fait).length,
    },
    serie,
    a_rattraper: recents
      .filter((d) => !d.fait)
      .sort((a, b) => b.jour.localeCompare(a.jour))
      .slice(0, MAX_A_RATTRAPER)
      .map(({ id, titre, jour, matiere_nom, matiere_couleur }) => ({ id, titre, date: jour, matiere_nom, matiere_couleur })),
    par_matiere: [...parMatiere.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    semaine,
  };
}

module.exports = { calculerProgression, ajouterJours, JOURS_HISTORIQUE };
