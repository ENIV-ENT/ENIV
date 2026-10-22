#!/usr/bin/env node
/**
 * Versions the links to CSS and JS files with a hash of their content.
 *
 *   node scripts/versionAssets.js [--strip] [folders...]
 *                                        (default: public public-site)
 *
 * --strip removes the `?v=` of these same links, to bring the files back to the
 * repository state after a run in development.
 *
 * Run by deploy.sh on the VPS, right after the git pull: links in the repository
 * have no version, and this script adds `?v=<hash>` to each src/href of the HTML
 * pages, to each ES import and to each CSS @import that targets a file of the
 * folder. The hash covers the file content after rewriting its own links:
 * changing api.js also changes the version of dashboard.js, which imports it. An
 * unchanged file keeps its version, hence the browser cache.
 *
 * Each folder is a separate root, against which absolute links (`/css/style.css`)
 * are resolved. External URLs and missing files (/vendor, served from
 * node_modules) are left as they are. Running the script again on files already
 * versioned changes nothing.
 * @module
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOTS = ['public', 'public-site'].map((dir) => path.join(__dirname, '..', dir));
const HASH_LENGTH = 8;

/** Group 1: what precedes the URL, group 2: the URL without its previous version. */
const ASSET = String.raw`([^'"?#\s()]+\.(?:m?js|css))(?:\?v=[^'"#\s()]*)?`;
const HTML_LINK = new RegExp(String.raw`(\s(?:src|href)\s*=\s*["'])${ASSET}(?=["'])`, 'g');
const JS_IMPORT = new RegExp(String.raw`(\bfrom\s*["']|\bimport\s*["']|\bimport\s*\(\s*["'])${ASSET}(?=["'])`, 'g');
const CSS_IMPORT = new RegExp(String.raw`(@import\s+["']|@import\s+url\(\s*["']?)${ASSET}(?=["')\s])`, 'g');

/** HTML pages can also hold inline modules. */
const PATTERNS = {
  '.html': [HTML_LINK, JS_IMPORT],
  '.js': [JS_IMPORT],
  '.mjs': [JS_IMPORT],
  '.css': [CSS_IMPORT],
};

/**
 * Adds or updates the `?v=<hash>` of every file of the folders. Everything is
 * computed before writing: an import cycle leaves no half-versioned file.
 * @param {string[]} roots folders served at the root of the site
 * @returns {string[]} paths of the changed files
 */
function versionAssets(roots = DEFAULT_ROOTS) {
  const changed = [];
  for (const root of roots.map((dir) => path.resolve(dir))) {
    const contents = new Map();
    const versions = new Map();
    const stack = [];

    const version = (file) => {
      if (versions.has(file)) return versions.get(file);
      if (stack.includes(file)) {
        const cycle = [...stack.slice(stack.indexOf(file)), file].map((f) => path.relative(root, f));
        throw new Error(`Import cycle, cannot compute the versions: ${cycle.join(' -> ')}`);
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
 * Removes the `?v=` of the links versionAssets rewrites.
 * @param {string[]} roots folders served at the root of the site
 * @returns {string[]} paths of the changed files
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

/** Replaces the possible `?v=` of each link to a file of the folder with `suffix(target file)`. */
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

/** File targeted by the link, or null if it is external or missing from the folder. */
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
  const strip = args.includes('--strip');
  const roots = args.filter((arg) => arg !== '--strip');
  const changed = (strip ? stripVersions : versionAssets)(roots.length ? roots : DEFAULT_ROOTS);
  console.log(`Asset versions ${strip ? 'stripped' : 'updated'}: ${changed.length} file(s) changed`);
}
