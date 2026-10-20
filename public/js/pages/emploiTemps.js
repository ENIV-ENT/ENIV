import { apiCall, checkAuth, logout } from '../utils/api.js';
import { escapeHTML, toggleModal, setupModalClose } from '../utils/dom.js';

// Les cours sont affichés à l'heure de l'établissement, quel que soit le
// fuseau de l'appareil. Les jours sont manipulés sous forme de clés
// « AAAA-MM-JJ » : ne pas utiliser localDate (minuit UTC) ici.
const TIME_ZONE = 'Europe/Paris';
const JOUR_MS = 24 * 60 * 60 * 1000;
const HEURE_DEBUT = 8;
const HEURE_FIN = 18;
// Durée minimale d'une pause affichée entre deux cours (vue mobile)
const PAUSE_MIN = 15;
const SEANCE_COURTE_MIN = 75;
// Au-delà, une séance horaire est rangée avec les journées entières
const JOURNEE_MIN_MS = 10 * 60 * 60 * 1000;
// La page peut rester ouverte toute une journée
const RECHARGEMENT_MS = 15 * 60 * 1000;

const JOURS_COURTS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});
// Les clés de jour sont converties en minuit UTC : formatées en UTC
const jourMoisFormatter = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' });
const jourLongFormatter = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

const state = {
  auth: null,
  cours: [],
  journees: [],
  misAJour: null,
  horsLigne: false,
  semaine: null,
  jour: null,
  premiereSemaine: null,
  derniereSemaine: null
};

// --- Dates ------------------------------------------------------------------

function parisParts(date) {
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map(p => [p.type, p.value]));
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function keyToDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(key, days) {
  return new Date(keyToDate(key).getTime() + days * JOUR_MS).toISOString().slice(0, 10);
}

// 0 = lundi
function dayIndex(key) {
  return (keyToDate(key).getUTCDay() + 6) % 7;
}

function mondayOf(key) {
  return addDays(key, -dayIndex(key));
}

function formatHeure(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

function formatDuree(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// « 1 novembre » → « 1er novembre »
function premier(texte) {
  return texte.replace(/(^|\s)1(?=\s)/, '$11er');
}

function formatJourMois(key) {
  return premier(jourMoisFormatter.format(keyToDate(key)));
}

function formatJourLong(key) {
  return premier(jourLongFormatter.format(keyToDate(key)));
}

function formatInstant(date) {
  const { key, minutes } = parisParts(date);
  return `${formatJourMois(key)} à ${formatHeure(minutes)}`;
}

// « 19 au 23 octobre », ou « 28 octobre au 1er novembre » à cheval sur deux mois
function formatSemaine(premierJour, dernierJour) {
  const debut = premierJour.slice(0, 7) === dernierJour.slice(0, 7)
    ? premier(String(keyToDate(premierJour).getUTCDate()))
    : formatJourMois(premierJour);
  return `${debut} au ${formatJourMois(dernierJour)}`;
}

function formatMiseAJour(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);

  if (minutes < 1) return "Mis à jour à l'instant";
  if (minutes < 60) return `Mis à jour il y a ${minutes} min`;
  if (minutes < 24 * 60) return `Mis à jour il y a ${Math.floor(minutes / 60)} h`;
  return `Mis à jour le ${formatInstant(date)}`;
}

// --- Préparation des cours --------------------------------------------------

/**
 * Sépare le type de séance (CM, TD, TP) du reste du titre.
 * « [ALT] TD - Anglais G01 » → { type: 'TD', titre: 'Anglais G01' }
 */
function analyserTitre(titre) {
  const prefixe = /^(?:\[[^\]]*\]\s*)?(CM|TD|TP)\b\s*[-–:]?\s*/i.exec(titre);
  if (prefixe && titre.length > prefixe[0].length) {
    return { type: prefixe[1].toUpperCase(), titre: titre.slice(prefixe[0].length) };
  }

  const ailleurs = /\b(CM|TD|TP)\b/.exec(titre);
  return { type: ailleurs ? ailleurs[1] : null, titre };
}

