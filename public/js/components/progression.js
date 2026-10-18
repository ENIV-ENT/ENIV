import { apiCall } from '../utils/api.js?v=4';
import { escapeHTML, toggleModal, setupModalClose } from '../utils/dom.js?v=2';

// Fenêtre « Ma progression » du tableau de bord, ouverte depuis le menu
// utilisateur. Module autonome : il crée sa propre fenêtre et ne dépend pas de
// l'état de dashboard.js.

const MODAL_ID = 'progression-modal';
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

function creerModal() {
  if (document.getElementById(MODAL_ID)) return;
  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content progression">
      <div class="modal-header">
        <h2>Ma progression</h2>
        <button class="modal-close" id="close-progression-modal" aria-label="Fermer">&times;</button>
      </div>
      <div id="progression-body"><p class="progression-chargement">Calcul en cours…</p></div>
    </div>`;
  document.body.appendChild(modal);
  setupModalClose(MODAL_ID, 'close-progression-modal');
}

function jourCourt(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return JOURS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function dateLongue(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function rendu(p) {
  const taux = p.trente_jours.taux;
  const anneau = taux === null
    ? '<div class="progression-anneau vide"><span>—</span></div>'
    : `<div class="progression-anneau" style="--taux:${taux}"><span>${taux}<small>%</small></span></div>`;

  const maxJour = Math.max(1, ...p.semaine.map((j) => j.total));
  const barres = p.semaine.map((j, i) => {
    const hauteur = Math.round((j.total / maxJour) * 100);
    const faits = j.total - j.restants;
    const titre = `${dateLongue(j.date)} : ${j.total} devoir${j.total > 1 ? 's' : ''}${faits ? `, ${faits} fait${faits > 1 ? 's' : ''}` : ''}`;
    return `<div class="progression-jour" title="${escapeHTML(titre)}">
      <div class="progression-barre" style="--h:${hauteur}%">
        ${j.total ? `<div class="progression-barre-faits" style="--part:${(faits / j.total) * 100}%"></div>` : ''}
      </div>
      <span class="progression-nombre">${j.total || ''}</span>
      <span class="progression-libelle${i === 0 ? ' aujourdhui' : ''}">${i === 0 ? 'auj.' : jourCourt(j.date)}</span>
    </div>`;
  }).join('');

  const matieres = p.par_matiere.map((m) => {
    const pct = Math.round((m.faits / m.total) * 100);
    return `<li>
      <span class="progression-matiere-nom">${escapeHTML(m.nom)}</span>
      <span class="progression-jauge"><span style="width:${pct}%;background:${escapeHTML(m.couleur || 'var(--primary)')}"></span></span>
      <span class="progression-matiere-score">${m.faits}/${m.total}</span>
    </li>`;
  }).join('');

  const rattraper = p.a_rattraper.map((d) => `
    <li><a href="/dashboard/?devoir=${d.id}" style="--couleur:${escapeHTML(d.matiere_couleur || 'var(--secondary)')}">
      <strong>${escapeHTML(d.titre)}</strong>
      <span>${escapeHTML(d.matiere_nom || '')} · ${dateLongue(d.date)}</span>
    </a></li>`).join('');

  return `
    <div class="progression-resume">
      ${anneau}
      <div class="progression-chiffres">
        <p><strong>${p.trente_jours.faits}</strong> devoir${p.trente_jours.faits > 1 ? 's' : ''} fait${p.trente_jours.faits > 1 ? 's' : ''} sur ${p.trente_jours.total} ces 30 derniers jours</p>
        <p>🔥 Série : <strong>${p.serie}</strong> devoir${p.serie > 1 ? 's' : ''} fait${p.serie > 1 ? 's' : ''} d'affilée</p>
        <p>📅 <strong>${p.a_venir.restants}</strong> à faire dans les 7 prochains jours</p>
      </div>
    </div>

    <h3>Les 7 prochains jours</h3>
    <div class="progression-semaine">${barres}</div>

    ${rattraper ? `<h3>⚠️ À rattraper</h3><ul class="progression-rattraper">${rattraper}</ul>` : '<p class="progression-bravo">✅ Rien à rattraper, bravo !</p>'}

    ${matieres ? `<h3>Par matière <small>(30 derniers jours)</small></h3><ul class="progression-matieres">${matieres}</ul>` : ''}`;
}

async function ouvrir() {
  creerModal();
  document.getElementById('user-dropdown')?.classList.add('hidden');
  toggleModal(MODAL_ID, true);

  const body = document.getElementById('progression-body');
  const data = await apiCall('/api/progression');
  body.innerHTML = data.error
    ? `<p class="progression-chargement">${escapeHTML(data.error)}</p>`
    : rendu(data);
}

document.getElementById('progression-btn')?.addEventListener('click', ouvrir);
