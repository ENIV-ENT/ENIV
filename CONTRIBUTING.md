# Contributing to Eniv

Thanks for helping! This guide covers the workflow (branches, commits, pull requests) and the naming and writing conventions every change must follow. `npm run lint` checks part of them automatically; the rest is checked in review.

## Workflow

1. Create a branch named after the topic: `feature/…`, `fix/…`, `security/…`, `refactor/…`, `docs/…`, `ci/…`.
2. Make **small, separate** commits following [Conventional Commits](https://www.conventionalcommits.org/), written in English:

   ```text
   feat(assignments): drag and drop attachments
   fix(auth): return 400 when the password is missing
   docs(readme): architecture diagram
   ```

   | Type | Use |
   |---|---|
   | `feat` | new feature |
   | `fix` | bug fix |
   | `refactor` | restructuring without behavior change |
   | `test` | adding or fixing tests |
   | `docs` | documentation |
   | `ci` / `chore` | tooling, CI, dependencies |

3. Before pushing, run `npm run lint` and `npm test`.
4. Open a pull request in English, following the template: explain the **why**, the **before / after** and **how it was tested**. Issues are written in English too.

## Language

The code base is written in English; the product is in French.

| What | Language |
|---|---|
| Identifiers (variables, functions, classes, constants), file names, CSS classes, HTML ids and `data-*` attributes | English |
| JSDoc | English |
| Server logs (`console.*`) and test titles | English |
| Commits, pull requests, issues, `CONTRIBUTING.md` | English |
| Everything users see: HTML text, `{ error: '…' }` messages sent to the client, emails, push notifications, Discord messages, MCP tool descriptions | French |

### Comments

Do not write comments in the code (JavaScript, CSS, HTML). Make the code explain itself with clear names and small functions. When the reason behind a module, a class or a function is not obvious (a security constraint, a browser quirk, a contract that must not change), document it with a JSDoc block in English on that module, class or function:

```js
/**
 * Signs a short-lived link to an attached file.
 * The signing key is regenerated on every restart, so links never outlive the process.
 * @param {number} fileId
 * @returns {string}
 */
function createFileToken(fileId) { … }
```

Configuration files that are not code (`.github/workflows/*.yml`, `compose.y*ml`, `Dockerfile`, `deploy.sh`, `.env.example`) keep their comments, in English: they document operations.

## Casing

| What | Rule | Examples |
|---|---|---|
| Variables, functions, Express route parameters | camelCase | `loadAssignments`, `subjectId`, `/:assignmentId` |
| Acronyms | written as a word | `convertToPdf`, `escapeHtml`, `parseIcs`, `generateQuizWithAi` |
| Classes | PascalCase, errors end with `Error` | `DbHelper`, `IcsError` |
| Module constants | UPPER_SNAKE_CASE | `MAX_UPLOAD_SIZE`, `ASSIGNMENT_SQL` |
| JavaScript files | camelCase, also for files exporting a class | `dbHelper.js`, `timetableSubjects.js` |
| Test files | `<module>.test.js`, or `<module>.<scenario>.test.js` | `push.test.js`, `assignments.validation.test.js` |
| CSS and JSON files, CSS classes, HTML ids, `data-*` attributes, CSS custom properties | kebab-case, BEM `--` modifiers allowed | `timetable.css`, `.timetable-lesson--short`, `#add-subject-color`, `--timetable-hours` |
| New migrations | `NNN_snake_case.js`, in English | `023_add_reminder_hour_to_users.js` |
| New tables and columns | snake_case, in English | `reminder_hour` |
| New API routes | kebab-case English plural nouns, REST style, no verb in the path | `GET /api/push/subscriptions`, `DELETE /api/push/subscriptions/:id` |
| JSON fields | a field mirroring a column keeps the column name; computed fields are camelCase English | `matiere_nom`, `hasQuiz` |
| localStorage keys, cache names, cookies | kebab-case, prefixed with `eniv-` | `eniv-quiz-…` |
| Environment variables | UPPER_SNAKE_CASE | `BASE_URL` |

### Frozen names and the boundary rule

Many existing names are part of a public contract and **must not be renamed**, even though they are French or do not follow the table above (see [Frozen contracts](#frozen-contracts)). Code that reads or writes them keeps the frozen name as a **property**, but always binds it to an **English local name**:

```js
const { titre: title, matiere_id: subjectId } = req.body;
const assignment = await db.get('SELECT * FROM devoirs WHERE id = ?', [assignmentId]);
res.json({ matiere_nom: subject.nom, hasQuiz });
```

ESLint enforces it: `camelcase` ignores properties but rejects snake_case local names, and `id-match` rejects declarations built on French words.

## Glossary

Use these English words for the domain. The right column lists the frozen French names you will meet in the database, the API and the URLs.

| French | In code | Frozen names |
|---|---|---|
| devoir | `assignment` | table `devoirs`, `devoir_id`, `/api/devoirs`, `devoirId` in realtime messages |
| classe | `class` in compounds (`classId`, `notifyClass`), `schoolClass` for a standalone variable (`class` is reserved) | `classe_id`, `classe_nom` |
| matière | `subject` | table `matieres`, `matiere_id`, `matiere_nom` |
| élève | `student` | role `'eleve'`, `/api/admin/eleves` |
| établissement | `school` | table `etablissements`, `etablissement_id`, `etab_id` |
| commentaire | `comment` | table `devoir_commentaires`, `/api/devoirs/:id/commentaires` |
| emploi du temps | `timetable` | `/api/emploi-temps`, `/emploi-du-temps/`, table `emploi_temps_ics` |
| cours (timetable entry) | `lesson` | `evenements` |
| fichier, document | `file` | table `devoir_fichiers`, `/api/fichiers` |
| jeton | `token` | |
| statut, fait | `status`, `done` | table `devoir_statuts`, column `fait` |
| rappel de la veille | `dayBeforeReminder` | preference `rappel_veille` |
| récapitulatif | `summary` | |
| demande d'adhésion | `joinRequest` | table `join_requests` |
| demande d'établissement | `schoolRequest` | table `etablissement_requests` |
| paramètres | `settings` | |

## Frozen contracts

These names are seen by users, by clients we do not control or by stored data. Renaming them breaks something outside the code base, so they stay as they are. New contracts follow the rules above.

| Contract | Why it is frozen |
|---|---|
| API routes (`/api/*`), WebSocket path `/ws` | cached by installed PWAs, used by the smoke test and the healthcheck |
| Page URLs (`/dashboard/`, `/emploi-du-temps/`, `/devoir-pdf/`…) and their query parameters | served by Caddy on the VPS, linked from emails, push notifications, calendar feeds and bookmarks |
| Tables, columns, enum values | renaming needs a migration and changes API fields, since many routes return rows as they are |
| Migration file names | migrations are tracked by file name: a renamed migration runs again at startup and fails |
| JSON stored in columns (`devoir_quiz.questions_json`, `devoir_logs.details`, `emploi_temps_ics.evenements`) | existing rows keep the old keys |
| MCP tool names, arguments and outputs | saved in users' assistant setups; new tools keep the existing French snake_case style so the tool set stays consistent |
| Calendar feed URL and event `UID`s | subscribed calendars would stop updating or duplicate every event |
| localStorage keys (`token`, `theme`, `push-logout-choice`, `eniv-quiz-*`), cookie `eniv_session`, cache `eniv-api`, JWT claim `userId`, setting `push_vapid_keys` | renaming logs every user out or drops their saved data and push subscriptions |
| Push and realtime payloads (`resource`, `devoirId`, notification tags), push preference keys | read by service workers and pages already installed on devices |
| Names imposed by third parties (Web Push, Discord, data.gouv APIs) | not ours |

## Lint

`npm run lint` runs ESLint with the recommended rules and the naming rules; `npm run lint:fix` fixes what can be fixed automatically. The CI runs it on every pull request.
