-- 006: job postings that marketing agents send to matching employees, and in-app notifications.

CREATE TABLE job_postings (
  posting_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_user_id  INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  client_name    TEXT,
  vendor_id      INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
  location       TEXT,
  work_mode      TEXT CHECK (work_mode IN ('ONSITE','HYBRID','REMOTE')),
  duration       TEXT,                              -- e.g. "12 months, extendable"
  rate           TEXT,                              -- internal: never shown to employees
  skills         TEXT,                              -- comma-separated required skills
  description    TEXT NOT NULL,                     -- job duties
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_at     TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_postings_agent ON job_postings(agent_user_id);

CREATE TABLE job_posting_recipients (
  posting_id    INTEGER NOT NULL REFERENCES job_postings(posting_id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  match_score   INTEGER,                            -- 0-100 when sent
  sent_at       TEXT DEFAULT (datetime('now','localtime')),
  seen_at       TEXT,
  response      TEXT NOT NULL DEFAULT 'PENDING' CHECK (response IN ('PENDING','INTERESTED','NOT_INTERESTED')),
  response_note TEXT,
  responded_at  TEXT,
  submission_id INTEGER REFERENCES submissions(submission_id) ON DELETE SET NULL,
  PRIMARY KEY (posting_id, employee_id)
);
CREATE INDEX idx_recipients_employee ON job_posting_recipients(employee_id);

-- In-app notifications (bell in the top bar)
CREATE TABLE notifications (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type            TEXT NOT NULL,                    -- JOB_POSTING, JOB_RESPONSE, TIMESHEET_REJECTED, DOCUMENT_REJECTED, SUBMISSION_UPDATE, UPDATE_REQUEST
  title           TEXT NOT NULL,
  body            TEXT,
  link            TEXT,                             -- app path to open, e.g. /my-jobs/12
  created_at      TEXT DEFAULT (datetime('now','localtime')),
  read_at         TEXT
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
