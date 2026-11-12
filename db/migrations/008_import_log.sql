-- 008: audit trail of Excel imports (who imported what, when, and how many rows changed)
CREATE TABLE import_log (
  import_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  import_type  TEXT NOT NULL,                       -- EMPLOYEES, WORK, IMMIGRATION, WORK_DETAILS
  file_name    TEXT,
  created      INTEGER NOT NULL DEFAULT 0,
  updated      INTEGER NOT NULL DEFAULT 0,
  skipped      INTEGER NOT NULL DEFAULT 0,
  details      TEXT,                                -- JSON: row-level summary (row number, action, key)
  imported_by  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  imported_at  TEXT DEFAULT (datetime('now','localtime'))
);
