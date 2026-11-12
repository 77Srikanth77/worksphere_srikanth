-- 010: H-1B cap cases Legal files each season (mirrors Legal's "Cap cases" Excel sheet).
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
  updated_at        TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ux_cap_case_person ON h1b_cap_cases(cap_year, lower(trim(first_name)), lower(trim(last_name)));
CREATE INDEX idx_cap_case_employee ON h1b_cap_cases(employee_id);

CREATE TRIGGER trg_cap_case_updated AFTER UPDATE ON h1b_cap_cases
BEGIN
  UPDATE h1b_cap_cases SET updated_at = CURRENT_TIMESTAMP WHERE case_id = NEW.case_id;
END;
