#!/usr/bin/env node
// Test de fumée : vérifie qu'une instance d'Eniv répond correctement.
//
//   node scripts/smoke-test.js [URL]        (défaut : http://127.0.0.1:3000)
//
// Utilisé par la CI (application démarrée sur une base MySQL vide, donc avec
// toutes les migrations jouées) et après chaque déploiement. Attend jusqu'à
// SMOKE_TIMEOUT_S secondes (60 par défaut) que l'API réponde, puis enchaîne
// les vérifications. Code de sortie 1 au premier échec.

const BASE_URL = (process.argv[2] || process.env.SMOKE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TIMEOUT_S = Number(process.env.SMOKE_TIMEOUT_S || 60);

// [description, chemin, statut attendu, vérification facultative du corps]
const CHECKS = [
  // Requête SQL sur classes et users, 500 si la base ou les tables manquent
  ['API + base de données', '/api/registration/classes?etablissement_id=0', 200, (body) => Array.isArray(JSON.parse(body))],
  ['Jeton absent refusé', '/api/auth/me', 401],
  ['Route protégée refusée', '/api/devoirs', 401],
];

// Les pages statiques sont servies par Caddy en production : on ne les vérifie
// que sur une instance Node directe (CI), sauf si SMOKE_PAGES=1.
const PAGE_CHECKS = [
  ['Page de connexion', '/', 200, (body) => body.includes('<html')],
  ['Tableau de bord', '/dashboard/', 200],
  ['Service worker', '/sw.js', 200],
  ['Manifest PWA', '/manifest.webmanifest', 200],
  ['Page 404', '/page-inexistante', 404],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForApi() {
  const deadline = Date.now() + TIMEOUT_S * 1000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}${CHECKS[0][1]}`);
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`l'API ne répond pas après ${TIMEOUT_S} s (${lastError?.message})`);
}

async function run() {
  console.log(`Test de fumée sur ${BASE_URL}`);
  await waitForApi();

  const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE_URL);
  const checks = isLocal || process.env.SMOKE_PAGES === '1' ? [...CHECKS, ...PAGE_CHECKS] : CHECKS;

  let failed = 0;
  for (const [label, path, expected, verify] of checks) {
    let ok = false;
    let detail = '';
    try {
      const res = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
      const body = await res.text();
      ok = res.status === expected && (!verify || verify(body));
      detail = `HTTP ${res.status}`;
    } catch (error) {
      detail = error.message;
    }
    console.log(`${ok ? '✓' : '✗'} ${label.padEnd(26)} ${path} (${detail})`);
    if (!ok) failed++;
  }

  if (failed) {
    console.error(`\n${failed} vérification(s) en échec`);
    process.exit(1);
  }
  console.log('\nTout est vert ✓');
}

run().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
