const pool = require('./database');

/**
 * Query helper over the mysql2 pool.
 * Keeps an API close to better-sqlite3 (get, all, run, lastInsertRowid, changes)
 * from the time the app ran on SQLite.
 */
class DbHelper {
  /**
   * Runs a query and returns the first row.
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise<Object|undefined>}
   */
  static async get(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows[0];
  }

  /**
   * Runs a query and returns every row.
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise<Array>}
   */
  static async all(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  /**
   * Runs an INSERT, UPDATE or DELETE query.
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise<{lastInsertRowid: number, changes: number, affectedRows: number, changedRows: number}>}
   */
  static async run(sql, params = []) {
    const [result] = await pool.query(sql, params);
    return {
      lastInsertRowid: result.insertId,
      changes: result.affectedRows,
      affectedRows: result.affectedRows,
      changedRows: result.changedRows
    };
  }

  /**
   * Runs a raw SQL statement (CREATE TABLE, etc.).
   * @param {string} sql
   * @returns {Promise<void>}
   */
  static async exec(sql) {
    await pool.query(sql);
  }

  /**
   * Gets a connection from the pool, for transactions.
   * @returns {Promise<Connection>}
   */
  static async getConnection() {
    return await pool.getConnection();
  }

  /**
   * Runs `callback` inside a transaction, committed on success and rolled back on error.
   * @param {Function} callback - receives the connection
   * @returns {Promise<any>}
   */
  static async transaction(callback) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * The underlying pool, for direct use when needed.
   */
  static get pool() {
    return pool;
  }
}

module.exports = DbHelper;
