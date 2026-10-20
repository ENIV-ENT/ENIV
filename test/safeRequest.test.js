const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Readable } = require('stream');
const { openRemote, readLimited, ProxyError } = require('../backend/services/safeRequest');
const { fetchImage } = require('../backend/services/imageProxy');

test('proxy d\'images : schémas et adresses internes refusés avant toute connexion', async () => {
  await assert.rejects(fetchImage('file:///etc/passwd'), { name: 'ProxyError', status: 400 });
  await assert.rejects(fetchImage('pas une url'), { name: 'ProxyError', status: 400 });
  for (const target of ['http://127.0.0.1/a.png', 'http://169.254.169.254/', 'http://[::ffff:10.0.0.1]/', 'http://[::1]:3000/']) {
    await assert.rejects(fetchImage(target), { name: 'ProxyError', status: 403 }, target);
  }
});

test('readLimited : coupe un flux qui dépasse la taille maximale', async () => {
  const ok = await readLimited(Readable.from([Buffer.from('abc'), Buffer.from('def')]), 6);
  assert.equal(ok.toString(), 'abcdef');

  await assert.rejects(
    readLimited(Readable.from([Buffer.from('abc'), Buffer.from('defg')]), 6),
    (error) => error instanceof ProxyError && error.status === 413
  );
});

// Source qui envoie un octet toutes les 50 ms sans jamais terminer : le délai
// d'inactivité ne la coupe pas, seule la durée maximale le fait
const lente = http.createServer((req, res) => {
  if (req.url === '/redirection') {
    res.writeHead(302, { location: '/lente' });
    return res.end();
  }
  res.writeHead(200, { 'content-type': 'text/calendar' });
  res.write('B');
  const timer = setInterval(() => res.write('.'), 50);
  res.on('close', () => clearInterval(timer));
});
after(() => lente.close());

// Le serveur de test est sur 127.0.0.1, que la résolution filtrée refuse
const localhost = (hostname, options, callback) => (options.all
  ? callback(null, [{ address: '127.0.0.1', family: 4 }])
  : callback(null, '127.0.0.1', 4));

async function telecharger(chemin, deadlineMs) {
  await new Promise((resolve) => (lente.listening ? resolve() : lente.listen(0, '127.0.0.1', resolve)));
  const remote = await openRemote(`http://localhost:${lente.address().port}${chemin}`, {
    accept: 'text/calendar',
    userAgent: 'test',
    allowedTypes: new Set(['text/calendar']),
    maxBytes: 1024 * 1024,
    timeoutMs: 1000,
    deadlineMs,
    label: 'la source',
    lookup: localhost,
  });
  return readLimited(remote.stream, 1024 * 1024);
}

test('durée maximale : une source qui envoie au compte-gouttes est abandonnée', async () => {
  const debut = Date.now();
  await assert.rejects(telecharger('/lente', 300), { name: 'ProxyError', status: 504, message: /trop de temps/ });
  assert.ok(Date.now() - debut < 1000);
});

test('durée maximale : comptée depuis le début, redirections comprises', async () => {
  await assert.rejects(telecharger('/redirection', 300), { name: 'ProxyError', status: 504 });
});
