// Extraction d'adresses e-mail depuis un texte libre : liste collée depuis un
// tableur, export CSV de l'ENT ou de Pronote, un e-mail par ligne, séparés par
// des virgules ou des points-virgules... Les doublons sont retirés (sans tenir
// compte de la casse), dans l'ordre d'apparition.

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function extractEmails(text) {
  const found = String(text || '').match(EMAIL_PATTERN) || [];
  const seen = new Set();
  const emails = [];
  for (const raw of found) {
    const email = raw.toLowerCase().replace(/\.+$/, '');
    if (seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}
