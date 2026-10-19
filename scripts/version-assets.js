#!/usr/bin/env node
// Versionne les liens vers le CSS et le JS par un hash de leur contenu.
//
//   node scripts/version-assets.js [--retirer] [dossiers...]
//                                         (défaut : public public-site)
//
// --retirer enlève les `?v=` de ces mêmes liens, pour remettre les fichiers dans
// l'état du dépôt après un lancement en développement.
//
// Lancé par deploy.sh sur le VPS, juste après le git pull : les liens du dépôt
// n'ont pas de version, et ce script ajoute `?v=<hash>` à chaque src/href des
// pages HTML, à chaque import ES et à chaque @import CSS qui vise un fichier du
// dossier. Le hash porte sur le contenu du fichier après réécriture de ses
// propres liens : modifier api.js change aussi la version de dashboard.js, qui
// l'importe. Un fichier inchangé garde sa version, donc le cache navigateur.
//
// Chaque dossier est une racine distincte, sur laquelle sont résolus les liens
// absolus (`/css/style.css`). Les URL externes et les fichiers absents
// (/vendor, servi depuis node_modules) sont laissés tels quels. Relancer le
// script sur des fichiers déjà versionnés ne change rien.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOTS = ['public', 'public-site'].map((dir) => path.join(__dirname, '..', dir));
const HASH_LENGTH = 8;

// Groupe 1 : ce qui précède l'URL, groupe 2 : l'URL sans son ancienne version
const ASSET = String.raw`([^'"?#\s()]+\.(?:m?js|css))(?:\?v=[^'"#\s()]*)?`;
const HTML_LINK = new RegExp(String.raw`(\s(?:src|href)\s*=\s*["'])${ASSET}(?=["'])`, 'g');
const JS_IMPORT = new RegExp(String.raw`(\bfrom\s*["']|\bimport\s*["']|\bimport\s*\(\s*["'])${ASSET}(?=["'])`, 'g');
const CSS_IMPORT = new RegExp(String.raw`(@import\s+["']|@import\s+url\(\s*["']?)${ASSET}(?=["')\s])`, 'g');

// Les pages HTML peuvent aussi contenir des modules en ligne
const PATTERNS = {
  '.html': [HTML_LINK, JS_IMPORT],
  '.js': [JS_IMPORT],
  '.mjs': [JS_IMPORT],
  '.css': [CSS_IMPORT],
};

/**
 * Ajoute ou met à jour les `?v=<hash>` de tous les fichiers des dossiers.
 * @param {string[]} roots dossiers servis à la racine du site
 * @returns {string[]} chemins des fichiers modifiés
 */
function versionAssets(roots = DEFAULT_ROOTS) {
  const changed = [];
  for (const root of roots.map((dir) => path.resolve(dir))) {
    // Tout est calculé avant d'écrire : un cycle d'imports ne laisse aucun
    // fichier à moitié versionné.
    const contents = new Map();
    const versions = new Map();
    const stack = [];

    const version = (file) => {
      if (versions.has(file)) return versions.get(file);
      if (stack.includes(file)) {
        const cycle = [...stack.slice(stack.indexOf(file)), file].map((f) => path.relative(root, f));
        throw new Error(`Cycle d'imports, impossible de calculer les versions : ${cycle.join(' -> ')}`);
      }
      stack.push(file);
      const content = rewrite(root, file, (target) => `?v=${version(target)}`);
      stack.pop();
      const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, HASH_LENGTH);
      contents.set(file, content);
      versions.set(file, hash);
      return hash;
    };

    for (const file of listFiles(root)) version(file);

    for (const [file, content] of contents) {
      if (content !== fs.readFileSync(file, 'utf8')) {
        fs.writeFileSync(file, content);
        changed.push(file);
      }
    }
  }
  return changed;
}

/**
 * Retire les `?v=` des liens que versionAssets réécrit.
 * @param {string[]} roots dossiers servis à la racine du site
 * @returns {string[]} chemins des fichiers modifiés
 */
function stripVersions(roots = DEFAULT_ROOTS) {
  const changed = [];
  for (const root of roots.map((dir) => path.resolve(dir))) {
    for (const file of listFiles(root)) {
      const content = rewrite(root, file, () => '');
      if (content !== fs.readFileSync(file, 'utf8')) {
        fs.writeFileSync(file, content);
        changed.push(file);
      }
    }
  }
  return changed;
}

function listFiles(root) {
  return fs.readdirSync(root, { recursive: true })
    .map((name) => path.join(root, name))
    .filter((file) => path.extname(file) in PATTERNS && fs.statSync(file).isFile())
    .sort();
}

// Remplace l'éventuel `?v=` de chaque lien vers un fichier du dossier par
// `suffix(fichier visé)`
function rewrite(root, file, suffix) {
  let content = fs.readFileSync(file, 'utf8');
  for (const pattern of PATTERNS[path.extname(file)] || []) {
    content = content.replace(pattern, (match, prefix, url) => {
      const target = resolve(root, file, url);
      return target ? `${prefix}${url}${suffix(target)}` : match;
    });
  }
  return content;
}

// Fichier visé par le lien, ou null s'il est externe ou absent du dossier
function resolve(root, from, url) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return null;
  const target = url.startsWith('/') ? path.join(root, url) : path.resolve(path.dirname(from), url);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return fs.statSync(target, { throwIfNoEntry: false })?.isFile() ? target : null;
}

module.exports = { versionAssets, stripVersions };

if (require.main === module) {
  const args = process.argv.slice(2);
  const strip = args.includes('--retirer');
  const roots = args.filter((arg) => arg !== '--retirer');
  const changed = (strip ? stripVersions : versionAssets)(roots.length ? roots : DEFAULT_ROOTS);
  console.log(`Versions des assets ${strip ? 'retirées' : 'mises à jour'} : ${changed.length} fichier(s) modifié(s)`);
}