function preparer(evenements) {
  const cours = [];
  const journees = [];

  evenements.forEach((evenement, index) => {
    const { type, titre } = analyserTitre(evenement.titre || 'Sans titre');
    const base = { ...evenement, index, type, titreCourt: titre };

    if (evenement.journee) {
      journees.push(base);
      return;
    }

    const debut = new Date(evenement.debut);
    const fin = new Date(evenement.fin);
    const d = parisParts(debut);
    const f = parisParts(fin);
    // Un cours qui déborde sur le lendemain est coupé à minuit
    const finMin = f.key === d.key ? f.minutes : 24 * 60;

    // Une plage horaire très longue (période en entreprise, 7 h – 24 h…)
    // écraserait la grille : elle est affichée comme une journée entière
    if (fin - debut >= JOURNEE_MIN_MS) {
      const finJour = f.minutes === 0 ? f.key : addDays(f.key, 1);
      journees.push({
        ...base,
        debut: d.key,
        fin: finJour > d.key ? finJour : addDays(d.key, 1),
        horaire: { debutMin: d.minutes, finMin, multiJours: f.key !== d.key && f.minutes !== 0 }
      });
      return;
    }

    cours.push({
      ...base,
      debutDate: debut,
      finDate: fin,
      jour: d.key,
      debutMin: d.minutes,
      finMin: Math.max(finMin, d.minutes + 15)
    });
  });

  return { cours: fusionnerSuccessifs(cours), journees };
}

/**
 * Réunit les séances identiques qui s'enchaînent sans pause : les exports
 * découpent souvent un TD de deux heures en deux créneaux d'une heure.
 * Identiques = même type, même titre, même salle et même description
 * (enseignant, groupes) : un CM suivi d'un TD de la même matière reste en
 * deux blocs. Seul l'affichage est concerné.
 * @param {Array} cours - Triés par début
 */
function fusionnerSuccessifs(cours) {
  const fusionnes = [];
  // Dernière séance gardée pour chaque contenu : un cours en parallèle (autre
  // groupe) entre les deux créneaux n'empêche pas la fusion
  const derniere = new Map();

  for (const c of cours) {
    const cle = JSON.stringify([c.type, c.titre, c.lieu, c.description]);
    const precedente = derniere.get(cle);

    if (precedente && precedente.jour === c.jour && precedente.finDate.getTime() === c.debutDate.getTime()) {
      precedente.finDate = c.finDate;
      precedente.fin = c.fin;
      precedente.finMin = c.finMin;
      continue;
    }

    const copie = { ...c };
    fusionnes.push(copie);
    derniere.set(cle, copie);
  }

  return fusionnes;
}

/**
 * Répartit les cours d'une journée qui se chevauchent en couloirs côte à côte.
 * @param {Array} cours - Cours d'un même jour, triés par début
 */
function placerEnCouloirs(cours) {
  const places = [];
  let grappe = [];
  let finGrappe = -1;

  const fermer = () => {
    const couloirs = Math.max(...grappe.map(c => c.couloir)) + 1;
    grappe.forEach(c => { c.couloirs = couloirs; });
    grappe = [];
    finGrappe = -1;
  };

  for (const c of cours) {
    if (grappe.length && c.debutMin >= finGrappe) fermer();

    const occupes = new Set(grappe.filter(g => g.finMin > c.debutMin).map(g => g.couloir));
    let couloir = 0;
    while (occupes.has(couloir)) couloir++;

    const place = { ...c, couloir };
    grappe.push(place);
    places.push(place);
    finGrappe = Math.max(finGrappe, c.finMin);
  }

  if (grappe.length) fermer();
  return places;
}

// --- Semaine affichée -------------------------------------------------------

