const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const { installFakeDb } = require('./helpers/fakeDb');

const fake = installFakeDb();
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;

const push = require('../backend/services/push');
const messages = require('../backend/services/pushMessages');
const { tomorrowInParis, groupByUser } = require('../backend/services/pushReminders');

describe('messages', () => {
  test('new assignment: subject, title, spelled-out date and direct link', () => {
    const msg = messages.newAssignment({ id: 7, titre: 'Exercices p.84', matiere_nom: 'Maths', date: '2026-10-20' });
    assert.equal(msg.title, '📚 Nouveau devoir · Maths');
    assert.equal(msg.body, 'Exercices p.84 · pour mardi 20 octobre');
    assert.equal(msg.url, '/dashboard/?devoir=7');
    assert.equal(msg.tag, 'devoir-7');
  });

  test('assignment updated: the new date comes first', () => {
    const msg = messages.assignmentUpdated(
      { id: 7, titre: 'Exercices', matiere_nom: 'Maths', date: '2026-10-22' },
      [{ field: 'date' }, { field: 'description' }]
    );
    assert.equal(msg.body, 'Exercices · désormais pour jeudi 22 octobre');
  });

  test('assignment updated: list of the fields otherwise', () => {
    const msg = messages.assignmentUpdated({ id: 1, titre: 'TP' }, [{ field: 'titre' }, { field: 'description' }]);
    assert.equal(msg.body, 'TP · titre, description modifiés');
  });

  test('assignment updated: "modifié" agrees with the gender of the fields', () => {
    const body = (...fields) => messages.assignmentUpdated({ id: 1, titre: 'TP' }, fields.map((field) => ({ field }))).body;
    assert.equal(body('titre'), 'TP · titre modifié');
    assert.equal(body('description'), 'TP · description modifiée');
    assert.equal(body('description', 'matiere_id'), 'TP · description, matière modifiées');
  });

  test('reminder: one assignment -> link to it; several -> list', () => {
    const one = messages.dayBeforeReminder([{ id: 3, titre: 'Dissertation', matiere_nom: 'Philo' }]);
    assert.equal(one.title, '⏰ Pour demain');
    assert.equal(one.url, '/dashboard/?devoir=3');

    const many = messages.dayBeforeReminder([
      { id: 3, titre: 'Dissertation', matiere_nom: 'Philo' },
      { id: 4, titre: 'TP', matiere_nom: 'Physique' },
    ]);
    assert.equal(many.title, '⏰ 2 devoirs pour demain');
    assert.equal(many.body, '• Philo : Dissertation\n• Physique : TP');
    assert.equal(many.url, '/dashboard/');
  });

  test('new comment: author and text on one line, link that opens the thread, tag distinct from devoir-7', () => {
    const msg = messages.newComment({ assignmentId: 7, title: 'Exercices p.84', author: 'Léa Martin', content: 'C\'est pour lundi ?\n\nOu mardi ?' });
    assert.equal(msg.title, '💬 Exercices p.84');
    assert.equal(msg.body, 'Léa Martin : C\'est pour lundi ? Ou mardi ?');
    assert.equal(msg.url, '/dashboard/?devoir=7&commentaires=1');
    assert.equal(msg.tag, 'commentaire-7');

    const long = messages.newComment({ assignmentId: 7, title: 'T', author: 'lea', content: 'a'.repeat(2000) });
    assert.equal(long.body.length, 140);
  });

  test('long texts truncated', () => {
    assert.equal(messages.truncate('a'.repeat(200)).length, 140);
    assert.ok(messages.truncate('a'.repeat(200)).endsWith('…'));
  });
});

describe('day-before reminders', () => {
  test('tomorrow is computed in the Paris time zone (Oct 17, 23:30 UTC is Oct 18, 01:30 in Paris)', () => {
    assert.equal(tomorrowInParis(new Date('2026-10-17T23:30:00Z')), '2026-10-19');
    assert.equal(tomorrowInParis(new Date('2026-10-18T16:00:00Z')), '2026-10-19');
  });

  test('grouping by student', () => {
    const groups = groupByUser([
      { user_id: 1, id: 10, titre: 'A', matiere_nom: 'M' },
      { user_id: 2, id: 10, titre: 'A', matiere_nom: 'M' },
      { user_id: 1, id: 11, titre: 'B', matiere_nom: 'N' },
    ]);
    assert.equal(groups.get(1).length, 2);
    assert.equal(groups.get(2).length, 1);
  });
});

