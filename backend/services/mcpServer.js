const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const db = require('../models/dbHelper');
const { notifyClass } = require('./realtime');
const { convertToPdf } = require('./fileConverter');
const { extractTextFromPdf } = require('./quizGenerator');
const { toDateString, snapshotAssignment, diffSnapshots, logAssignmentAction } = require('./assignmentLogger');
const push = require('./push');
const pushMessages = require('./pushMessages');
const { findClassSubject } = require('./classMembership');

/**
 * ENIV MCP server: exposes the assignments of the user's class to an AI
 * assistant. One server is created per request (stateless mode), for a user
 * already authenticated by their MCP token.
 *
 * Changes follow the same rules as the REST API: history in devoir_logs and
 * realtime notification of the class.
 *
 * Tool names, arguments, outputs and descriptions are a public contract in
 * French, used by the assistants users connected: they must not change.
 * @module
 */

const UPLOADS_DIR = path.join(__dirname, '../uploads');
const MAX_DOCUMENT_CHARS = 60000;

const INSTRUCTIONS = `ENIV est l'agenda de devoirs partagé d'une classe.
Les devoirs sont communs à toute la classe : en créer, modifier ou supprimer un change ce que voient tous les élèves.
Seul le statut « fait » est personnel à l'utilisateur.
Les dates sont au format AAAA-MM-JJ. Pour créer un devoir, obtenir d'abord l'identifiant de la matière avec lister_matieres.`;

const ASSIGNMENT_SQL = `
  SELECT d.id, d.titre, d.description, d.date, d.matiere_id, m.nom AS matiere,
         u.username AS cree_par, d.created_at, COALESCE(ds.fait, 0) AS fait
  FROM devoirs d
  LEFT JOIN matieres m ON d.matiere_id = m.id
  LEFT JOIN users u ON d.created_by = u.id
  LEFT JOIN devoir_statuts ds ON d.id = ds.devoir_id AND ds.user_id = ?`;

/** Assignment with its subject name, for the log snapshots (as in routes/assignments.js). */
const ASSIGNMENT_WITH_SUBJECT_SQL = `
  SELECT d.*, m.nom as matiere_nom
  FROM devoirs d
  LEFT JOIN matieres m ON d.matiere_id = m.id
  WHERE d.id = ? AND d.classe_id = ?`;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const idSchema = z.number().int().positive();

function formatAssignment(row) {
  return {
    id: row.id,
    titre: row.titre,
    description: row.description || null,
    pour_le: toDateString(row.date),
    matiere_id: row.matiere_id,
    matiere: row.matiere,
    fait: Boolean(row.fait),
    cree_par: row.cree_par,
    cree_le: toDateString(row.created_at)
  };
}

function ok(data) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Today's date in France (the container runs in UTC): YYYY-MM-DD. */
function todayString() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

/**
 * Creates the MCP server of a user. Every piece of data belongs to the user's
 * class: without a class, no tool makes sense. logAssignmentAction expects an
 * Express request, of which only req.user is read.
 * @param {Object} user - row of the users table
 */
