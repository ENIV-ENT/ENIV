const pool = require('./database');

/**
 * Helper pour adapter la syntaxe SQLite vers MySQL
 * Permet de garder une API similaire à better-sqlite3 tout en utilisant mysql2
 */
class DbHelper {
  /**
   * Exécute une requête et retourne le premier résultat
   * @param {string} sql - Requête SQL
   * @param {Array} params - Paramètres de la requête
   * @returns {Promise<Object|undefined>}
   */
  static async get(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows[0];
  }

  /**
   * Exécute une requête et retourne tous les résultats
   * @param {string} sql - Requête SQL
   * @param {Array} params - Paramètres de la requête
   * @returns {Promise<Array>}
   */
  static async all(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  /**
   * Exécute une requête INSERT, UPDATE ou DELETE
   * @param {string} sql - Requête SQL
   * @param {Array} params - Paramètres de la requête
   * @returns {Promise<Object>} - Retourne { insertId, affectedRows, changedRows }
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
   * Exécute une requête SQL brute (pour CREATE TABLE, etc.)
   * @param {string} sql - Requête SQL
   * @returns {Promise<void>}
   */
  static async exec(sql) {
    await pool.query(sql);
  }

  /**
   * Obtient une connexion du pool pour les transactions
   * @returns {Promise<Connection>}
   */
  static async getConnection() {
    return await pool.getConnection();
  }

  /**
   * Exécute une transaction
   * @param {Function} callback - Fonction callback à exécuter dans la transaction
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
   * Retourne le pool pour utilisation directe si nécessaire
   */
  static get pool() {
    return pool;
  }
}

module.exports = DbHelper;