function joursDeLaSemaine(semaine, coursSemaine, journeesSemaine) {
  const jours = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(semaine, i);
    const occupe = coursSemaine.some(c => c.jour === key) || journeesSemaine.some(j => couvre(j, key));
    // Samedi et dimanche n'apparaissent que s'ils ont des cours
    if (i < 5 || occupe) jours.push(key);
  }
  return jours;
}

// Fin exclusive, comme dans le calendrier source
function couvre(journee, key) {
  return journee.debut <= key && key < journee.fin;
}

function plageHoraire(coursSemaine) {
  let debut = HEURE_DEBUT;
  let fin = HEURE_FIN;
  for (const c of coursSemaine) {
    debut = Math.min(debut, Math.floor(c.debutMin / 60));
    fin = Math.max(fin, Math.ceil(c.finMin / 60));
  }
  return { debut, fin };
}

// Cours en cours, sinon le prochain : c'est l'information que l'on vient chercher
function coursEnRelief(maintenant) {
  return state.cours.find(c => c.finDate > maintenant) || null;
}

// --- Rendu ------------------------------------------------------------------

const COULEUR_HEX = /^#[0-9a-f]{3,8}$/i;

// Couleur de la matière quand la classe a des matières reconnues dans son
// emploi du temps (les autres séances restent neutres) ; sinon teinte par type
function apparence(c) {
  if (state.parMatiere) {
    const couleur = c.matiere?.couleur;
    return couleur && COULEUR_HEX.test(couleur)
      ? { classe: 'edt-cours--matiere', style: `--edt-matiere: ${couleur}` }
      : { classe: 'edt-cours--autre', style: '' };
  }
  return { classe: c.type ? `edt-cours--${c.type.toLowerCase()}` : 'edt-cours--autre', style: '' };
}

function libelleRelief(c, maintenant) {
  return c.debutDate <= maintenant ? 'En cours' : 'Prochain cours';
}

function renderBlocCours(c, { relief, maintenant, style = '' }) {
  const mis = relief && relief.index === c.index;
  const { classe, style: couleur } = apparence(c);
  const classes = ['edt-cours', classe];
  if (mis) classes.push('edt-cours--relief');
  // Dans la grille, une séance courte n'a la place que pour une ligne de titre
  if (c.finMin - c.debutMin <= SEANCE_COURTE_MIN) classes.push('edt-cours--court');
  const styles = [style, couleur].filter(Boolean).join('; ');

  return `
    <button type="button" class="${classes.join(' ')}" title="${escapeHTML(c.titre)}"
      data-index="${c.index}" ${styles ? `style="${styles}"` : ''}>
      ${mis ? `<span class="edt-relief">${libelleRelief(c, maintenant)}</span>` : ''}
      <span class="edt-cours-titre">${c.type ? `<span class="edt-cours-type">${c.type}</span> ` : ''}${escapeHTML(c.titreCourt)}</span>
      ${c.lieu ? `<span class="edt-cours-lieu">${escapeHTML(c.lieu)}</span>` : ''}
      <span class="edt-cours-heure">${formatHeure(c.debutMin)} – ${formatHeure(c.finMin)}</span>
    </button>`;
}

function renderJournees(journees) {
  return journees.map(j => {
    const { classe, style } = apparence(j);
    return `
      <button type="button" class="edt-journee ${classe}" data-index="${j.index}" ${style ? `style="${style}"` : ''}>${escapeHTML(j.titre)}</button>`;
  }).join('');
}

