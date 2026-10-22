const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Readable } = require('stream');
const { openRemote, readLimited, ProxyError } = require('../backend/services/safeRequest');
const { fetchImage } = require('../backend/services/imageProxy');

test('image proxy: internal schemes and addresses refused before any connection', async () => {
  await assert.rejects(fetchImage('file:///etc/passwd'), { name: 'ProxyError', status: 400 });
  await assert.rejects(fetchImage('pas une url'), { name: 'ProxyError', status: 400 });
  for (const target of ['http://127.0.0.1/a.png', 'http://169.254.169.254/', 'http://[::ffff:10.0.0.1]/', 'http://[::1]:3000/']) {
    await assert.rejects(fetchImage(target), { name: 'ProxyError', status: 403 }, target);
  }
});

test('readLimited: cuts a stream that goes past the maximum size', async () => {
  const ok = await readLimited(Readable.from([Buffer.from('abc'), Buffer.from('def')]), 6);
  assert.equal(ok.toString(), 'abcdef');

  await assert.rejects(
    readLimited(Readable.from([Buffer.from('abc'), Buffer.from('defg')]), 6),
    (error) => error instanceof ProxyError && error.status === 413
  );
});

/**
 * Source that sends a byte every 50 ms without ever ending: the idle timeout does
 * not stop it, only the deadline does.
 */
const slowSource = http.createServer((req, res) => {
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/slow' });
    return res.end();
  }
  res.writeHead(200, { 'content-type': 'text/calendar' });
  res.write('B');
  const timer = setInterval(() => res.write('.'), 50);
  res.on('close', () => clearInterval(timer));
});
after(() => slowSource.close());

/** The test server is on 127.0.0.1, which the filtered resolution refuses. */
const localhost = (hostname, options, callback) => (options.all
  ? callback(null, [{ address: '127.0.0.1', family: 4 }])
  : callback(null, '127.0.0.1', 4));

async function download(route, deadlineMs) {
  await new Promise((resolve) => (slowSource.listening ? resolve() : slowSource.listen(0, '127.0.0.1', resolve)));
  const remote = await openRemote(`http://localhost:${slowSource.address().port}${route}`, {
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

test('deadline: a source that sends drop by drop is aborted', async () => {
  const start = Date.now();
  await assert.rejects(download('/slow', 300), { name: 'ProxyError', status: 504, message: /trop de temps/ });
  assert.ok(Date.now() - start < 1000);
});

test('deadline: counted from the start, redirects included', async () => {
  await assert.rejects(download('/redirect', 300), { name: 'ProxyError', status: 504 });
});
