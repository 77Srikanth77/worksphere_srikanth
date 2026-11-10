-- 005: employee document vault (passport, visa stamp, I-94, I-797, EAD, I-20, I-9, ...)
-- with document numbers, issue/expiry dates and an HR review step, plus expiry-alert bookkeeping.

CREATE TABLE documents_new (
  document_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL,                      -- PASSPORT, VISA_STAMP, I94, I797, LCA, EAD, I20, I983, I9, ... (api-node/src/utils/documentTypes.js)
  doc_number   TEXT,                               -- passport no., I-94 no., receipt no. ...
  issue_date   TEXT,
  expiry_date  TEXT,
  file_name    TEXT NOT NULL,
  file_path    TEXT NOT NULL,                      -- stored name under api-node/uploads/documents/
  content_type TEXT,
  size_bytes   INTEGER,
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
  review_note  TEXT,
  reviewed_by  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_at  TEXT,
  notes        TEXT,
  uploaded_by  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  uploaded_at  TEXT DEFAULT (datetime('now','localtime'))
);
-- Documents uploaded before this migration were added by HR / Legal: treat them as verified
INSERT INTO documents_new (document_id, employee_id, doc_type, file_name, file_path, status, uploaded_by, uploaded_at)
SELECT document_id, employee_id, doc_type, file_name, file_path, 'VERIFIED', uploaded_by, uploaded_at FROM documents;
DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;
CREATE INDEX idx_documents_employee ON documents(employee_id, doc_type);
CREATE INDEX idx_documents_expiry ON documents(expiry_date);

-- One row per (document, threshold) so each expiry reminder is sent once
CREATE TABLE document_alerts (
  alert_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id    INTEGER NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  threshold_days INTEGER NOT NULL,                 -- 180 / 90 / 60 / 30, or 0 = expired
  created_at     TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE (document_id, threshold_days)
);