function renderGrille(jours, coursSemaine, journeesSemaine, aujourdhui, maintenant, relief) {
  const plage = plageHoraire(coursSemaine);
  const heures = plage.fin - plage.debut;
  const debutPlage = plage.debut * 60;
  const dureePlage = heures * 60;
  const { minutes: minutesMaintenant } = parisParts(maintenant);

  const entete = jours.map(key => {
    const journees = journeesSemaine.filter(j => couvre(j, key));
    return `
      <div class="edt-entete-jour${key === aujourdhui ? ' edt-aujourdhui-jour' : ''}">
        <span class="edt-jour-nom">${JOURS_COURTS[dayIndex(key)]} ${keyToDate(key).getUTCDate()}</span>
        ${journees.length ? `<div class="edt-journees">${renderJournees(journees)}</div>` : ''}
      </div>`;
  }).join('');

  const graduations = Array.from({ length: heures }, (_, i) => `
    <span class="edt-graduation" style="top: ${(i / heures) * 100}%">${plage.debut + i} h</span>
  `).join('');

  const colonnes = jours.map(key => {
    const blocs = placerEnCouloirs(coursSemaine.filter(c => c.jour === key)).map(c => {
      const top = ((c.debutMin - debutPlage) / dureePlage) * 100;
      const height = ((c.finMin - c.debutMin) / dureePlage) * 100;
      const largeur = 100 / c.couloirs;
      const style = `top: ${top}%; height: ${height}%; left: ${c.couloir * largeur}%; width: ${largeur}%`;
      return renderBlocCours(c, { relief, maintenant, style });
    }).join('');

    const ligne = key === aujourdhui && minutesMaintenant >= debutPlage && minutesMaintenant <= debutPlage + dureePlage
      ? `<div class="edt-maintenant" style="top: ${((minutesMaintenant - debutPlage) / dureePlage) * 100}%" aria-hidden="true"></div>`
      : '';

    return `<div class="edt-colonne${key === aujourdhui ? ' edt-aujourdhui-jour' : ''}">${blocs}${ligne}</div>`;
  }).join('');

  return `
    <div class="edt-grille" style="--edt-jours: ${jours.length}; --edt-heures: ${heures}">
      <div class="edt-entete">
        <div class="edt-coin"></div>
        ${entete}
      </div>
      <div class="edt-corps">
        <div class="edt-graduations" aria-hidden="true">${graduations}</div>
        ${colonnes}
      </div>
    </div>`;
}

function renderBandeJours(jours, coursSemaine, journeesSemaine, aujourdhui) {
  return `
    <div class="edt-bande" role="group" aria-label="Jour affiché">
      ${jours.map(key => {
        const vide = !coursSemaine.some(c => c.jour === key) && !journeesSemaine.some(j => couvre(j, key));
        const classes = ['edt-bande-jour'];
        if (key === aujourdhui) classes.push('edt-aujourdhui-jour');
        if (vide) classes.push('edt-bande-jour--vide');
        return `
          <button type="button" class="${classes.join(' ')}" data-jour="${key}" aria-pressed="${key === state.jour}">
            <span>${JOURS_COURTS[dayIndex(key)]}</span>
            <span class="edt-bande-num">${keyToDate(key).getUTCDate()}</span>
          </button>`;
      }).join('')}
    </div>`;
}

function renderListeJour(key, coursSemaine, journeesSemaine, maintenant, relief) {
  const cours = coursSemaine.filter(c => c.jour === key);
  const journees = journeesSemaine.filter(j => couvre(j, key));

  if (!cours.length && !journees.length) {
    const quand = key === parisParts(maintenant).key ? "aujourd'hui" : 'ce jour-là';
    return `<p class="edt-vide-jour">Aucun cours ${quand}.</p>`;
  }

  const items = [];
  if (journees.length) {
    items.push(`<li class="edt-liste-journees">${renderJournees(journees)}</li>`);
  }

  cours.forEach((c, i) => {
    const precedent = cours[i - 1];
    if (precedent && c.debutMin - precedent.finMin >= PAUSE_MIN) {
      items.push(`<li class="edt-pause">Pause de ${formatDuree(c.debutMin - precedent.finMin)}</li>`);
    }
    items.push(`
      <li class="edt-liste-item">
        <span class="edt-liste-heure">${formatHeure(c.debutMin)}</span>
        ${renderBlocCours(c, { relief, maintenant })}
      </li>`);
  });

  return `<ol class="edt-liste">${items.join('')}</ol>`;
}

