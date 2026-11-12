-- WorkSphere database schema (SQLite 3.35+)
-- Create the database file from the project root:
--   sqlite3 db/worksphere.db < db/schema.sql
-- Open db/worksphere.db with the VS Code "SQLite Viewer" extension to browse it.
--
-- SQLite notes:
--   * Dates are stored as TEXT 'YYYY-MM-DD' (datetimes as 'YYYY-MM-DD HH:MM:SS').
--   * Booleans are INTEGER 0 / 1.
--   * ENUMs are TEXT with a CHECK constraint.
--   * Foreign keys are enforced only when a connection runs PRAGMA foreign_keys = ON
--     (both services do this).

PRAGMA journal_mode = WAL;   -- lets the Node API and the Python service use the file at the same time
PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS lca_reviews;
DROP TABLE IF EXISTS h1b_cap_cases;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS import_log;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS job_posting_recipients;
DROP TABLE IF EXISTS job_postings;
DROP TABLE IF EXISTS document_alerts;
DROP TABLE IF EXISTS timesheet_attachments;
DROP TABLE IF EXISTS timesheet_entries;
DROP TABLE IF EXISTS timesheets;
DROP TABLE IF EXISTS invoice_payments;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS billing_rates;
DROP TABLE IF EXISTS update_requests;
DROP TABLE IF EXISTS submission_activities;
DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS weekly_status;
DROP TABLE IF EXISTS vendor_contacts;
DROP TABLE IF EXISTS interviews;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS marketing_assignments;
DROP TABLE IF EXISTS trainings;
DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS immigration;
DROP TABLE IF EXISTS work;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS vendors;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS emp;
DROP TABLE IF EXISTS roles;

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------
-- Roles: CEO, ADMIN, HR, LEGAL, MARKETING, MARKETING_MANAGER, EMPLOYEE
-- ---------------------------------------------------------------
CREATE TABLE roles (
  role_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  role_name TEXT NOT NULL UNIQUE
);

