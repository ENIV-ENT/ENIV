#!/usr/bin/env node
/**
 * Smoke test: checks that an Eniv instance answers correctly.
 *
 *   node scripts/smokeTest.js [URL]        (default: http://127.0.0.1:3000)
 *
 * Used by the CI (app started on an empty MySQL database, so with every
 * migration run) and after each deployment. Waits up to SMOKE_TIMEOUT_S seconds
 * (60 by default) for the API to answer, then runs the checks. Exit code 1 if a
 * check fails.
 *
 * The first check runs an SQL query on classes and users: 500 if the database or
 * the tables are missing. Static pages are served by Caddy in production: they
 * are only checked on a direct Node instance (CI), unless SMOKE_PAGES=1.
 * @module
 */

const BASE_URL = (process.argv[2] || process.env.SMOKE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TIMEOUT_S = Number(process.env.SMOKE_TIMEOUT_S || 60);

/** [label, path, expected status, optional body check] */
const CHECKS = [
  ['API + database', '/api/registration/classes?etablissement_id=0', 200, (body) => Array.isArray(JSON.parse(body))],
  ['Missing token refused', '/api/auth/me', 401],
  ['Protected route refused', '/api/devoirs', 401],
];

const PAGE_CHECKS = [
  ['Login page', '/', 200, (body) => body.includes('<html')],
  ['Dashboard', '/dashboard/', 200],
  ['Service worker', '/sw.js', 200],
  ['PWA manifest', '/manifest.webmanifest', 200],
  ['404 page', '/page-inexistante', 404],
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
  throw new Error(`the API does not answer after ${TIMEOUT_S} s (${lastError?.message})`);
}

async function run() {
  console.log(`Smoke test on ${BASE_URL}`);
  await waitForApi();

  const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE_URL);
  const checks = isLocal || process.env.SMOKE_PAGES === '1' ? [...CHECKS, ...PAGE_CHECKS] : CHECKS;

  let failed = 0;
  for (const [label, path, expected, verify] of checks) {
    let ok = false;
    let detail;
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
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll green ✓');
}

run().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
