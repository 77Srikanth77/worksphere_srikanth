-- 004: client-approved timesheet copies, and a per-assignment flag for vendors/clients that require one.

-- 1 = the vendor/client requires a client-approved timesheet for every week of this assignment
ALTER TABLE work ADD COLUMN client_timesheet_required INTEGER NOT NULL DEFAULT 0;

CREATE TABLE timesheet_attachments (
  attachment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  timesheet_id  INTEGER NOT NULL REFERENCES timesheets(timesheet_id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,                       -- original name shown to users
  file_path     TEXT NOT NULL,                       -- stored name under api-node/uploads/timesheets/
  content_type  TEXT,
  size_bytes    INTEGER,
  uploaded_by   INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  uploaded_at   TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_ts_attachments ON timesheet_attachments(timesheet_id);
