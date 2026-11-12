-- 013: LCA change reviews. When an H-1B employee's assignment changes (new client, worksite, work arrangement,
-- job title, or a new assignment), WorkSphere opens a review for Legal with a suggested outcome:
--   AMENDMENT_LIKELY  new LCA + amended H-1B petition before the change (e.g. move to another state)
--   CHECK             Legal judgment needed (another city in the same state, title change, new client)
--   POSTING           same area: post the existing LCA notice at the new worksite
-- Legal records the decision, then the filing (receipt) or the notice posting.
CREATE TABLE lca_reviews (
  review_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id        TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  work_id            INTEGER REFERENCES work(work_id) ON DELETE SET NULL,
  change_kind        TEXT NOT NULL CHECK (change_kind IN ('NEW_ASSIGNMENT', 'ASSIGNMENT_CHANGE')),
  changes            TEXT NOT NULL,                 -- JSON [{ field, label, from, to }]
  suggestion         TEXT NOT NULL CHECK (suggestion IN ('AMENDMENT_LIKELY', 'CHECK', 'POSTING')),
  reasons            TEXT NOT NULL,                 -- JSON [text]
  status             TEXT NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN', 'AMENDMENT_REQUIRED', 'AMENDMENT_FILED', 'POSTING_REQUIRED', 'POSTING_DONE', 'NO_ACTION')),
  decision_note      TEXT,                          -- Legal's reason (kept for audits)
  new_lca_number     TEXT,
  amendment_receipt  TEXT,
  amendment_filed_on TEXT,
  posting_location   TEXT,
  posted_on          TEXT,
  raised_by          INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  decided_by         INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  decided_at         TEXT,
  created_at         TEXT DEFAULT (datetime('now','localtime')),
  updated_at         TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_lca_reviews_status ON lca_reviews(status);
CREATE INDEX idx_lca_reviews_work ON lca_reviews(work_id);