function createMcpServer(user) {
  const server = new McpServer(
    { name: 'eniv', title: 'ENIV — devoirs', version: '1.0.0' },
    { instructions: INSTRUCTIONS }
  );

  const classId = user.classe_id;
  const logReq = { user };

  const notify = (assignmentId, method) => notifyClass(classId, {
    type: 'update',
    resource: 'devoirs',
    devoirId: assignmentId,
    method,
    at: Date.now()
  });

  const withClass = (handler) => async (args) => {
    if (!classId) return fail("Ce compte n'est associé à aucune classe.");
    try {
      return await handler(args);
    } catch (error) {
      console.error('MCP tool error:', error);
      return fail('Erreur interne du serveur ENIV.');
    }
  };

  const getAssignment = async (id) => {
    const row = await db.get(`${ASSIGNMENT_SQL} WHERE d.id = ? AND d.classe_id = ?`, [user.id, id, classId]);
    return row ? formatAssignment(row) : null;
  };

  const subjectExists = async (subjectId) => Boolean(await findClassSubject(subjectId, classId));

  server.registerTool('lister_matieres', {
    title: 'Lister les matières',
    description: 'Liste les matières de la classe avec leur identifiant.',
    annotations: { readOnlyHint: true }
  }, withClass(async () => {
    const subjects = await db.all(
      'SELECT id, nom FROM matieres WHERE classe_id = ? ORDER BY nom',
      [classId]
    );
    return ok(subjects);
  }));

  server.registerTool('lister_devoirs', {
    title: 'Lister les devoirs',
    description: 'Liste les devoirs de la classe. Par défaut : devoirs à venir (ou sans date) non encore faits par l\'utilisateur.',
    inputSchema: {
      statut: z.enum(['a_faire', 'fait', 'tous']).default('a_faire')
        .describe('Statut personnel de l\'utilisateur'),
      periode: z.enum(['a_venir', 'passes', 'tous']).default('a_venir')
        .describe('a_venir : à rendre aujourd\'hui ou plus tard, ou sans date ; passes : date dépassée'),
      matiere_id: idSchema.optional().describe('Filtrer sur une matière'),
      du: dateSchema.optional().describe('Date de rendu minimale (incluse)'),
      au: dateSchema.optional().describe('Date de rendu maximale (incluse)')
    },
    annotations: { readOnlyHint: true }
  }, withClass(async ({ statut: status, periode: period, matiere_id: subjectId, du: from, au: to }) => {
    const where = ['d.classe_id = ?'];
    const params = [user.id, classId];
    const today = todayString();

    if (status === 'a_faire') where.push('COALESCE(ds.fait, 0) = 0');
    if (status === 'fait') where.push('ds.fait = 1');
    if (period === 'a_venir') { where.push('(d.date IS NULL OR DATE(d.date) >= ?)'); params.push(today); }
    if (period === 'passes') { where.push('DATE(d.date) < ?'); params.push(today); }
    if (subjectId) { where.push('d.matiere_id = ?'); params.push(subjectId); }
    if (from) { where.push('DATE(d.date) >= ?'); params.push(from); }
    if (to) { where.push('DATE(d.date) <= ?'); params.push(to); }

    const rows = await db.all(
      `${ASSIGNMENT_SQL} WHERE ${where.join(' AND ')} ORDER BY d.date IS NULL, d.date ASC, d.created_at DESC`,
      params
    );
    return ok({ aujourd_hui: today, nombre: rows.length, devoirs: rows.map(formatAssignment) });
  }));

  server.registerTool('voir_devoir', {
    title: 'Voir un devoir',
    description: 'Détail d\'un devoir, avec la liste de ses documents joints (lisibles avec lire_document).',
    inputSchema: { id: idSchema.describe('Identifiant du devoir') },
    annotations: { readOnlyHint: true }
  }, withClass(async ({ id }) => {
    const assignment = await getAssignment(id);
    if (!assignment) return fail(`Devoir ${id} introuvable dans la classe.`);

    const files = await db.all(
      `SELECT df.id, df.original_name AS nom, df.uploaded_at, u.username AS ajoute_par
       FROM devoir_fichiers df
       LEFT JOIN users u ON df.uploaded_by = u.id
       WHERE df.devoir_id = ?
       ORDER BY df.uploaded_at ASC`,
      [id]
    );
    assignment.documents = files.map(f => ({
      id: f.id,
      nom: f.nom,
      ajoute_par: f.ajoute_par,
      ajoute_le: toDateString(f.uploaded_at)
    }));
    return ok(assignment);
  }));

  server.registerTool('lire_document', {
    title: 'Lire un document joint',
    description: 'Extrait le texte d\'un document joint à un devoir (PDF, Word, PowerPoint, Excel).',
    inputSchema: { id: idSchema.describe('Identifiant du document (voir voir_devoir)') },
    annotations: { readOnlyHint: true }
  }, withClass(async ({ id }) => {
    const file = await db.get(
      `SELECT df.filename, df.original_name
       FROM devoir_fichiers df
       JOIN devoirs d ON df.devoir_id = d.id
       WHERE df.id = ? AND d.classe_id = ?`,
      [id, classId]
    );
    if (!file) return fail(`Document ${id} introuvable dans la classe.`);

    const filePath = path.join(UPLOADS_DIR, path.basename(file.filename));
    if (!fs.existsSync(filePath)) return fail(`Le fichier « ${file.original_name} » n'est plus disponible sur le serveur.`);

    let pdfPath;
    try {
      pdfPath = await convertToPdf(filePath);
    } catch (error) {
      return fail(`Impossible de convertir « ${file.original_name} » en PDF : ${error.message}`);
    }

    const text = await extractTextFromPdf(pdfPath);
    if (!text) {
      return fail(`Aucun texte extractible dans « ${file.original_name} » (document scanné ou image ?).`);
    }

    const truncated = text.length > MAX_DOCUMENT_CHARS;
    return ok(`# ${file.original_name}\n\n${truncated ? text.slice(0, MAX_DOCUMENT_CHARS) : text}`
      + (truncated ? `\n\n[… texte tronqué à ${MAX_DOCUMENT_CHARS} caractères sur ${text.length}]` : ''));
  }));

  server.registerTool('marquer_fait', {
    title: 'Marquer un devoir comme fait',
    description: 'Change le statut personnel de l\'utilisateur pour un devoir (n\'affecte pas les autres élèves).',
    inputSchema: {
      id: idSchema.describe('Identifiant du devoir'),
      fait: z.boolean().default(true).describe('true : fait ; false : à faire')
    },
    annotations: { idempotentHint: true }
  }, withClass(async ({ id, fait: done }) => {
    const assignment = await getAssignment(id);
    if (!assignment) return fail(`Devoir ${id} introuvable dans la classe.`);

    await db.run(
      `INSERT INTO devoir_statuts (devoir_id, user_id, fait)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE fait = VALUES(fait)`,
      [id, user.id, done ? 1 : 0]
    );
    return ok(`« ${assignment.titre} » marqué comme ${done ? 'fait' : 'à faire'}.`);
  }));

  server.registerTool('creer_devoir', {
    title: 'Créer un devoir',
    description: 'Ajoute un devoir à l\'agenda de la classe (visible par tous les élèves).',
    inputSchema: {
      titre: z.string().trim().min(1).max(500),
      matiere_id: idSchema.describe('Identifiant de la matière (voir lister_matieres)'),
      pour_le: dateSchema.optional().describe('Date de rendu'),
      description: z.string().optional().describe('Consignes (Markdown accepté)')
    }
  }, withClass(async ({ titre: title, matiere_id: subjectId, pour_le: dueDate, description }) => {
    if (!await subjectExists(subjectId)) return fail(`Matière ${subjectId} introuvable dans la classe.`);

    const result = await db.run(
      'INSERT INTO devoirs (titre, description, matiere_id, date, classe_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description || null, subjectId, dueDate || null, classId, user.id]
    );
    const assignmentId = result.lastInsertRowid;

    const created = await db.get(ASSIGNMENT_WITH_SUBJECT_SQL, [assignmentId, classId]);
    const snapshot = snapshotAssignment(created);
    await logAssignmentAction(logReq, {
      assignmentId,
      action: 'create',
      details: { titre: snapshot.titre, devoir: snapshot, via: 'mcp' }
    });
    notify(assignmentId, 'POST');
    push.notifyClassInBackground(classId, 'nouveau_devoir',
      pushMessages.newAssignment({ id: assignmentId, ...snapshot }), user.id);

    return ok({ message: 'Devoir créé', devoir: await getAssignment(assignmentId) });
  }));

  server.registerTool('modifier_devoir', {
    title: 'Modifier un devoir',
    description: 'Modifie un devoir de la classe (visible par tous). Seuls les champs fournis changent ; '
      + 'pour_le ou description à null les effacent.',
    inputSchema: {
      id: idSchema.describe('Identifiant du devoir'),
      titre: z.string().trim().min(1).max(500).optional(),
      matiere_id: idSchema.optional(),
      pour_le: dateSchema.nullable().optional(),
      description: z.string().nullable().optional()
    },
    annotations: { idempotentHint: true }
  }, withClass(async ({ id, ...changes }) => {
    const old = await db.get(ASSIGNMENT_WITH_SUBJECT_SQL, [id, classId]);
    if (!old) return fail(`Devoir ${id} introuvable dans la classe.`);
    if (changes.matiere_id && !await subjectExists(changes.matiere_id)) {
      return fail(`Matière ${changes.matiere_id} introuvable dans la classe.`);
    }

    const pick = (key, current) => (changes[key] !== undefined ? changes[key] : current);
    await db.run(
      'UPDATE devoirs SET titre = ?, description = ?, matiere_id = ?, date = ? WHERE id = ? AND classe_id = ?',
      [
        pick('titre', old.titre),
        pick('description', old.description) || null,
        pick('matiere_id', old.matiere_id),
        changes.pour_le !== undefined ? changes.pour_le : toDateString(old.date),
        id,
        classId
      ]
    );

    const updated = await db.get(ASSIGNMENT_WITH_SUBJECT_SQL, [id, classId]);
    const after = snapshotAssignment(updated);
    const diff = diffSnapshots(snapshotAssignment(old), after);
    if (diff.length > 0) {
      await logAssignmentAction(logReq, {
        assignmentId: id,
        action: 'update',
        details: { titre: after.titre, changes: diff, via: 'mcp' }
      });
      notify(id, 'PUT');
      push.notifyAssignmentUpdatedInBackground(classId, { id, ...after }, diff, user.id);
    }

    return ok({ message: diff.length > 0 ? 'Devoir modifié' : 'Aucun changement', devoir: await getAssignment(id) });
  }));

  server.registerTool('supprimer_devoir', {
    title: 'Supprimer un devoir',
    description: 'Supprime définitivement un devoir et ses documents pour toute la classe. '
      + 'Demander confirmation à l\'utilisateur avant.',
    inputSchema: { id: idSchema.describe('Identifiant du devoir') },
    annotations: { destructiveHint: true }
  }, withClass(async ({ id }) => {
    const assignment = await db.get(ASSIGNMENT_WITH_SUBJECT_SQL, [id, classId]);
    if (!assignment) return fail(`Devoir ${id} introuvable dans la classe.`);

    const files = await db.all(
      `SELECT df.original_name, df.uploaded_at, u.username as uploaded_by_username
       FROM devoir_fichiers df
       LEFT JOIN users u ON df.uploaded_by = u.id
       WHERE df.devoir_id = ?
       ORDER BY df.uploaded_at ASC`,
      [id]
    );

    await db.run('DELETE FROM devoirs WHERE id = ? AND classe_id = ?', [id, classId]);

    const snapshot = snapshotAssignment(assignment);
    await logAssignmentAction(logReq, {
      assignmentId: id,
      action: 'delete',
      details: { titre: snapshot.titre, devoir: snapshot, fichiers: files, via: 'mcp' }
    });
    notify(id, 'DELETE');

    return ok(`Devoir « ${assignment.titre} » supprimé.`);
  }));

  return server;
}

module.exports = { createMcpServer };
