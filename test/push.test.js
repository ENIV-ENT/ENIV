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
const { demainParis, grouperParUtilisateur } = require('../backend/services/pushReminders');

describe('messages', () => {
  test('nouveau devoir : matière, titre, date en toutes lettres et lien direct', () => {
    const msg = messages.nouveauDevoir({ id: 7, titre: 'Exercices p.84', matiere_nom: 'Maths', date: '2026-10-20' });
    assert.equal(msg.title, '📚 Nouveau devoir · Maths');
    assert.equal(msg.body, 'Exercices p.84 — pour mardi 20 octobre');
    assert.equal(msg.url, '/dashboard/?devoir=7');
    assert.equal(msg.tag, 'devoir-7');
  });

  test('devoir modifié : la nouvelle date est mise en avant', () => {
    const msg = messages.devoirModifie(
      { id: 7, titre: 'Exercices', matiere_nom: 'Maths', date: '2026-10-22' },
      [{ field: 'date' }, { field: 'description' }]
    );
    assert.equal(msg.body, 'Exercices — désormais pour jeudi 22 octobre');
  });

  test('devoir modifié : liste des champs sinon', () => {
    const msg = messages.devoirModifie({ id: 1, titre: 'TP' }, [{ field: 'titre' }, { field: 'description' }]);
    assert.equal(msg.body, 'TP — titre, description modifiés');
  });

  test('devoir modifié : « modifié » accordé au genre des champs', () => {
    const body = (...fields) => messages.devoirModifie({ id: 1, titre: 'TP' }, fields.map((field) => ({ field }))).body;
    assert.equal(body('titre'), 'TP — titre modifié');
    assert.equal(body('description'), 'TP — description modifiée');
    assert.equal(body('description', 'matiere_id'), 'TP — description, matière modifiées');
  });

  test('rappel : un devoir -> lien vers le devoir ; plusieurs -> liste', () => {
    const one = messages.rappelVeille([{ id: 3, titre: 'Dissertation', matiere_nom: 'Philo' }]);
    assert.equal(one.title, '⏰ Pour demain');
    assert.equal(one.url, '/dashboard/?devoir=3');

    const many = messages.rappelVeille([
      { id: 3, titre: 'Dissertation', matiere_nom: 'Philo' },
      { id: 4, titre: 'TP', matiere_nom: 'Physique' },
    ]);
    assert.equal(many.title, '⏰ 2 devoirs pour demain');
    assert.equal(many.body, '• Philo : Dissertation\n• Physique : TP');
    assert.equal(many.url, '/dashboard/');
  });

  test('textes longs tronqués', () => {
    assert.equal(messages.truncate('a'.repeat(200)).length, 140);
    assert.ok(messages.truncate('a'.repeat(200)).endsWith('…'));
  });
});

describe('rappels de la veille', () => {
  test('demain est calculé dans le fuseau de Paris', () => {
    // 17 oct. 2026 à 23h30 UTC = 18 oct. 1h30 à Paris : demain = 19
    assert.equal(demainParis(new Date('2026-10-17T23:30:00Z')), '2026-10-19');
    assert.equal(demainParis(new Date('2026-10-18T16:00:00Z')), '2026-10-19');
  });

  test('regroupement par élève', () => {
    const groupes = grouperParUtilisateur([
      { user_id: 1, id: 10, titre: 'A', matiere_nom: 'M' },
      { user_id: 2, id: 10, titre: 'A', matiere_nom: 'M' },
      { user_id: 1, id: 11, titre: 'B', matiere_nom: 'N' },
    ]);
    assert.equal(groupes.get(1).length, 2);
    assert.equal(groupes.get(2).length, 1);
  });
});

describe('abonnements', () => {
  const valid = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } } };

  test('abonnement valide accepté', () => {
    assert.deepEqual(push.parseSubscription(valid), { endpoint: valid.subscription.endpoint, p256dh: 'p', auth: 'a' });
  });

  test('abonnements invalides refusés', () => {
    assert.equal(push.parseSubscription({}), null);
    assert.equal(push.parseSubscription({ subscription: { endpoint: 'http://insecure', keys: { p256dh: 'p', auth: 'a' } } }), null);
    assert.equal(push.parseSubscription({ subscription: { endpoint: 'https://x', keys: {} } }), null);
  });

  test('seuls les services push des navigateurs sont acceptés', () => {
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

  test('nombre d\'appareils limité par compte, sauf pour un abonnement déjà enregistré', async () => {
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

  test('préférences par défaut : tout activé', async () => {
    fake.setHandler(() => undefined);
    assert.deepEqual(await push.getPreferences(1), { nouveau_devoir: true, devoir_modifie: true, rappel_veille: true });
  });
});

describe('envoi', () => {
  test('notifyClasse exclut l\'auteur, envoie à chacun et supprime les abonnements expirés', async (t) => {
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

    const payload = messages.nouveauDevoir({ id: 9, titre: 'T', matiere_nom: 'M', date: '2026-10-20' });
    const stats = await push.notifyClasse(5, 'nouveau_devoir', payload, 42);

    assert.deepEqual(stats, { sent: 1, removed: 1, failed: 0 });
    assert.equal(sent.length, 2);
    assert.equal(sent[0].body.url, '/dashboard/?devoir=9');

    const select = fake.calls.find((c) => c.method === 'all');
    assert.deepEqual(select.params, [5, 42]);
    assert.match(select.sql, /pp\.nouveau_devoir/);
    assert.ok(fake.calls.some((c) => c.method === 'run' && /DELETE FROM push_subscriptions/.test(c.sql) && c.params[0] === 2));
  });

  test('pas de « devoir modifié » juste après la création', async (t) => {
    const sendMock = t.mock.method(webpush, 'sendNotification', async () => ({ statusCode: 201 }));
    const subs = [{ id: 1, endpoint: 'https://push.example/ok', p256dh: 'p', auth: 'a' }];
    const devoir = { id: 9, titre: 'T', date: null };

    fake.setHandler((method, sql) => {
      if (method === 'get' && sql.includes('created_at')) return { recent: 1 };
      return method === 'all' ? subs : undefined;
    });
    assert.equal(await push.notifyDevoirModifie(5, devoir, [{ field: 'titre' }], 42), null);
    assert.equal(sendMock.mock.callCount(), 0);

    fake.setHandler((method, sql) => {
      if (method === 'get' && sql.includes('created_at')) return { recent: 0 };
      return method === 'all' ? subs : undefined;
    });
    assert.deepEqual(await push.notifyDevoirModifie(5, devoir, [{ field: 'titre' }], 42), { sent: 1, removed: 0, failed: 0 });
    assert.equal(sendMock.mock.callCount(), 1);
  });

  test('préférence inconnue refusée (pas d\'injection dans la requête)', async () => {
    await assert.rejects(() => push.notifyClasse(1, 'x; DROP TABLE users', {}), /Préférence inconnue/);
  });
});
