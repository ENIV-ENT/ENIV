const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const db = require('../models/dbHelper');
const { notifyClasse } = require('./realtime');
const { convertToPDF } = require('./fileConverter');
const { extractTextFromPDF } = require('./quizGenerator');
const { toDateString, snapshotDevoir, diffSnapshots, logDevoirAction } = require('./devoirLogger');
const push = require('./push');
const pushMessages = require('./pushMessages');
const { matiereDeLaClasse } = require('./appartenanceClasse');

/**
 * Serveur MCP d'ENIV : expose les devoirs de la classe de l'utilisateur à un
 * assistant IA. Un serveur est créé par requête (mode sans état), pour un
 * utilisateur déjà authentifié par son jeton MCP.
 *
 * Les modifications suivent les mêmes règles que l'API REST : journalisation
 * dans devoir_logs et notification temps réel de la classe.
 */

const UPLOADS_DIR = path.join(__dirname, '../uploads');
const MAX_DOCUMENT_CHARS = 60000;

const INSTRUCTIONS = `ENIV est l'agenda de devoirs partagé d'une classe.
Les devoirs sont communs à toute la classe : en créer, modifier ou supprimer un change ce que voient tous les élèves.
Seul le statut « fait » est personnel à l'utilisateur.
Les dates sont au format AAAA-MM-JJ. Pour créer un devoir, obtenir d'abord l'identifiant de la matière avec lister_matieres.`;

const DEVOIR_SQL = `
  SELECT d.id, d.titre, d.description, d.date, d.matiere_id, m.nom AS matiere,
         u.username AS cree_par, d.created_at, COALESCE(ds.fait, 0) AS fait
  FROM devoirs d
  LEFT JOIN matieres m ON d.matiere_id = m.id
  LEFT JOIN users u ON d.created_by = u.id
  LEFT JOIN devoir_statuts ds ON d.id = ds.devoir_id AND ds.user_id = ?`;

// Devoir avec le nom de sa matière, pour les instantanés des logs (comme routes/devoirs.js)
const DEVOIR_WITH_MATIERE_SQL = `
  SELECT d.*, m.nom as matiere_nom
  FROM devoirs d
  LEFT JOIN matieres m ON d.matiere_id = m.id
  WHERE d.id = ? AND d.classe_id = ?`;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const idSchema = z.number().int().positive();

