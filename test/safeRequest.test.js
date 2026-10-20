const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { readLimited, ProxyError } = require('../backend/services/safeRequest');
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
