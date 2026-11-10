/**
 * Applies db/migrations/*.sql that have not run yet, in file-name order.
 *   npm run db:migrate
 * Each migration runs in one transaction with foreign keys off (needed to rebuild
 * tables), then the foreign keys are checked before committing.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');

const DIR = path.resolve(__dirname, '../../db/migrations');

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
const pending = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => !done.has(path.basename(f, '.sql')));

if (!pending.length) {
  console.log('Database is up to date.');
  process.exit(0);
}

db.exec('PRAGMA foreign_keys = OFF');
for (const file of pending) {
  const version = path.basename(file, '.sql');
  db.exec('BEGIN');
  try {
    db.exec(fs.readFileSync(path.join(DIR, file), 'utf8'));
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length) throw new Error(`Foreign key check failed: ${JSON.stringify(broken.slice(0, 3))}`);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    db.exec('COMMIT');
    console.log(`Applied ${version}`);
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(`Migration ${version} failed and was rolled back: ${err.message}`);
    process.exit(1);
  }
}
db.exec('PRAGMA foreign_keys = ON');
db.close();