function renderSemaineVide(semaine) {
  const finSemaine = addDays(semaine, 7);
  const suivant = state.cours.find(c => c.jour >= finSemaine);

  return `
    <div class="edt-etat">
      <p>Aucun cours cette semaine.</p>
      ${suivant ? `
        <p class="edt-etat-detail">Prochain cours le ${formatJourLong(suivant.jour)}.</p>
        <button type="button" class="btn-primary" data-aller="${mondayOf(suivant.jour)}">Voir cette semaine</button>
      ` : ''}
    </div>`;
}

function render() {
  const maintenant = new Date();
  const aujourdhui = parisParts(maintenant).key;
  const semaine = state.semaine;
  const finSemaine = addDays(semaine, 7);

  const coursSemaine = state.cours.filter(c => c.jour >= semaine && c.jour < finSemaine);
  const journeesSemaine = state.journees.filter(j => j.debut < finSemaine && j.fin > semaine);
  const jours = joursDeLaSemaine(semaine, coursSemaine, journeesSemaine);
  const relief = coursEnRelief(maintenant);

  if (!jours.includes(state.jour)) {
    state.jour = jours.includes(aujourdhui)
      ? aujourdhui
      : jours.find(key => coursSemaine.some(c => c.jour === key)) || jours[0];
  }

  // « Semaine du » est masqué sur mobile, faute de place
  document.getElementById('edt-semaine').innerHTML =
    `<span class="edt-semaine-prefixe">Semaine du </span>${formatSemaine(semaine, jours[jours.length - 1])}`;
  document.getElementById('edt-precedente').disabled = !state.premiereSemaine || semaine <= state.premiereSemaine;
  document.getElementById('edt-suivante').disabled = !state.derniereSemaine || semaine >= state.derniereSemaine;
  document.getElementById('edt-aujourdhui').disabled = semaine === mondayOf(aujourdhui);
  document.getElementById('edt-maj').textContent = formatMiseAJour(state.misAJour);

  const contenu = document.getElementById('edt-contenu');
  // Le contenu est reconstruit chaque minute : le focus clavier doit survivre
  const focus = focusActuel(contenu);

  if (!coursSemaine.length && !journeesSemaine.length) {
    contenu.innerHTML = renderSemaineVide(semaine);
  } else {
    contenu.innerHTML = `
      <div class="edt-vue-semaine">${renderGrille(jours, coursSemaine, journeesSemaine, aujourdhui, maintenant, relief)}</div>
      <div class="edt-vue-jour">
        ${renderBandeJours(jours, coursSemaine, journeesSemaine, aujourdhui)}
        ${renderListeJour(state.jour, coursSemaine, journeesSemaine, maintenant, relief)}
      </div>`;
  }

  if (focus) contenu.querySelector(focus)?.focus();
}

// Sélecteur de l'élément focalisé, dans la vue visible (semaine ou jour)
function focusActuel(contenu) {
  const actif = document.activeElement;
  if (!actif || !contenu.contains(actif)) return null;

  const vue = actif.closest('.edt-vue-semaine') ? '.edt-vue-semaine ' : actif.closest('.edt-vue-jour') ? '.edt-vue-jour ' : '';
  if (actif.dataset.index) return `${vue}[data-index="${actif.dataset.index}"]`;
  if (actif.dataset.jour) return `${vue}[data-jour="${actif.dataset.jour}"]`;
  return null;
}

function renderEtat(message, action = '') {
  document.getElementById('edt-nav').classList.add('hidden');
  document.getElementById('edt-contenu').innerHTML = `
    <div class="edt-etat">
      <p>${message}</p>
      ${action}
    </div>`;
}

function afficherBandeau() {
  const bandeau = document.getElementById('edt-bandeau');
  if (state.horsLigne && state.misAJour) {
    bandeau.textContent = `La source de l'emploi du temps ne répond pas. Affichage de la version du ${formatInstant(new Date(state.misAJour))}.`;
    bandeau.classList.remove('hidden');
  } else {
    bandeau.classList.add('hidden');
  }
}

// --- Détail d'un cours ------------------------------------------------------

