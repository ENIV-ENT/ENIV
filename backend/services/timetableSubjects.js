/**
 * Links each timetable lesson to a subject of the class, to show it with that
 * subject's color.
 *
 * An ICS export carries no color. Eniv subjects are often named as in the
 * timetable software: "R514 - Anglais". Two clues, from the most to the least
 * reliable:
 *   1. the code (R514), found in the ADE description ("TBFAR514 - Anglais") or in
 *      the title ("CM - R504 Qualité algorithmique");
 *   2. the name ("Anglais"), found in the title ("[ALT] TD - Anglais G01").
 * The name is only searched in the title: the description also holds the names
 * of groups and tracks, a source of false positives.
 * @module
 */

const CODE_PATTERN = /^([A-Za-z]{1,4}\d{2,4})\s*(?:[-–:]\s*|\s+)(.*)$/;
const COLOR_PATTERN = /^#[0-9a-f]{3,8}$/i;

/** Lowercase, without accents or punctuation: "SAÉ" and "SAE" match. */
function normalize(text) {
  return ` ${String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/** The code may be glued to a prefix (TBFAR514) but not followed by a digit. */
function prepareSubject(subject) {
  const match = CODE_PATTERN.exec(subject.nom.trim());
  const code = match ? match[1].toUpperCase() : null;
  const name = normalize(match ? match[2] : subject.nom);

  return {
    subject: { id: subject.id, nom: subject.nom, couleur: subject.couleur },
    code: code ? new RegExp(`(?:^|[^0-9])${code}(?![0-9])`) : null,
    name: name.trim() ? name : null
  };
}

/**
 * Adds to each lesson its matching subject, if any.
 * Only hexadecimal colors are kept, since the color ends up in a style attribute
 * in the browser. With equal clues, the longest name is the most precise.
 * @param {Array<{titre: string, description: string}>} events
 * @param {Array<{id: number, nom: string, couleur: string|null}>} subjects
 * @returns {Array} new objects, with `matiere: {id, nom, couleur}` or `matiere: null`
 */
function matchSubjects(events, subjects) {
  const candidates = subjects
    .filter(s => s.nom && COLOR_PATTERN.test(s.couleur || ''))
    .map(prepareSubject)
    .sort((a, b) => (b.name || '').length - (a.name || '').length);

  return events.map(event => {
    const title = event.titre || '';
    const text = `${title}\n${event.description || ''}`.toUpperCase();
    const normalizedTitle = normalize(title);

    const found = candidates.find(c => c.code && c.code.test(text))
      || candidates.find(c => c.name && normalizedTitle.includes(c.name));

    return { ...event, matiere: found ? found.subject : null };
  });
}

module.exports = { matchSubjects };
