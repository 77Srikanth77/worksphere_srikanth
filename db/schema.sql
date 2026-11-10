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
-- Roles: CEO, ADMIN, HR, LEGAL, MARKETING, EMPLOYEE
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
  end_date      TEXT
);
CREATE INDEX idx_work_emp ON work(employee_id);

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
  document_id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL,                      -- RESUME, VISA_COPY, I797, LCA ...
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
);

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

-- Profiles (resumes) submitted by an agent to a vendor
CREATE TABLE submissions (
  submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT NOT NULL REFERENCES emp(employee_id) ON DELETE CASCADE,
  agent_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  vendor_id     INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
  client_name   TEXT,
  job_title     TEXT,
  rate          TEXT,
  submitted_on  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','SHORTLISTED','REJECTED','PLACED'))
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

INSERT INTO roles (role_name) VALUES
  ('CEO'), ('ADMIN'), ('HR'), ('LEGAL'), ('MARKETING'), ('EMPLOYEE');
