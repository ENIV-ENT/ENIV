import { apiCall, checkAuth } from '../utils/api.js';
import { escapeHtml, toggleModal, setupModalClose } from '../utils/dom.js';
import { mountHeader, setHeaderUser } from '../components/header.js';

/**
 * Class timetable page.
 *
 * Lessons are shown in the school's time zone, whatever the device's time zone.
 * Days are handled as "YYYY-MM-DD" keys: do not use localDate (UTC midnight)
 * here.
 * @module timetable
 */
const TIME_ZONE = 'Europe/Paris';
const DAY_MS = 24 * 60 * 60 * 1000;
const START_HOUR = 8;
const END_HOUR = 18;
/** Shortest break shown between two lessons (day view). */
const MIN_BREAK_MINUTES = 15;
/** In the grid, a lesson this short only has room for one line of title. */
const SHORT_LESSON_MINUTES = 75;
/** Past this length, a timed event is shown with the all-day events. */
const ALL_DAY_MIN_MS = 10 * 60 * 60 * 1000;
/** The page can stay open for a whole day. */
const RELOAD_MS = 15 * 60 * 1000;

const SHORT_DAY_NAMES = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});
/** Day keys are converted to UTC midnight, so they are formatted in UTC. */
const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' });
const longDayFormatter = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

