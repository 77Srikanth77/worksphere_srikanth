-- 001: submission follow-up tracking + Marketing Manager role.
-- Applied by `npm run db:migrate` (api-node), which runs this inside a transaction
-- with foreign keys switched off so the submissions table can be rebuilt.

INSERT OR IGNORE INTO roles (role_name) VALUES ('MARKETING_MANAGER');

-- Rebuild submissions: wider status list + follow-up columns.
CREATE TABLE submissions_new (
  submission_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id         TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  agent_user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  vendor_id           INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
  client_name         TEXT,
  job_title           TEXT,
  rate                TEXT,
  position_ref        TEXT,
  vendor_contact_name TEXT,
  submitted_on        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
                        'SUBMITTED','ACKNOWLEDGED','SCREENING_SCHEDULED','SCREENING_DONE','CLIENT_INTERVIEW',
                        'OFFER','PLACED','REJECTED','POSITION_CLOSED','NO_RESPONSE')),
  last_activity_on    TEXT,
  next_follow_up_on   TEXT,
  closed_on           TEXT
);

-- Old SHORTLISTED (vendor liked the profile) maps to SCREENING_SCHEDULED.
INSERT INTO submissions_new (submission_id, employee_id, agent_user_id, vendor_id, client_name, job_title, rate,
                             submitted_on, status, last_activity_on, closed_on)
SELECT submission_id, employee_id, agent_user_id, vendor_id, client_name, job_title, rate, submitted_on,
       CASE status WHEN 'SHORTLISTED' THEN 'SCREENING_SCHEDULED' ELSE status END,
       submitted_on,
       CASE WHEN status IN ('REJECTED','PLACED') THEN submitted_on END
FROM submissions;

DROP TABLE submissions;
ALTER TABLE submissions_new RENAME TO submissions;

CREATE TABLE submission_activities (
  activity_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id       INTEGER NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  user_id             INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  activity_type       TEXT NOT NULL CHECK (activity_type IN ('SUBMITTED','FOLLOW_UP','EMPLOYEE_FEEDBACK','UPDATE_REQUEST')),
  channel             TEXT CHECK (channel IN ('CALL','EMAIL','PORTAL','LINKEDIN','OTHER')),
  vendor_contact_name TEXT,
  vendor_feedback     TEXT,
  note                TEXT,
  from_status         TEXT,
  to_status           TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_activities_submission ON submission_activities(submission_id);

-- Start every existing submission's timeline with its submission date.
INSERT INTO submission_activities (submission_id, user_id, activity_type, to_status, created_at)
SELECT submission_id, agent_user_id, 'SUBMITTED', 'SUBMITTED', submitted_on || ' 09:00:00' FROM submissions;

CREATE TABLE update_requests (
  request_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  message       TEXT,
  requested_on  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolved_on   TEXT,
  escalated_on  TEXT
);
