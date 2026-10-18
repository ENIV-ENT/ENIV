// Remplace backend/models/dbHelper par une base factice pour les tests
// unitaires : le vrai module ouvre une connexion MySQL dès son chargement.
//
// À appeler AVANT de charger le module testé. Chaque requête est enregistrée
// dans `calls`, et `handler(method, sql, params)` fournit la réponse.

const path = require('path');

function installFakeDb(handler = () => undefined) {
  const calls = [];
  const respond = (method) => async (sql, params = []) => {
    calls.push({ method, sql, params });
    const result = await handler(method, sql, params);
    if (result !== undefined) return result;
    if (method === 'all') return [];
    if (method === 'run') return { changes: 0, affectedRows: 0, lastInsertRowid: 0 };
    return undefined;
  };

  const fake = {
    get: respond('get'),
    all: respond('all'),
    run: respond('run'),
    exec: respond('exec'),
  };

  const file = path.join(__dirname, '../../backend/models/dbHelper.js');
  require.cache[file] = { id: file, filename: file, loaded: true, exports: fake };
  return { db: fake, calls, setHandler: (h) => { handler = h; } };
}

module.exports = { installFakeDb };
