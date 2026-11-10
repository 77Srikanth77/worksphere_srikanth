-- 003: weekly timesheets entered by the employee and approved by HR.
-- Hours are stored per day so they can be summed for any invoice or payroll period.

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
