// Rattache chaque cours de l'emploi du temps à une matière de la classe, pour
// l'afficher avec la couleur de cette matière.
//
// Un export ICS ne porte pas de couleur. Les matières d'Eniv sont souvent
// nommées comme dans le logiciel d'emploi du temps : « R514 - Anglais ».
// Deux indices, du plus sûr au moins sûr :
//   1. le code (R514), présent dans la description ADE (« TBFAR514 - Anglais »)
//      ou dans le titre (« CM - R504 Qualité algorithmique ») ;
//   2. le nom (« Anglais »), présent dans le titre (« [ALT] TD - Anglais G01 »).
// Le nom n'est cherché que dans le titre : la description contient aussi le
// nom des groupes et des parcours, source de faux positifs.

const CODE_PATTERN = /^([A-Za-z]{1,4}\d{2,4})\s*(?:[-–:]\s*|\s+)(.*)$/;
const COULEUR_PATTERN = /^#[0-9a-f]{3,8}$/i;

// Minuscules, sans accents ni ponctuation : « SAÉ » et « SAE » se confondent
function normaliser(texte) {
  return ` ${String(texte)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

function preparerMatiere(matiere) {
  const match = CODE_PATTERN.exec(matiere.nom.trim());
  const code = match ? match[1].toUpperCase() : null;
  const nom = normaliser(match ? match[2] : matiere.nom);

  return {
    matiere: { id: matiere.id, nom: matiere.nom, couleur: matiere.couleur },
    // Le code peut être collé à un préfixe (TBFAR514) mais pas suivi d'un chiffre
    code: code ? new RegExp(`(?:^|[^0-9])${code}(?![0-9])`) : null,
    nom: nom.trim() ? nom : null
  };
}

/**
 * Ajoute à chaque cours la matière qui lui correspond, s'il y en a une.
 * @param {Array<{titre: string, description: string}>} evenements
 * @param {Array<{id: number, nom: string, couleur: string|null}>} matieres
 * @returns {Array} Nouveaux objets, avec `matiere: {id, nom, couleur}` ou `matiere: null`
 */
function associerMatieres(evenements, matieres) {
  // Une couleur va dans un attribut style côté navigateur : uniquement de l'hexadécimal
  const candidates = matieres
    .filter(m => m.nom && COULEUR_PATTERN.test(m.couleur || ''))
    .map(preparerMatiere)
    // À indice égal, le nom le plus long est le plus précis
    .sort((a, b) => (b.nom || '').length - (a.nom || '').length);

  return evenements.map(evenement => {
    const titre = evenement.titre || '';
    const texte = `${titre}\n${evenement.description || ''}`.toUpperCase();
    const titreNormalise = normaliser(titre);

    const trouvee = candidates.find(c => c.code && c.code.test(texte))
      || candidates.find(c => c.nom && titreNormalise.includes(c.nom));

    return { ...evenement, matiere: trouvee ? trouvee.matiere : null };
  });
}

module.exports = { associerMatieres };
