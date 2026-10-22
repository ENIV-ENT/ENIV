const path = require('path');

/**
 * Replaces backend/models/dbHelper with a fake database for unit tests: the real
 * module opens a MySQL connection as soon as it is loaded.
 *
 * Call it BEFORE loading the tested module. Each query is recorded in `calls`,
 * and `handler(method, sql, params)` provides the answer.
 */
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