-- ---------------------------------------------------------------
-- EMP: employee master table
-- ---------------------------------------------------------------
CREATE TABLE emp (
  employee_id              TEXT PRIMARY KEY CHECK (length(employee_id) <= 20),
  first_name               TEXT NOT NULL,
  middle_name              TEXT,
  last_name                TEXT NOT NULL,
  date_of_birth            TEXT,
  hire_date                TEXT NOT NULL,
  email                    TEXT NOT NULL UNIQUE,
  phone_number             TEXT,
  emergency_contact_name   TEXT,
  emergency_contact_number TEXT,
  bio                      TEXT,
  created_at               TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at               TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_emp_updated AFTER UPDATE ON emp
BEGIN
  UPDATE emp SET updated_at = CURRENT_TIMESTAMP WHERE employee_id = NEW.employee_id;
END;

-- ---------------------------------------------------------------
-- USERS: login accounts. Employees link to EMP; staff (CEO, HR,
-- Legal, Marketing) may or may not have an EMP record.
-- ---------------------------------------------------------------
CREATE TABLE users (
  user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(role_id),
  employee_id   TEXT UNIQUE REFERENCES emp(employee_id) ON DELETE SET NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE clients (
  client_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name   TEXT NOT NULL,
  contact_name  TEXT,
  contact_email TEXT,
  phone         TEXT,
  address       TEXT
);

CREATE TABLE vendors (
  vendor_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name   TEXT NOT NULL,
  contact_name  TEXT,
  contact_email TEXT,
  phone         TEXT
);

-- ---------------------------------------------------------------
-- WORK: one row per assignment (current or past). end_date NULL = current.
-- status BENCH means the employee is between projects.
-- ---------------------------------------------------------------
CREATE TABLE work (
  work_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  client_id     INTEGER REFERENCES clients(client_id) ON DELETE SET NULL,
  vendor_id     INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
  project_name  TEXT,
  job_title     TEXT,
  job_duties    TEXT,
  work_location TEXT,
  city          TEXT,
  state         TEXT,
  status        TEXT NOT NULL DEFAULT 'PROJECT' CHECK (status IN ('PROJECT','BENCH')),
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  client_timesheet_required INTEGER NOT NULL DEFAULT 0,  -- vendor/client wants a client-approved timesheet each week
  worksite_address     TEXT,                              -- street address of the client worksite
  worksite_zip         TEXT,
  client_manager_name  TEXT,                              -- who the employee reports to at the client
  client_manager_title TEXT,
  client_manager_email TEXT,
  client_manager_phone TEXT,
  lca_case_number      TEXT,                              -- certified LCA covering this worksite
  lca_wage_cents       INTEGER CHECK (lca_wage_cents IS NULL OR lca_wage_cents > 0),  -- wage on the LCA (Legal/HR/CEO only)
  lca_wage_unit        TEXT CHECK (lca_wage_unit IS NULL OR lca_wage_unit IN ('YEAR','HOUR'))
);
CREATE INDEX idx_work_emp ON work(employee_id);

-- Job title required on every assignment (see db/migrations/011_work_job_title_required.sql)
CREATE TRIGGER trg_work_title_insert BEFORE INSERT ON work
WHEN trim(coalesce(NEW.job_title, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'Job title is required for every assignment.');
END;

CREATE TRIGGER trg_work_title_update BEFORE UPDATE OF job_title ON work
WHEN trim(coalesce(NEW.job_title, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'Job title is required for every assignment.');
END;

-- ---------------------------------------------------------------
-- IMMIGRATION: visa + LCA details per employee
-- ---------------------------------------------------------------
CREATE TABLE immigration (
  visa_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id      TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  visa_type        TEXT NOT NULL,                 -- H1B, L1, OPT, STEM-OPT, GC-EAD ...
  receipt_number   TEXT,
  start_date       TEXT,
  expiry_date      TEXT NOT NULL,
  lca_number       TEXT,
  lca_start_date   TEXT,
  lca_expiry_date  TEXT,
  case_status      TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (case_status IN ('ACTIVE','IN_PROGRESS','FILED','RENEWED','EXPIRED')),
  notes            TEXT,
  updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_imm_expiry ON immigration(expiry_date);
CREATE INDEX idx_imm_lca_expiry ON immigration(lca_expiry_date);

CREATE TRIGGER trg_imm_updated AFTER UPDATE ON immigration
BEGIN
  UPDATE immigration SET updated_at = CURRENT_TIMESTAMP WHERE visa_id = NEW.visa_id;
END;

CREATE TABLE documents (
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
CREATE INDEX idx_documents_employee ON documents(employee_id, doc_type);
CREATE INDEX idx_documents_expiry ON documents(expiry_date);

-- ---------------------------------------------------------------
-- ALERTS: written by the FastAPI scheduler. The unique constraint makes each
-- threshold (180/90/60/30 days, 0 = expired) fire only once per visa/LCA date.
-- ---------------------------------------------------------------
CREATE TABLE alerts (
  alert_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  visa_id        INTEGER NOT NULL REFERENCES immigration(visa_id) ON DELETE CASCADE,
  employee_id    TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  alert_type     TEXT NOT NULL CHECK (alert_type IN ('VISA','LCA')),
  threshold_days INTEGER NOT NULL,
  expiry_date    TEXT NOT NULL,
  message        TEXT NOT NULL,
  is_read        INTEGER NOT NULL DEFAULT 0,
  emailed        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (visa_id, alert_type, threshold_days, expiry_date)
);

CREATE TABLE trainings (
  training_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  training_name TEXT NOT NULL,
  provider      TEXT,
  start_date    TEXT,
  end_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED'))
);

-- Which marketing agent markets which (bench) employee
CREATE TABLE marketing_assignments (
  assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  assigned_on   TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1
);

-- Profiles (resumes) submitted by an agent to a vendor.
-- Pipeline: SUBMITTED -> ACKNOWLEDGED -> SCREENING_SCHEDULED -> SCREENING_DONE -> CLIENT_INTERVIEW -> OFFER -> PLACED
-- Closed outcomes: PLACED, REJECTED, POSITION_CLOSED, NO_RESPONSE (no more follow-ups needed)
CREATE TABLE submissions (
  submission_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id         TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  agent_user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  vendor_id           INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
  client_name         TEXT,
  job_title           TEXT,
  rate                TEXT,                         -- internal: never shown to the employee
  position_ref        TEXT,                         -- vendor's requirement / job ID
  vendor_contact_name TEXT,                         -- recruiter at the vendor
  submitted_on        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
                        'SUBMITTED','ACKNOWLEDGED','SCREENING_SCHEDULED','SCREENING_DONE','CLIENT_INTERVIEW',
                        'OFFER','PLACED','REJECTED','POSITION_CLOSED','NO_RESPONSE')),
  last_activity_on    TEXT,                         -- last follow-up / stage change by the agent
  next_follow_up_on   TEXT,                         -- when the agent plans to follow up next
  closed_on           TEXT
);

-- Timeline of every submission: follow-ups, stage changes, employee feedback, update requests
CREATE TABLE submission_activities (
  activity_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id       INTEGER NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  user_id             INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  activity_type       TEXT NOT NULL CHECK (activity_type IN ('SUBMITTED','FOLLOW_UP','EMPLOYEE_FEEDBACK','UPDATE_REQUEST')),
  channel             TEXT CHECK (channel IN ('CALL','EMAIL','PORTAL','LINKEDIN','OTHER')),
  vendor_contact_name TEXT,
  vendor_feedback     TEXT,                         -- what the vendor said (shown to the employee)
  note                TEXT,                         -- agent note / employee feedback (shown to the employee)
  from_status         TEXT,
  to_status           TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_activities_submission ON submission_activities(submission_id);

-- "Request update" from a bench employee; escalated to Marketing Manager + CEO if not answered in time
CREATE TABLE update_requests (
  request_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  message       TEXT,
  requested_on  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolved_on   TEXT,                               -- set when the agent logs a follow-up
  escalated_on  TEXT                                -- set by the daily job
);

CREATE TABLE interviews (
  interview_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id    TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  submission_id  INTEGER REFERENCES submissions(submission_id) ON DELETE SET NULL,
  interview_date TEXT,
  round_name     TEXT,
  mode           TEXT,                            -- PHONE, VIDEO, ONSITE
  result         TEXT NOT NULL DEFAULT 'PIPELINE'
                 CHECK (result IN ('PIPELINE','ATTENDED','AWAITING_RESULT','SELECTED','REJECTED')),
  feedback       TEXT
);

CREATE TABLE vendor_contacts (
  contact_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  vendor_id     INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
  contacted_on  TEXT NOT NULL,
  notes         TEXT
);

CREATE TABLE weekly_status (
  status_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  week_start    TEXT NOT NULL,
  summary       TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agent_user_id, week_start)
);

-- ---------------------------------------------------------------
-- Finance: bill rates, invoices, payments (see db/migrations/002_finance.sql)
-- Only the finance API (HR / CEO / ADMIN) reads these. Money in whole cents.
-- ---------------------------------------------------------------
-- What the company bills for an assignment. A new rate closes the previous one (history is kept).
CREATE TABLE billing_rates (
  rate_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id            INTEGER NOT NULL REFERENCES work(work_id) ON DELETE CASCADE,
  bill_rate_cents    INTEGER NOT NULL CHECK (bill_rate_cents > 0),
  rate_unit          TEXT NOT NULL DEFAULT 'HOUR' CHECK (rate_unit IN ('HOUR','DAY','MONTH')),
  payment_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  invoice_cycle      TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (invoice_cycle IN ('WEEKLY','BIWEEKLY','SEMIMONTHLY','MONTHLY')),
  effective_from     TEXT NOT NULL,
  effective_to       TEXT,
  notes              TEXT,
  created_at         TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_billing_rates_work ON billing_rates(work_id);

-- Invoice to the vendor (or the client directly when there is no vendor)
CREATE TABLE invoices (
  invoice_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  work_id        INTEGER REFERENCES work(work_id) ON DELETE SET NULL,
  employee_id    TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE RESTRICT,
  vendor_id      INTEGER REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  client_id      INTEGER REFERENCES clients(client_id) ON DELETE RESTRICT,
  period_start   TEXT NOT NULL,
  period_end     TEXT NOT NULL CHECK (period_end >= period_start),
  quantity       REAL NOT NULL CHECK (quantity > 0),   -- hours / days / months, per rate_unit
  rate_unit      TEXT NOT NULL DEFAULT 'HOUR' CHECK (rate_unit IN ('HOUR','DAY','MONTH')),
  rate_cents     INTEGER NOT NULL CHECK (rate_cents > 0),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  invoice_date   TEXT NOT NULL,
  due_date       TEXT NOT NULL,
  is_void        INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at     TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_invoices_vendor ON invoices(vendor_id);
CREATE INDEX idx_invoices_employee ON invoices(employee_id);

CREATE TABLE invoice_payments (
  payment_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id   INTEGER NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_on      TEXT NOT NULL,
  reference    TEXT,                                   -- cheque / ACH / wire reference
  notes        TEXT,
  created_by   INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at   TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_payments_invoice ON invoice_payments(invoice_id);

-- ---------------------------------------------------------------
-- Timesheets: employee enters daily hours per week, HR approves (see db/migrations/003_timesheets.sql)
-- ---------------------------------------------------------------
CREATE TABLE timesheets (
  timesheet_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  work_id       INTEGER NOT NULL REFERENCES work(work_id) ON DELETE CASCADE,
  week_start    TEXT NOT NULL,                       -- Monday
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  employee_note TEXT,
  submitted_at  TEXT,
  reviewed_by   INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_at   TEXT,
  review_note   TEXT,                                -- reason when rejected
  updated_at    TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE (work_id, week_start)
);
CREATE INDEX idx_timesheets_employee ON timesheets(employee_id, week_start);
CREATE INDEX idx_timesheets_status ON timesheets(status);

CREATE TABLE timesheet_entries (
  entry_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  timesheet_id INTEGER NOT NULL REFERENCES timesheets(timesheet_id) ON DELETE CASCADE,
  work_date    TEXT NOT NULL,
  hours        REAL NOT NULL CHECK (hours >= 0 AND hours <= 24),
  UNIQUE (timesheet_id, work_date)
);
CREATE INDEX idx_entries_date ON timesheet_entries(work_date);

-- Client-approved timesheet copies (see db/migrations/004_timesheet_attachments.sql)
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

-- One row per (document, threshold) so each expiry reminder is sent once
CREATE TABLE document_alerts (
  alert_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id    INTEGER NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  threshold_days INTEGER NOT NULL,                 -- 180 / 90 / 60 / 30, or 0 = expired
  created_at     TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE (document_id, threshold_days)
);

-- Job postings + notifications (see db/migrations/006_jobs_notifications.sql)
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

-- Excel import audit trail (see db/migrations/008_import_log.sql)
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

-- Deletion audit trail (see db/migrations/009_audit_log.sql)
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

-- H-1B cap cases (see db/migrations/010_h1b_cap_cases.sql)
-- People are kept by name because many are filed for before they have an employee record;
-- employee_id links the case once they do (the register also matches on first + last name).
CREATE TABLE h1b_cap_cases (
  case_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cap_year          TEXT NOT NULL CHECK (cap_year GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),  -- filing season, e.g. 2026-27
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  employee_id       TEXT REFERENCES emp(employee_id) ON DELETE SET NULL,
  on_project        INTEGER NOT NULL DEFAULT 0 CHECK (on_project IN (0, 1)),            -- "Project" Yes / No
  vendor_name       TEXT,
  client_name       TEXT,
  job_title         TEXT,
  lca_wage_cents    INTEGER CHECK (lca_wage_cents IS NULL OR lca_wage_cents > 0),         -- "LCA Amount"
  lca_wage_unit     TEXT NOT NULL DEFAULT 'YEAR' CHECK (lca_wage_unit IN ('YEAR', 'HOUR')),
  work_mode         TEXT CHECK (work_mode IS NULL OR work_mode IN ('REMOTE', 'CLIENT_SITE', 'HYBRID')),
  lca_location      TEXT,                                                                  -- city/state or worksite address
  receipt_number    TEXT,
  case_status       TEXT NOT NULL DEFAULT 'FILED'
                    CHECK (case_status IN ('REGISTERED', 'SELECTED', 'FILED', 'RFE', 'APPROVED', 'DENIED', 'WITHDRAWN')),
  employment_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (employment_status IN ('ACTIVE', 'LEFT')),
  notes             TEXT,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  visa_id           INTEGER REFERENCES immigration(visa_id) ON DELETE SET NULL  -- set on approval (migration 012)
);
CREATE UNIQUE INDEX ux_cap_case_person ON h1b_cap_cases(cap_year, lower(trim(first_name)), lower(trim(last_name)));
CREATE INDEX idx_cap_case_employee ON h1b_cap_cases(employee_id);

CREATE TRIGGER trg_cap_case_updated AFTER UPDATE ON h1b_cap_cases
BEGIN
  UPDATE h1b_cap_cases SET updated_at = CURRENT_TIMESTAMP WHERE case_id = NEW.case_id;
END;

INSERT INTO roles (role_name) VALUES
  ('CEO'), ('ADMIN'), ('HR'), ('LEGAL'), ('MARKETING'), ('EMPLOYEE'), ('MARKETING_MANAGER');

-- LCA change reviews (see db/migrations/013_lca_reviews.sql)
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

-- Migrations already included in this schema (see db/migrations/)
CREATE TABLE schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_migrations (version) VALUES ('001_submission_followups'), ('002_finance'), ('003_timesheets'), ('004_timesheet_attachments'), ('005_employee_documents'), ('006_jobs_notifications'), ('007_work_site_manager_lca'), ('008_import_log'), ('009_audit_log'), ('010_h1b_cap_cases'), ('011_work_job_title_required'), ('012_cap_case_visa'), ('013_lca_reviews');