let declencheur = null;

function ouvrirCours(index) {
  const c = state.cours.find(x => x.index === index) || state.journees.find(x => x.index === index);
  if (!c) return;
  declencheur = document.activeElement;

  let quand;
  if (c.horaire && !c.horaire.multiJours) {
    quand = `${formatJourLong(c.debut)}, ${formatHeure(c.horaire.debutMin)} – ${formatHeure(c.horaire.finMin)}`;
  } else if (c.horaire || c.journee) {
    const dernier = addDays(c.fin, -1);
    quand = dernier === c.debut
      ? `${formatJourLong(c.debut)}, toute la journée`
      : `Du ${formatJourLong(c.debut)} au ${formatJourLong(dernier)}`;
  } else {
    quand = `${formatJourLong(c.jour)}, ${formatHeure(c.debutMin)} – ${formatHeure(c.finMin)}`;
  }

  const lignes = [
    ['Quand', escapeHTML(quand.charAt(0).toUpperCase() + quand.slice(1))],
    c.lieu && ['Salle', escapeHTML(c.lieu)],
    c.matiere && ['Matière', escapeHTML(c.matiere.nom)],
    c.type && ['Type', c.type],
    c.description && ['Détails', c.description.split('\n').map(escapeHTML).join('<br>')]
  ].filter(Boolean);

  document.getElementById('cours-modal-titre').textContent = c.titre || 'Sans titre';
  document.getElementById('cours-modal-corps').innerHTML = `
    <dl class="edt-details">
      ${lignes.map(([terme, valeur]) => `<dt>${terme}</dt><dd>${valeur}</dd>`).join('')}
    </dl>`;
  toggleModal('cours-modal', true);
  document.getElementById('cours-modal-close').focus();
}

// --- Chargement -------------------------------------------------------------

function semaineDemandee() {
  const param = new URLSearchParams(location.search).get('semaine');
  return param && /^\d{4}-\d{2}-\d{2}$/.test(param) && !Number.isNaN(keyToDate(param).getTime())
    ? mondayOf(param)
    : null;
}

function semaineParDefaut() {
  const maintenant = new Date();
  const aujourdhui = parisParts(maintenant).key;
  const semaine = mondayOf(aujourdhui);

  // Le week-end, une fois les cours de la semaine terminés, on montre la suivante
  const resteCetteSemaine = state.cours.some(c => c.finDate > maintenant && c.jour < addDays(semaine, 7));
  return dayIndex(aujourdhui) >= 5 && !resteCetteSemaine ? addDays(semaine, 7) : semaine;
}

function allerA(semaine, { garderJour = false } = {}) {
  state.semaine = semaine;
  if (!garderJour) state.jour = null;

  const url = new URL(location.href);
  if (semaine === semaineParDefaut()) url.searchParams.delete('semaine');
  else url.searchParams.set('semaine', semaine);
  history.replaceState(null, '', url);

  render();
}

async function charger({ silencieux = false } = {}) {
  const data = await apiCall('/api/emploi-temps');

  if (data.error) {
    // Un rechargement en arrière-plan qui échoue garde l'affichage actuel
    if (silencieux && state.cours.length) return;
    renderEtat(
      `Impossible de récupérer l'emploi du temps : ${escapeHTML(data.error)}. Réessayez dans quelques minutes.`,
      '<button type="button" class="btn-primary" data-recharger>Réessayer</button>'
    );
    return;
  }

  if (!data.configure) {
    const admin = state.auth?.is_admin;
    renderEtat(
      "L'emploi du temps de votre classe n'est pas encore relié à Eniv.",
      admin
        ? '<a class="btn-primary edt-lien-bouton" href="/admin">Ajouter le lien ICS</a>'
        : '<p class="edt-etat-detail">Demandez à l\'administrateur de votre classe d\'ajouter le lien ICS dans ses paramètres.</p>'
    );
    return;
  }

  const { cours, journees } = preparer(data.evenements || []);
  Object.assign(state, {
    cours,
    journees,
    misAJour: data.misAJour,
    horsLigne: data.horsLigne,
    parMatiere: [...cours, ...journees].some(c => c.matiere)
  });

  const debuts = [...cours.map(c => c.jour), ...journees.map(j => j.debut)].sort();
  state.premiereSemaine = debuts.length ? mondayOf(debuts[0]) : null;
  state.derniereSemaine = debuts.length ? mondayOf(debuts[debuts.length - 1]) : null;

  afficherBandeau();
  document.getElementById('edt-nav').classList.remove('hidden');

  if (!state.semaine) {
    allerA(semaineDemandee() || semaineParDefaut());
  } else {
    render();
  }
}