describe('subscriptions', () => {
  const valid = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } } };

  test('valid subscription accepted', () => {
    assert.deepEqual(push.parseSubscription(valid), { endpoint: valid.subscription.endpoint, p256dh: 'p', auth: 'a' });
  });

  test('invalid subscriptions refused', () => {
    assert.equal(push.parseSubscription({}), null);
    assert.equal(push.parseSubscription({ subscription: { endpoint: 'http://insecure', keys: { p256dh: 'p', auth: 'a' } } }), null);
    assert.equal(push.parseSubscription({ subscription: { endpoint: 'https://x', keys: {} } }), null);
  });

  test('only the browsers\' push services are accepted', () => {
    const withEndpoint = (endpoint) => push.parseSubscription({ subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } } });
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      assert.ok(withEndpoint(endpoint), endpoint);
    }
    for (const endpoint of [
      'https://127.0.0.1:3306/',
      'https://localhost/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://fcm.googleapis.com.attaquant.fr/abc',
      'https://attaquant.fr/.notify.windows.com',
      'https://user@fcm.googleapis.com/abc',
    ]) {
      assert.equal(withEndpoint(endpoint), null, endpoint);
    }
  });

  test('number of devices limited per account, except for a subscription already saved', async () => {
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'p', auth: 'a' };
    fake.calls.length = 0;
    fake.setHandler((method, sql) => (method === 'get' && sql.includes('COUNT') ? { n: 10 } : undefined));
    assert.equal(await push.saveSubscription(1, sub), false);
    assert.ok(!fake.calls.some((c) => c.method === 'run'));

    fake.setHandler((method, sql) => (method === 'get' && sql.includes('COUNT') ? { n: 9 } : undefined));
    assert.equal(await push.saveSubscription(1, sub), true);
    const count = fake.calls.find((c) => c.method === 'get');
    assert.match(count.sql, /endpoint_hash <> \?/);
  });

  test('user agent saved, truncated to 255 characters', async () => {
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'p', auth: 'a' };
    fake.calls.length = 0;
    fake.setHandler((method) => (method === 'get' ? { n: 0 } : undefined));
    await push.saveSubscription(1, sub, 'x'.repeat(300));
    const insert = fake.calls.find((c) => c.method === 'run');
    assert.equal(insert.params.at(-1), 'x'.repeat(255));
  });

  test('readable device name from the user agent', () => {
    const cases = {
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36': 'Chrome sur Android',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1': 'Safari sur iPhone',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0': 'Edge sur Windows',
      'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0': 'Firefox sur Linux',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15': 'Safari sur Mac',
    };
    for (const [userAgent, expected] of Object.entries(cases)) {
      assert.equal(push.describeUserAgent(userAgent), expected);
    }
    assert.equal(push.describeUserAgent(null), 'Appareil inconnu');
  });

  test('removing a device: limited to the subscriptions of the account', async () => {
    fake.calls.length = 0;
    fake.setHandler(() => undefined);
    assert.equal(await push.deleteSubscriptionById(1, 7), false);
    const del = fake.calls.find((c) => c.method === 'run');
    assert.match(del.sql, /WHERE id = \? AND user_id = \?/);
    assert.deepEqual(del.params, [7, 1]);
  });

  test('device list: readable name, raw user agent not sent back', async () => {
    fake.setHandler((method) => (method === 'all'
      ? [{ id: 3, endpoint_hash: 'h', user_agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', created_at: 'c', last_success_at: null }]
      : undefined));
    assert.deepEqual(await push.listSubscriptions(1), [
      { id: 3, endpoint_hash: 'h', created_at: 'c', last_success_at: null, appareil: 'Firefox sur Linux' },
    ]);
  });

  test('default preferences: everything enabled, comments of the followed threads', async () => {
    fake.setHandler(() => undefined);
    assert.deepEqual(await push.getPreferences(1), { nouveau_devoir: true, devoir_modifie: true, rappel_veille: true, nouveau_commentaire: 'participe' });
  });

  test('preferences read from the database: booleans and comment choice', async () => {
    const row = { user_id: 1, nouveau_devoir: 1, devoir_modifie: 0, rappel_veille: 1, nouveau_commentaire: 'tous' };
    fake.setHandler((method, sql) => (method === 'get' && sql.includes('push_preferences') ? row : undefined));
    assert.deepEqual(await push.getPreferences(1), { nouveau_devoir: true, devoir_modifie: false, rappel_veille: true, nouveau_commentaire: 'tous' });
  });

  test('preferences: nouveau_commentaire saved with the others', async () => {
    fake.calls.length = 0;
    fake.setHandler(() => undefined);
    const prefs = await push.setPreferences(1, { nouveau_commentaire: 'tous' });
    assert.equal(prefs.nouveau_commentaire, 'tous');
    const insert = fake.calls.find((c) => c.method === 'run' && c.sql.includes('push_preferences'));
    assert.match(insert.sql, /nouveau_commentaire = VALUES\(nouveau_commentaire\)/);
    assert.deepEqual(insert.params, [1, true, true, true, 'tous']);
  });

  test('preferences: unknown comment choice ignored', async () => {
    fake.setHandler(() => undefined);
    for (const value of ['x', true, false, null]) {
      assert.equal((await push.setPreferences(1, { nouveau_commentaire: value })).nouveau_commentaire, 'participe');
    }
  });
});

