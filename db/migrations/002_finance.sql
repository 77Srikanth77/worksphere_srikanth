-- 002: billing & receivables. Kept in separate tables so bill rates and balances are only
-- reachable through the finance API (HR / CEO / ADMIN), never through work, employee or profile endpoints.
-- Money is stored in whole cents (INTEGER) so totals never drift.

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