const state = {
  auth: null,
  lessons: [],
  allDayEvents: [],
  updatedAt: null,
  offline: false,
  week: null,
  day: null,
  firstWeek: null,
  lastWeek: null
};

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
  return new Date(keyToDate(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** @returns {number} 0 for Monday */
function dayIndex(key) {
  return (keyToDate(key).getUTCDay() + 6) % 7;
}

function mondayOf(key) {
  return addDays(key, -dayIndex(key));
}

function formatHour(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** "1 novembre" → "1er novembre" */
function withOrdinalFirst(text) {
  return text.replace(/(^|\s)1(?=\s)/, '$11er');
}

function formatDayMonth(key) {
  return withOrdinalFirst(dayMonthFormatter.format(keyToDate(key)));
}

function formatLongDay(key) {
  return withOrdinalFirst(longDayFormatter.format(keyToDate(key)));
}

function formatInstant(date) {
  const { key, minutes } = parisParts(date);
  return `${formatDayMonth(key)} à ${formatHour(minutes)}`;
}

/** "19 au 23 octobre", or "28 octobre au 1er novembre" across two months. */
function formatWeek(firstDay, lastDay) {
  const start = firstDay.slice(0, 7) === lastDay.slice(0, 7)
    ? withOrdinalFirst(String(keyToDate(firstDay).getUTCDate()))
    : formatDayMonth(firstDay);
  return `${start} au ${formatDayMonth(lastDay)}`;
}

function formatUpdatedAt(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);

  if (minutes < 1) return "Mis à jour à l'instant";
  if (minutes < 60) return `Mis à jour il y a ${minutes} min`;
  if (minutes < 24 * 60) return `Mis à jour il y a ${Math.floor(minutes / 60)} h`;
  return `Mis à jour le ${formatInstant(date)}`;
}

/**
 * Splits the lesson type (CM, TD, TP) from the rest of the title.
 * "[ALT] TD - Anglais G01" → { type: 'TD', title: 'Anglais G01' }
 */
function parseTitle(title) {
  const prefix = /^(?:\[[^\]]*\]\s*)?(CM|TD|TP)\b\s*[-–:]?\s*/i.exec(title);
  if (prefix && title.length > prefix[0].length) {
    return { type: prefix[1].toUpperCase(), title: title.slice(prefix[0].length) };
  }

  const elsewhere = /\b(CM|TD|TP)\b/.exec(title);
  return { type: elsewhere ? elsewhere[1] : null, title };
}

/**
 * Turns the events of the API into timed lessons and all-day events.
 *
 * A lesson running past midnight is cut at midnight. A very long time range
 * (internship period, 7 h – 24 h…) would crush the grid, so it is shown as an
 * all-day event that keeps its hours in `timeRange`.
 */
function prepare(events) {
  const lessons = [];
  const allDayEvents = [];

  events.forEach((event, index) => {
    const { type, title } = parseTitle(event.titre || 'Sans titre');
    const base = { ...event, index, type, shortTitle: title };

    if (event.journee) {
      allDayEvents.push({ ...base, startDay: event.debut, endDay: event.fin });
      return;
    }

    const start = new Date(event.debut);
    const end = new Date(event.fin);
    const s = parisParts(start);
    const e = parisParts(end);
    const endMin = e.key === s.key ? e.minutes : 24 * 60;

    if (end - start >= ALL_DAY_MIN_MS) {
      const endDay = e.minutes === 0 ? e.key : addDays(e.key, 1);
      allDayEvents.push({
        ...base,
        startDay: s.key,
        endDay: endDay > s.key ? endDay : addDays(s.key, 1),
        timeRange: { startMin: s.minutes, endMin, multiDay: e.key !== s.key && e.minutes !== 0 }
      });
      return;
    }

    lessons.push({
      ...base,
      startDate: start,
      endDate: end,
      day: s.key,
      startMin: s.minutes,
      endMin: Math.max(endMin, s.minutes + 15)
    });
  });

  return { lessons: mergeConsecutive(lessons), allDayEvents };
}

/**
 * Merges identical lessons that follow each other without a break: exports
 * often split a two-hour TD into two one-hour slots. Identical means same type,
 * title, room and description (teacher, groups): a CM followed by a TD of the
 * same subject stays as two blocks. Only the display is affected.
 *
 * The last lesson kept for each content is remembered, so that a parallel
 * lesson (another group) between the two slots does not prevent the merge.
 * @param {Array} lessons - Sorted by start
 */
function mergeConsecutive(lessons) {
  const merged = [];
  const lastByContent = new Map();

  for (const lesson of lessons) {
    const key = JSON.stringify([lesson.type, lesson.titre, lesson.lieu, lesson.description]);
    const previous = lastByContent.get(key);

    if (previous && previous.day === lesson.day && previous.endDate.getTime() === lesson.startDate.getTime()) {
      previous.endDate = lesson.endDate;
      previous.fin = lesson.fin;
      previous.endMin = lesson.endMin;
      continue;
    }

    const copy = { ...lesson };
    merged.push(copy);
    lastByContent.set(key, copy);
  }

  return merged;
}

/**
 * Spreads overlapping lessons of one day into side-by-side lanes.
 * @param {Array} lessons - Lessons of one day, sorted by start
 */
function placeInLanes(lessons) {
  const placed = [];
  let cluster = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    const lanes = Math.max(...cluster.map(l => l.lane)) + 1;
    cluster.forEach(l => { l.lanes = lanes; });
    cluster = [];
    clusterEnd = -1;
  };

  for (const lesson of lessons) {
    if (cluster.length && lesson.startMin >= clusterEnd) closeCluster();

    const taken = new Set(cluster.filter(l => l.endMin > lesson.startMin).map(l => l.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;

    const item = { ...lesson, lane };
    cluster.push(item);
    placed.push(item);
    clusterEnd = Math.max(clusterEnd, lesson.endMin);
  }

  if (cluster.length) closeCluster();
  return placed;
}

/** Days shown for a week: Saturday and Sunday only appear when they have lessons. */
function daysOfWeek(week, weekLessons, weekAllDay) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(week, i);
    const busy = weekLessons.some(l => l.day === key) || weekAllDay.some(a => covers(a, key));
    if (i < 5 || busy) days.push(key);
  }
  return days;
}

/** The end day is exclusive, as in the source calendar. */
function covers(allDayEvent, key) {
  return allDayEvent.startDay <= key && key < allDayEvent.endDay;
}

function hourRange(weekLessons) {
  let start = START_HOUR;
  let end = END_HOUR;
  for (const lesson of weekLessons) {
    start = Math.min(start, Math.floor(lesson.startMin / 60));
    end = Math.max(end, Math.ceil(lesson.endMin / 60));
  }
  return { start, end };
}

