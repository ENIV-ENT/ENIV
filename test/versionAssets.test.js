const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { versionAssets, stripVersions } = require('../scripts/versionAssets');

/**
 * Creates a temporary site from { 'relative/path': content }. It is placed in a
 * subfolder, so a file can be written next to it.
 */
function site(files) {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eniv-assets-')), 'site');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return {
    root,
    read: (name) => fs.readFileSync(path.join(root, name), 'utf8'),
    write: (name, content) => fs.writeFileSync(path.join(root, name), content),
  };
}

const hash = (content) => crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);

test('HTML links and ES imports suffixed with the hash of the target file', () => {
  const s = site({
    'index.html': '<link rel="stylesheet" href="/css/a.css">\n<script type="module" src="/js/page.js?v=3"></script>',
    'css/a.css': 'body { color: red; }',
    'js/page.js': "import { f } from '../js/utils/dom.js';\nimport \"./side.js?v=1\";\nf();",
    'js/utils/dom.js': 'export const f = () => {};',
    'js/side.js': '',
  });
  versionAssets([s.root]);

  const page = s.read('js/page.js');
  assert.equal(page, `import { f } from '../js/utils/dom.js?v=${hash('export const f = () => {};')}';\nimport "./side.js?v=${hash('')}";\nf();`);
  assert.equal(s.read('index.html'), `<link rel="stylesheet" href="/css/a.css?v=${hash('body { color: red; }')}">\n<script type="module" src="/js/page.js?v=${hash(page)}"></script>`);
});

test('a change spreads to the importers, not to the other files', () => {
  const s = site({
    'index.html': '<script type="module" src="/js/page.js"></script><link rel="stylesheet" href="/css/a.css">',
    'js/page.js': "import './api.js';",
    'js/api.js': 'export const v = 1;',
    'css/a.css': 'body {}',
  });
  versionAssets([s.root]);
  const before = { html: s.read('index.html'), page: s.read('js/page.js') };

  s.write('js/api.js', 'export const v = 2;');
  versionAssets([s.root]);

  assert.notEqual(s.read('js/page.js'), before.page);
  const html = s.read('index.html');
  assert.notEqual(html, before.html);
  assert.ok(html.includes(`/css/a.css?v=${hash('body {}')}`), 'the version of the unchanged CSS is kept');
});

test('running the script again changes nothing', () => {
  const s = site({
    'index.html': '<script src="app.js"></script>',
    'app.js': "import './lib.js';",
    'lib.js': '',
  });
  assert.equal(versionAssets([s.root]).length, 2);
  const before = s.read('index.html');
  assert.deepEqual(versionAssets([s.root]), []);
  assert.equal(s.read('index.html'), before);
});

test('external URLs, missing files and files outside the folder left as they are', () => {
  const html = [
    '<script src="https://cdn.example.com/lib.js"></script>',
    '<script src="//cdn.example.com/lib.js"></script>',
    '<link rel="stylesheet" href="/css/absent.css">',
    '<script src="../outside.js"></script>',
    '<link rel="icon" href="/logo.ico">',
  ].join('\n');
  const s = site({
    'index.html': html,
    'js/md.js': "import markdownit from '/vendor/markdown-it/markdown-it.esm.min.mjs';",
    'logo.ico': '',
  });
  fs.writeFileSync(path.join(s.root, '..', 'outside.js'), '');
  versionAssets([s.root]);
  assert.equal(s.read('index.html'), html);
  assert.equal(s.read('js/md.js'), "import markdownit from '/vendor/markdown-it/markdown-it.esm.min.mjs';");
});

test('each folder is a separate root for absolute links', () => {
  const app = site({ 'index.html': '<link rel="stylesheet" href="/css/style.css">', 'css/style.css': 'a' });
  const showcase = site({ 'index.html': '<link rel="stylesheet" href="/css/style.css">', 'css/style.css': 'b' });
  versionAssets([app.root, showcase.root]);
  assert.equal(app.read('index.html'), `<link rel="stylesheet" href="/css/style.css?v=${hash('a')}">`);
  assert.equal(showcase.read('index.html'), `<link rel="stylesheet" href="/css/style.css?v=${hash('b')}">`);
});

test('--strip brings the files back to the repository state, without touching external URLs', () => {
  const files = {
    'index.html': '<link rel="stylesheet" href="/css/a.css">\n<script src="https://cdn.example.com/lib.js?v=3"></script>\n<script type="module" src="/js/page.js"></script>',
    'css/a.css': 'body {}',
    'js/page.js': "import { f } from './dom.js';\nimport \"./side.js\";",
    'js/dom.js': 'export const f = () => {};',
    'js/side.js': '',
  };
  const s = site(files);
  versionAssets([s.root]);
  assert.equal(stripVersions([s.root]).length, 2);
  for (const [name, content] of Object.entries(files)) assert.equal(s.read(name), content, name);
  assert.deepEqual(stripVersions([s.root]), []);
});

test('an import cycle throws without writing anything', () => {
  const s = site({
    'index.html': '<script type="module" src="/a.js"></script>',
    'a.js': "import './b.js';",
    'b.js': "import './a.js';",
  });
  assert.throws(() => versionAssets([s.root]), /Import cycle.*a\.js -> b\.js -> a\.js/);
  assert.equal(s.read('index.html'), '<script type="module" src="/a.js"></script>');
});