describe('sending', () => {
  test('notifyClass excludes the author, sends to everyone and deletes expired subscriptions', async (t) => {
    const subs = [
      { id: 1, endpoint: 'https://push.example/ok', p256dh: 'p', auth: 'a' },
      { id: 2, endpoint: 'https://push.example/gone', p256dh: 'p', auth: 'a' },
    ];
    fake.calls.length = 0;
    fake.setHandler((method, sql) => (method === 'all' && sql.includes('push_subscriptions') ? subs : undefined));

    const sent = [];
    t.mock.method(webpush, 'sendNotification', async (sub, body) => {
      sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) });
      if (sub.endpoint.endsWith('/gone')) {
        throw Object.assign(new Error('Gone'), { statusCode: 410 });
      }
      return { statusCode: 201 };
    });

    const payload = messages.newAssignment({ id: 9, titre: 'T', matiere_nom: 'M', date: '2026-10-20' });
    const stats = await push.notifyClass(5, 'nouveau_devoir', payload, 42);

    assert.deepEqual(stats, { sent: 1, removed: 1, failed: 0 });
    assert.equal(sent.length, 2);
    assert.equal(sent[0].body.url, '/dashboard/?devoir=9');

    const select = fake.calls.find((c) => c.method === 'all');
    assert.deepEqual(select.params, [5, 42]);
    assert.match(select.sql, /pp\.nouveau_devoir/);
    assert.ok(fake.calls.some((c) => c.method === 'run' && /DELETE FROM push_subscriptions/.test(c.sql) && c.params[0] === 2));
  });

  test('no "devoir modifié" right after the creation', async (t) => {
    const sendMock = t.mock.method(webpush, 'sendNotification', async () => ({ statusCode: 201 }));
    const subs = [{ id: 1, endpoint: 'https://push.example/ok', p256dh: 'p', auth: 'a' }];
    const assignment = { id: 9, titre: 'T', date: null };

    fake.setHandler((method, sql) => {
      if (method === 'get' && sql.includes('created_at')) return { recent: 1 };
      return method === 'all' ? subs : undefined;
    });
    assert.equal(await push.notifyAssignmentUpdated(5, assignment, [{ field: 'titre' }], 42), null);
    assert.equal(sendMock.mock.callCount(), 0);

    fake.setHandler((method, sql) => {
      if (method === 'get' && sql.includes('created_at')) return { recent: 0 };
      return method === 'all' ? subs : undefined;
    });
    assert.deepEqual(await push.notifyAssignmentUpdated(5, assignment, [{ field: 'titre' }], 42), { sent: 1, removed: 0, failed: 0 });
    assert.equal(sendMock.mock.callCount(), 1);
  });

  test('notifyComment: according to everyone\'s choice, participants of the assignment by default', async (t) => {
    const sendMock = t.mock.method(webpush, 'sendNotification', async () => ({ statusCode: 201 }));
    const subs = [{ id: 1, endpoint: 'https://push.example/ok', p256dh: 'p', auth: 'a' }];
    fake.calls.length = 0;
    fake.setHandler((method) => (method === 'all' ? subs : undefined));

    const payload = messages.newComment({ assignmentId: 10, title: 'T', author: 'Léa', content: 'Question' });
    assert.deepEqual(await push.notifyComment(5, 10, payload, 42), { sent: 1, removed: 0, failed: 0 });
    assert.equal(sendMock.mock.callCount(), 1);

    const select = fake.calls.find((c) => c.method === 'all');
    assert.deepEqual(select.params, [5, 42, 'participe', 10]);
    assert.match(select.sql, /COALESCE\(pp\.nouveau_commentaire, \?\)/);
    assert.match(select.sql, /WHEN 'tous' THEN TRUE/);
    assert.match(select.sql, /WHEN 'participe' THEN EXISTS \(\s*SELECT 1 FROM devoir_commentaires dc WHERE dc\.devoir_id = \? AND dc\.user_id = u\.id/);
    assert.match(select.sql, /ELSE FALSE/);
  });

  test('unknown preference refused (no injection in the query); nouveau_commentaire goes through notifyComment', async () => {
    await assert.rejects(() => push.notifyClass(1, 'x; DROP TABLE users', {}), /Unknown preference/);
    await assert.rejects(() => push.notifyClass(1, 'nouveau_commentaire', {}), /Unknown preference/);
  });
});