/** The current lesson, or else the next one: that is what users come looking for. */
function highlightedLesson(now) {
  return state.lessons.find(l => l.endDate > now) || null;
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/**
 * Color of a lesson: the subject color when the class has subjects recognized
 * in its timetable (other lessons stay neutral), otherwise a tint per type.
 */
function appearance(lesson) {
  if (state.bySubject) {
    const color = lesson.matiere?.couleur;
    return color && HEX_COLOR.test(color)
      ? { className: 'timetable-lesson--subject', style: `--timetable-subject: ${color}` }
      : { className: 'timetable-lesson--other', style: '' };
  }
  return { className: lesson.type ? `timetable-lesson--${lesson.type.toLowerCase()}` : 'timetable-lesson--other', style: '' };
}

function highlightLabel(lesson, now) {
  return lesson.startDate <= now ? 'En cours' : 'Prochain cours';
}

function renderLessonBlock(lesson, { highlight, now, style = '' }) {
  const isHighlighted = highlight && highlight.index === lesson.index;
  const { className, style: colorStyle } = appearance(lesson);
  const classes = ['timetable-lesson', className];
  if (isHighlighted) classes.push('timetable-lesson--highlight');
  if (lesson.endMin - lesson.startMin <= SHORT_LESSON_MINUTES) classes.push('timetable-lesson--short');
  const styles = [style, colorStyle].filter(Boolean).join('; ');

  return `
    <button type="button" class="${classes.join(' ')}" title="${escapeHtml(lesson.titre)}"
      data-index="${lesson.index}" ${styles ? `style="${styles}"` : ''}>
      ${isHighlighted ? `<span class="timetable-highlight">${highlightLabel(lesson, now)}</span>` : ''}
      <span class="timetable-lesson-title">${lesson.type ? `<span class="timetable-lesson-type">${lesson.type}</span> ` : ''}${escapeHtml(lesson.shortTitle)}</span>
      ${lesson.lieu ? `<span class="timetable-lesson-room">${escapeHtml(lesson.lieu)}</span>` : ''}
      <span class="timetable-lesson-time">${formatHour(lesson.startMin)} – ${formatHour(lesson.endMin)}</span>
    </button>`;
}

function renderAllDayEvents(allDayEvents) {
  return allDayEvents.map(event => {
    const { className, style } = appearance(event);
    return `
      <button type="button" class="timetable-all-day ${className}" data-index="${event.index}" ${style ? `style="${style}"` : ''}>${escapeHtml(event.titre)}</button>`;
  }).join('');
}

function renderGrid(days, weekLessons, weekAllDay, today, now, highlight) {
  const range = hourRange(weekLessons);
  const hours = range.end - range.start;
  const rangeStart = range.start * 60;
  const rangeLength = hours * 60;
  const { minutes: nowMinutes } = parisParts(now);

  const header = days.map(key => {
    const allDay = weekAllDay.filter(a => covers(a, key));
    return `
      <div class="timetable-header-day${key === today ? ' timetable-is-today' : ''}">
        <span class="timetable-day-name">${SHORT_DAY_NAMES[dayIndex(key)]} ${keyToDate(key).getUTCDate()}</span>
        ${allDay.length ? `<div class="timetable-all-days">${renderAllDayEvents(allDay)}</div>` : ''}
      </div>`;
  }).join('');

  const ticks = Array.from({ length: hours }, (_, i) => `
    <span class="timetable-tick" style="top: ${(i / hours) * 100}%">${range.start + i} h</span>
  `).join('');

  const columns = days.map(key => {
    const blocks = placeInLanes(weekLessons.filter(l => l.day === key)).map(lesson => {
      const top = ((lesson.startMin - rangeStart) / rangeLength) * 100;
      const height = ((lesson.endMin - lesson.startMin) / rangeLength) * 100;
      const width = 100 / lesson.lanes;
      const style = `top: ${top}%; height: ${height}%; left: ${lesson.lane * width}%; width: ${width}%`;
      return renderLessonBlock(lesson, { highlight, now, style });
    }).join('');

    const nowLine = key === today && nowMinutes >= rangeStart && nowMinutes <= rangeStart + rangeLength
      ? `<div class="timetable-now" style="top: ${((nowMinutes - rangeStart) / rangeLength) * 100}%" aria-hidden="true"></div>`
      : '';

    return `<div class="timetable-column${key === today ? ' timetable-is-today' : ''}">${blocks}${nowLine}</div>`;
  }).join('');

  return `
    <div class="timetable-grid" style="--timetable-days: ${days.length}; --timetable-hours: ${hours}">
      <div class="timetable-header">
        <div class="timetable-corner"></div>
        ${header}
      </div>
      <div class="timetable-body">
        <div class="timetable-ticks" aria-hidden="true">${ticks}</div>
        ${columns}
      </div>
    </div>`;
}

function renderDayStrip(days, weekLessons, weekAllDay, today) {
  return `
    <div class="timetable-strip" role="group" aria-label="Jour affiché">
      ${days.map(key => {
        const empty = !weekLessons.some(l => l.day === key) && !weekAllDay.some(a => covers(a, key));
        const classes = ['timetable-strip-day'];
        if (key === today) classes.push('timetable-is-today');
        if (empty) classes.push('timetable-strip-day--empty');
        return `
          <button type="button" class="${classes.join(' ')}" data-day="${key}" aria-pressed="${key === state.day}">
            <span>${SHORT_DAY_NAMES[dayIndex(key)]}</span>
            <span class="timetable-strip-number">${keyToDate(key).getUTCDate()}</span>
          </button>`;
      }).join('')}
    </div>`;
}

function renderDayList(key, weekLessons, weekAllDay, now, highlight) {
  const lessons = weekLessons.filter(l => l.day === key);
  const allDay = weekAllDay.filter(a => covers(a, key));

  if (!lessons.length && !allDay.length) {
    const when = key === parisParts(now).key ? "aujourd'hui" : 'ce jour-là';
    return `<p class="timetable-empty-day">Aucun cours ${when}.</p>`;
  }

  const items = [];
  if (allDay.length) {
    items.push(`<li class="timetable-list-all-days">${renderAllDayEvents(allDay)}</li>`);
  }

  lessons.forEach((lesson, i) => {
    const previous = lessons[i - 1];
    if (previous && lesson.startMin - previous.endMin >= MIN_BREAK_MINUTES) {
      items.push(`<li class="timetable-break">Pause de ${formatDuration(lesson.startMin - previous.endMin)}</li>`);
    }
    items.push(`
      <li class="timetable-list-item">
        <span class="timetable-list-time">${formatHour(lesson.startMin)}</span>
        ${renderLessonBlock(lesson, { highlight, now })}
      </li>`);
  });

  return `<ol class="timetable-list">${items.join('')}</ol>`;
}

function renderEmptyWeek(week) {
  const weekEnd = addDays(week, 7);
  const next = state.lessons.find(l => l.day >= weekEnd);

  return `
    <div class="timetable-state">
      <p>Aucun cours cette semaine.</p>
      ${next ? `
        <p class="timetable-state-detail">Prochain cours le ${formatLongDay(next.day)}.</p>
        <button type="button" class="btn-primary" data-go-to="${mondayOf(next.day)}">Voir cette semaine</button>
      ` : ''}
    </div>`;
}

/**
 * Renders the selected week. "Semaine du" is hidden on mobile for lack of room.
 * The content is rebuilt every minute, so the keyboard focus is restored.
 */
function render() {
  const now = new Date();
  const today = parisParts(now).key;
  const week = state.week;
  const weekEnd = addDays(week, 7);

  const weekLessons = state.lessons.filter(l => l.day >= week && l.day < weekEnd);
  const weekAllDay = state.allDayEvents.filter(a => a.startDay < weekEnd && a.endDay > week);
  const days = daysOfWeek(week, weekLessons, weekAllDay);
  const highlight = highlightedLesson(now);

  if (!days.includes(state.day)) {
    state.day = days.includes(today)
      ? today
      : days.find(key => weekLessons.some(l => l.day === key)) || days[0];
  }

  document.getElementById('timetable-week').innerHTML =
    `<span class="timetable-week-prefix">Semaine du </span>${formatWeek(week, days[days.length - 1])}`;
  document.getElementById('timetable-previous').disabled = !state.firstWeek || week <= state.firstWeek;
  document.getElementById('timetable-next').disabled = !state.lastWeek || week >= state.lastWeek;
  document.getElementById('timetable-today').disabled = week === mondayOf(today);
  document.getElementById('timetable-updated').textContent = formatUpdatedAt(state.updatedAt);

  const content = document.getElementById('timetable-content');
  const focus = focusedSelector(content);

  if (!weekLessons.length && !weekAllDay.length) {
    content.innerHTML = renderEmptyWeek(week);
  } else {
    content.innerHTML = `
      <div class="timetable-week-view">${renderGrid(days, weekLessons, weekAllDay, today, now, highlight)}</div>
      <div class="timetable-day-view">
        ${renderDayStrip(days, weekLessons, weekAllDay, today)}
        ${renderDayList(state.day, weekLessons, weekAllDay, now, highlight)}
      </div>`;
  }

  if (focus) content.querySelector(focus)?.focus();
}

/** Selector of the focused element, within the visible view (week or day). */
function focusedSelector(content) {
  const active = document.activeElement;
  if (!active || !content.contains(active)) return null;

  const view = active.closest('.timetable-week-view') ? '.timetable-week-view ' : active.closest('.timetable-day-view') ? '.timetable-day-view ' : '';
  if (active.dataset.index) return `${view}[data-index="${active.dataset.index}"]`;
  if (active.dataset.day) return `${view}[data-day="${active.dataset.day}"]`;
  return null;
}

function renderState(message, action = '') {
  document.getElementById('timetable-nav').classList.add('hidden');
  document.getElementById('timetable-content').innerHTML = `
    <div class="timetable-state">
      <p>${message}</p>
      ${action}
    </div>`;
}

/** Same content as the initial loader of the page. */
function showLoading() {
  document.getElementById('timetable-content').innerHTML = `
    <div class="timetable-state" role="status">
      <span class="timetable-spinner" aria-hidden="true"></span>
      <p>Chargement de l'emploi du temps…</p>
    </div>`;
}

function showOfflineBanner() {
  const banner = document.getElementById('timetable-banner');
  if (state.offline && state.updatedAt) {
    banner.textContent = `La source de l'emploi du temps ne répond pas. Affichage de la version du ${formatInstant(new Date(state.updatedAt))}.`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

let lessonTrigger = null;

function openLesson(index) {
  const lesson = state.lessons.find(x => x.index === index) || state.allDayEvents.find(x => x.index === index);
  if (!lesson) return;
  lessonTrigger = document.activeElement;

  let when;
  if (lesson.timeRange && !lesson.timeRange.multiDay) {
    when = `${formatLongDay(lesson.startDay)}, ${formatHour(lesson.timeRange.startMin)} – ${formatHour(lesson.timeRange.endMin)}`;
  } else if (lesson.timeRange || lesson.journee) {
    const lastDay = addDays(lesson.endDay, -1);
    when = lastDay === lesson.startDay
      ? `${formatLongDay(lesson.startDay)}, toute la journée`
      : `Du ${formatLongDay(lesson.startDay)} au ${formatLongDay(lastDay)}`;
  } else {
    when = `${formatLongDay(lesson.day)}, ${formatHour(lesson.startMin)} – ${formatHour(lesson.endMin)}`;
  }

  const rows = [
    ['Quand', escapeHtml(when.charAt(0).toUpperCase() + when.slice(1))],
    lesson.lieu && ['Salle', escapeHtml(lesson.lieu)],
    lesson.matiere && ['Matière', escapeHtml(lesson.matiere.nom)],
    lesson.type && ['Type', lesson.type],
    lesson.description && ['Détails', lesson.description.split('\n').map(escapeHtml).join('<br>')]
  ].filter(Boolean);

  document.getElementById('lesson-modal-title').textContent = lesson.titre || 'Sans titre';
  document.getElementById('lesson-modal-body').innerHTML = `
    <dl class="timetable-details">
      ${rows.map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join('')}
    </dl>`;
  toggleModal('lesson-modal', true);
  document.getElementById('lesson-modal-close').focus();
}

function requestedWeek() {
  const param = new URLSearchParams(location.search).get('semaine');
  return param && /^\d{4}-\d{2}-\d{2}$/.test(param) && !Number.isNaN(keyToDate(param).getTime())
    ? mondayOf(param)
    : null;
}

/** On weekends, once the lessons of the week are over, the next week is shown. */
function defaultWeek() {
  const now = new Date();
  const today = parisParts(now).key;
  const week = mondayOf(today);

  const lessonsLeftThisWeek = state.lessons.some(l => l.endDate > now && l.day < addDays(week, 7));
  return dayIndex(today) >= 5 && !lessonsLeftThisWeek ? addDays(week, 7) : week;
}

function goToWeek(week, { keepDay = false } = {}) {
  state.week = week;
  if (!keepDay) state.day = null;

  const url = new URL(location.href);
  if (week === defaultWeek()) url.searchParams.delete('semaine');
  else url.searchParams.set('semaine', week);
  history.replaceState(null, '', url);

  render();
}

/**
 * Loads the timetable. Unless it is a background reload, no timetable is shown
 * yet (page opening, "Réessayer") and the source can be slow, so a loader is
 * displayed. A failed background reload keeps the current display.
 */
async function load({ silent = false } = {}) {
  if (!silent) showLoading();
  const data = await apiCall('/api/emploi-temps');

  if (data.error) {
    if (silent && state.lessons.length) return;
    renderState(
      `Impossible de récupérer l'emploi du temps : ${escapeHtml(data.error)}. Réessayez dans quelques minutes.`,
      '<button type="button" class="btn-primary" data-reload>Réessayer</button>'
    );
    return;
  }

  if (!data.configure) {
    const admin = state.auth?.is_admin;
    renderState(
      "L'emploi du temps de votre classe n'est pas encore relié à Eniv.",
      admin
        ? '<a class="btn-primary timetable-link-button" href="/admin">Ajouter le lien ICS</a>'
        : '<p class="timetable-state-detail">Demandez à l\'administrateur de votre classe d\'ajouter le lien ICS dans ses paramètres.</p>'
    );
    return;
  }

  const { lessons, allDayEvents } = prepare(data.evenements || []);
  Object.assign(state, {
    lessons,
    allDayEvents,
    updatedAt: data.misAJour,
    offline: data.horsLigne,
    bySubject: [...lessons, ...allDayEvents].some(l => l.matiere)
  });

  const starts = [...lessons.map(l => l.day), ...allDayEvents.map(a => a.startDay)].sort();
  state.firstWeek = starts.length ? mondayOf(starts[0]) : null;
  state.lastWeek = starts.length ? mondayOf(starts[starts.length - 1]) : null;

  showOfflineBanner();
  document.getElementById('timetable-nav').classList.remove('hidden');

  if (!state.week) {
    goToWeek(requestedWeek() || defaultWeek());
  } else {
    render();
  }
}

/**
 * Wires the navigation and the lesson dialog. Closing the dialog gives the
 * focus back to the lesson that opened it. The "now" line, the highlighted
 * lesson and "mis à jour il y a" follow the clock, hence the render every
 * minute.
 */
function setupEventListeners() {
  document.getElementById('timetable-previous').addEventListener('click', () => goToWeek(addDays(state.week, -7)));
  document.getElementById('timetable-next').addEventListener('click', () => goToWeek(addDays(state.week, 7)));
  document.getElementById('timetable-today').addEventListener('click', () => goToWeek(mondayOf(parisParts(new Date()).key)));

  document.getElementById('timetable-content').addEventListener('click', (e) => {
    const lesson = e.target.closest('[data-index]');
    if (lesson) return openLesson(Number(lesson.dataset.index));

    const day = e.target.closest('[data-day]');
    if (day) {
      state.day = day.dataset.day;
      return render();
    }

    const goTo = e.target.closest('[data-go-to]');
    if (goTo) return goToWeek(goTo.dataset.goTo);

    if (e.target.closest('[data-reload]')) load();
  });

  setupModalClose('lesson-modal', 'lesson-modal-close');
  document.getElementById('lesson-modal-close').addEventListener('click', () => lessonTrigger?.focus());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('lesson-modal').classList.contains('active')) {
      toggleModal('lesson-modal', false);
      lessonTrigger?.focus();
    }
  });

  setInterval(() => {
    if (state.week) render();
  }, 60 * 1000);
  setInterval(() => load({ silent: true }), RELOAD_MS);
}

async function init() {
  mountHeader({ page: 'timetable' });

  const auth = await checkAuth();
  if (!auth.authenticated) return;
  state.auth = auth;

  setHeaderUser(auth);
  setupEventListeners();
  await load();
}

init();
