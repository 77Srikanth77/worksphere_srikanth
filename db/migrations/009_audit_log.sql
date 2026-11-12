-- 009: audit trail for deletions (a full copy of the deleted record, the reason and who did it)
CREATE TABLE audit_log (
  audit_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  entity       TEXT NOT NULL,                       -- e.g. WORK
  entity_id    TEXT NOT NULL,
  employee_id  TEXT,                                -- whose record it was (kept even if the employee is removed later)
  action       TEXT NOT NULL,                       -- DELETE
  reason       TEXT NOT NULL,
  snapshot     TEXT NOT NULL,                       -- JSON copy of the record (and what was removed with it)
  user_id      INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at   TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_audit_employee ON audit_log(employee_id);