// --- Menu et événements -----------------------------------------------------

function updateThemeButton(isDark) {
  const themeIcon = document.getElementById('theme-icon');
  const themeText = document.getElementById('theme-text');

  if (isDark) {
    themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    themeText.textContent = 'Thème clair';
  } else {
    themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    themeText.textContent = 'Thème sombre';
  }
}

function setupMenu(auth) {
  const userMenuBtn = document.getElementById('user-menu-btn');
  const userDropdown = document.getElementById('user-dropdown');

  userMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!userDropdown.classList.contains('hidden') && !e.target.closest('.user-menu')) {
      userDropdown.classList.add('hidden');
    }
  });

  const adminBtn = document.getElementById('admin-btn');
  if (auth.is_admin) {
    adminBtn.classList.remove('hidden');
    adminBtn.addEventListener('click', () => { window.location.href = '/admin'; });
  }

  document.getElementById('dashboard-btn').addEventListener('click', () => {
    window.location.href = auth.role === 'superadmin' ? '/superadmin/dashboard' : '/dashboard';
  });
  document.getElementById('settings-btn').addEventListener('click', () => {
    window.location.href = '/settings';
  });
  document.getElementById('notes-btn').addEventListener('click', () => {
    window.open('https://iut-notes.unice.fr', '_blank');
    userDropdown.classList.add('hidden');
  });

  updateThemeButton(document.documentElement.classList.contains('dark-theme'));
  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeButton(isDark);
  });

  document.getElementById('logout-btn').addEventListener('click', logout);
}

function setupEventListeners() {
  document.getElementById('edt-precedente').addEventListener('click', () => allerA(addDays(state.semaine, -7)));
  document.getElementById('edt-suivante').addEventListener('click', () => allerA(addDays(state.semaine, 7)));
  document.getElementById('edt-aujourdhui').addEventListener('click', () => allerA(mondayOf(parisParts(new Date()).key)));

  document.getElementById('edt-contenu').addEventListener('click', (e) => {
    const cours = e.target.closest('[data-index]');
    if (cours) return ouvrirCours(Number(cours.dataset.index));

    const jour = e.target.closest('[data-jour]');
    if (jour) {
      state.jour = jour.dataset.jour;
      return render();
    }

    const aller = e.target.closest('[data-aller]');
    if (aller) return allerA(aller.dataset.aller);

    if (e.target.closest('[data-recharger]')) charger();
  });

  setupModalClose('cours-modal', 'cours-modal-close');
  // Rend le focus au cours qui a ouvert la fenêtre
  document.getElementById('cours-modal-close').addEventListener('click', () => declencheur?.focus());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('cours-modal').classList.contains('active')) {
      toggleModal('cours-modal', false);
      declencheur?.focus();
    }
  });

  // Ligne « maintenant », cours en relief et « mis à jour il y a » suivent l'heure
  setInterval(() => {
    if (state.semaine) render();
  }, 60 * 1000);
  setInterval(() => charger({ silencieux: true }), RECHARGEMENT_MS);
}

async function init() {
  const auth = await checkAuth();
  if (!auth.authenticated) return;
  state.auth = auth;

  document.getElementById('user-info').textContent = auth.username;
  setupMenu(auth);
  setupEventListeners();
  await charger();
}

init();