function formatDevoir(row) {
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

// Date du jour en France (le conteneur est en UTC) : AAAA-MM-JJ
function todayString() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

function createMcpServer(user) {
  const server = new McpServer(
    { name: 'eniv', title: 'ENIV — devoirs', version: '1.0.0' },
    { instructions: INSTRUCTIONS }
  );

  const classeId = user.classe_id;
  // logDevoirAction attend une requête Express : seul req.user est lu
  const logReq = { user };

  const notify = (devoirId, method) => notifyClasse(classeId, {
    type: 'update',
    resource: 'devoirs',
    devoirId,
    method,
    at: Date.now()
  });

  // Toutes les données sont celles de la classe : sans classe, aucun outil n'a de sens
  const withClasse = (handler) => async (args) => {
    if (!classeId) return fail("Ce compte n'est associé à aucune classe.");
    try {
      return await handler(args);
    } catch (error) {
      console.error('Erreur outil MCP:', error);
      return fail('Erreur interne du serveur ENIV.');
    }
  };

  const getDevoir = async (id) => {
    const row = await db.get(`${DEVOIR_SQL} WHERE d.id = ? AND d.classe_id = ?`, [user.id, id, classeId]);
    return row ? formatDevoir(row) : null;
  };

  const matiereExists = async (matiereId) => Boolean(await matiereDeLaClasse(matiereId, classeId));

  server.registerTool('lister_matieres', {
    title: 'Lister les matières',
    description: 'Liste les matières de la classe avec leur identifiant.',
    annotations: { readOnlyHint: true }
  }, withClasse(async () => {
    const matieres = await db.all(
      'SELECT id, nom FROM matieres WHERE classe_id = ? ORDER BY nom',
      [classeId]
    );
    return ok(matieres);
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
  }, withClasse(async ({ statut, periode, matiere_id, du, au }) => {
    const where = ['d.classe_id = ?'];
    const params = [user.id, classeId];
    const today = todayString();

    if (statut === 'a_faire') where.push('COALESCE(ds.fait, 0) = 0');
    if (statut === 'fait') where.push('ds.fait = 1');
    if (periode === 'a_venir') { where.push('(d.date IS NULL OR DATE(d.date) >= ?)'); params.push(today); }
    if (periode === 'passes') { where.push('DATE(d.date) < ?'); params.push(today); }
    if (matiere_id) { where.push('d.matiere_id = ?'); params.push(matiere_id); }
    if (du) { where.push('DATE(d.date) >= ?'); params.push(du); }
    if (au) { where.push('DATE(d.date) <= ?'); params.push(au); }

    const rows = await db.all(
      `${DEVOIR_SQL} WHERE ${where.join(' AND ')} ORDER BY d.date IS NULL, d.date ASC, d.created_at DESC`,
      params
    );
    return ok({ aujourd_hui: today, nombre: rows.length, devoirs: rows.map(formatDevoir) });
  }));

  server.registerTool('voir_devoir', {
    title: 'Voir un devoir',
    description: 'Détail d\'un devoir, avec la liste de ses documents joints (lisibles avec lire_document).',
    inputSchema: { id: idSchema.describe('Identifiant du devoir') },
    annotations: { readOnlyHint: true }
  }, withClasse(async ({ id }) => {
    const devoir = await getDevoir(id);
    if (!devoir) return fail(`Devoir ${id} introuvable dans la classe.`);

    const fichiers = await db.all(
      `SELECT df.id, df.original_name AS nom, df.uploaded_at, u.username AS ajoute_par
       FROM devoir_fichiers df
       LEFT JOIN users u ON df.uploaded_by = u.id
       WHERE df.devoir_id = ?
       ORDER BY df.uploaded_at ASC`,
      [id]
    );
    devoir.documents = fichiers.map(f => ({
      id: f.id,
      nom: f.nom,
      ajoute_par: f.ajoute_par,
      ajoute_le: toDateString(f.uploaded_at)
    }));
    return ok(devoir);
  }));

  server.registerTool('lire_document', {
    title: 'Lire un document joint',
    description: 'Extrait le texte d\'un document joint à un devoir (PDF, Word, PowerPoint, Excel).',
    inputSchema: { id: idSchema.describe('Identifiant du document (voir voir_devoir)') },
    annotations: { readOnlyHint: true }
  }, withClasse(async ({ id }) => {
    const fichier = await db.get(
      `SELECT df.filename, df.original_name
       FROM devoir_fichiers df
       JOIN devoirs d ON df.devoir_id = d.id
       WHERE df.id = ? AND d.classe_id = ?`,
      [id, classeId]
    );
    if (!fichier) return fail(`Document ${id} introuvable dans la classe.`);

    const filePath = path.join(UPLOADS_DIR, path.basename(fichier.filename));
    if (!fs.existsSync(filePath)) return fail(`Le fichier « ${fichier.original_name} » n'est plus disponible sur le serveur.`);

    let pdfPath;
    try {
      pdfPath = await convertToPDF(filePath);
    } catch (error) {
      return fail(`Impossible de convertir « ${fichier.original_name} » en PDF : ${error.message}`);
    }

    const text = await extractTextFromPDF(pdfPath);
    if (!text) {
      return fail(`Aucun texte extractible dans « ${fichier.original_name} » (document scanné ou image ?).`);
    }

    const truncated = text.length > MAX_DOCUMENT_CHARS;
    return ok(`# ${fichier.original_name}\n\n${truncated ? text.slice(0, MAX_DOCUMENT_CHARS) : text}`
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
  }, withClasse(async ({ id, fait }) => {
    const devoir = await getDevoir(id);
    if (!devoir) return fail(`Devoir ${id} introuvable dans la classe.`);

    await db.run(
      `INSERT INTO devoir_statuts (devoir_id, user_id, fait)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE fait = VALUES(fait)`,
      [id, user.id, fait ? 1 : 0]
    );
    return ok(`« ${devoir.titre} » marqué comme ${fait ? 'fait' : 'à faire'}.`);
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
  }, withClasse(async ({ titre, matiere_id, pour_le, description }) => {
    if (!await matiereExists(matiere_id)) return fail(`Matière ${matiere_id} introuvable dans la classe.`);

    const result = await db.run(
      'INSERT INTO devoirs (titre, description, matiere_id, date, classe_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [titre, description || null, matiere_id, pour_le || null, classeId, user.id]
    );
    const devoirId = result.lastInsertRowid;

    const created = await db.get(DEVOIR_WITH_MATIERE_SQL, [devoirId, classeId]);
    const snapshot = snapshotDevoir(created);
    await logDevoirAction(logReq, {
      devoirId,
      action: 'create',
      details: { titre: snapshot.titre, devoir: snapshot, via: 'mcp' }
    });
    notify(devoirId, 'POST');
    push.notifyClasseInBackground(classeId, 'nouveau_devoir',
      pushMessages.nouveauDevoir({ id: devoirId, ...snapshot }), user.id);

    return ok({ message: 'Devoir créé', devoir: await getDevoir(devoirId) });
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
  }, withClasse(async ({ id, ...changes }) => {
    const old = await db.get(DEVOIR_WITH_MATIERE_SQL, [id, classeId]);
    if (!old) return fail(`Devoir ${id} introuvable dans la classe.`);
    if (changes.matiere_id && !await matiereExists(changes.matiere_id)) {
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
        classeId
      ]
    );

    const updated = await db.get(DEVOIR_WITH_MATIERE_SQL, [id, classeId]);
    const after = snapshotDevoir(updated);
    const diff = diffSnapshots(snapshotDevoir(old), after);
    if (diff.length > 0) {
      await logDevoirAction(logReq, {
        devoirId: id,
        action: 'update',
        details: { titre: after.titre, changes: diff, via: 'mcp' }
      });
      notify(id, 'PUT');
      push.notifyDevoirModifieInBackground(classeId, { id, ...after }, diff, user.id);
    }

    return ok({ message: diff.length > 0 ? 'Devoir modifié' : 'Aucun changement', devoir: await getDevoir(id) });
  }));

  server.registerTool('supprimer_devoir', {
    title: 'Supprimer un devoir',
    description: 'Supprime définitivement un devoir et ses documents pour toute la classe. '
      + 'Demander confirmation à l\'utilisateur avant.',
    inputSchema: { id: idSchema.describe('Identifiant du devoir') },
    annotations: { destructiveHint: true }
  }, withClasse(async ({ id }) => {
    const devoir = await db.get(DEVOIR_WITH_MATIERE_SQL, [id, classeId]);
    if (!devoir) return fail(`Devoir ${id} introuvable dans la classe.`);

    const fichiers = await db.all(
      `SELECT df.original_name, df.uploaded_at, u.username as uploaded_by_username
       FROM devoir_fichiers df
       LEFT JOIN users u ON df.uploaded_by = u.id
       WHERE df.devoir_id = ?
       ORDER BY df.uploaded_at ASC`,
      [id]
    );

    await db.run('DELETE FROM devoirs WHERE id = ? AND classe_id = ?', [id, classeId]);

    const snapshot = snapshotDevoir(devoir);
    await logDevoirAction(logReq, {
      devoirId: id,
      action: 'delete',
      details: { titre: snapshot.titre, devoir: snapshot, fichiers, via: 'mcp' }
    });
    notify(id, 'DELETE');

    return ok(`Devoir « ${devoir.titre} » supprimé.`);
  }));

  return server;
}

module.exports = { createMcpServer };
