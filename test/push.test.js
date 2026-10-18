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

  test('préférence inconnue refusée (pas d\'injection dans la requête)', async () => {
    await assert.rejects(() => push.notifyClasse(1, 'x; DROP TABLE users', {}), /Préférence inconnue/);
  });
});
