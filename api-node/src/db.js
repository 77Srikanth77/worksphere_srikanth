const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, no native build needed

// One SQLite file shared with the Python service. Default: <project>/db/worksphere.db
const DB_FILE = path.resolve(__dirname, '..', process.env.DB_FILE || '../db/worksphere.db');

if (!fs.existsSync(DB_FILE)) {
  console.error(`Database file not found: ${DB_FILE}\nCreate it with: npm run db:reset`);
  process.exit(1);
}

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');   // readers don't block the writer
db.exec('PRAGMA foreign_keys = ON');    // SQLite enforces FKs only when asked
db.exec('PRAGMA busy_timeout = 5000');  // wait up to 5s if the Python service is writing

// SQLite can't bind JS booleans or undefined
const toParam = (v) => (v === true ? 1 : v === false ? 0 : v === undefined ? null : v);

/**
 * Run a query. SELECTs return an array of plain row objects; writes return
 * { insertId, affectedRows } (same shape the routes already use).
 * Kept async so route code reads the same as with any other driver.
 */
async function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const values = params.map(toParam);
    if (stmt.columns().length) return stmt.all(...values).map((row) => ({ ...row }));
    const info = stmt.run(...values);
    return { insertId: Number(info.lastInsertRowid), affectedRows: Number(info.changes) };
  } catch (err) {
    // node:sqlite reports code 'ERR_SQLITE_ERROR' plus a numeric errcode;
    // map it to the SQLite name the error handler in server.js checks for.
    if (err.code === 'ERR_SQLITE_ERROR' && SQLITE_CODES[err.errcode]) err.code = SQLITE_CODES[err.errcode];
    throw err;
  }
}

// SQLite (extended) result codes -> names
const SQLITE_CODES = {
  5: 'SQLITE_BUSY',
  275: 'SQLITE_CONSTRAINT_CHECK',
  787: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  1299: 'SQLITE_CONSTRAINT_NOTNULL',
  1555: 'SQLITE_CONSTRAINT_PRIMARYKEY',
  2067: 'SQLITE_CONSTRAINT_UNIQUE',
};

module.exports = { db, query, DB_FILE };
