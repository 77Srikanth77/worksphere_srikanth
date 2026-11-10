const express = require('express');
const { query, transaction } = require('../db');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');
const { localDate } = require('../utils/followups');

/**
 * Billing & receivables. Bill rates, invoices and payments are only reachable here.
 * Read: CEO, HR (ADMIN always). Write: HR (ADMIN always).
 * Money is in whole cents in the database and in every response (*_cents).
 */
const READ = ['CEO', 'HR'];
const WRITE = ['HR'];
const UNITS = ['HOUR', 'DAY', 'MONTH'];
const CYCLES = ['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY'];

const router = express.Router();
router.use(authorize(...READ));

const toCents = (v) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + n);
  return localDate(x);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

// Every invoice with what was paid, the balance, and a computed status
const INVOICE_SQL = `
  SELECT i.*, e.first_name || ' ' || e.last_name AS employee_name,
         v.vendor_name, c.client_name,
         COALESCE(v.vendor_name, c.client_name) AS bill_to,
         CASE WHEN i.vendor_id IS NOT NULL THEN 'VENDOR' ELSE 'CLIENT' END AS bill_to_type,
         COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.invoice_id), 0) AS paid_cents,
         (SELECT MAX(p.paid_on) FROM invoice_payments p WHERE p.invoice_id = i.invoice_id) AS last_paid_on
  FROM invoices i
  JOIN emp e ON e.employee_id = i.employee_id
  LEFT JOIN vendors v ON v.vendor_id = i.vendor_id
  LEFT JOIN clients c ON c.client_id = i.client_id`;

function decorate(inv, today = localDate()) {
  const balance = inv.is_void ? 0 : inv.amount_cents - inv.paid_cents;
  const overdueDays = balance > 0 ? Math.max(0, daysBetween(inv.due_date, today)) : 0;
  let status = 'OPEN';
  if (inv.is_void) status = 'VOID';
  else if (balance <= 0) status = 'PAID';
  else if (overdueDays > 0) status = 'OVERDUE';
  else if (inv.paid_cents > 0) status = 'PARTIAL';
  return { ...inv, balance_cents: balance, days_overdue: overdueDays, status };
}

const bucket = (inv) => {
  if (inv.balance_cents <= 0) return null;
  const d = inv.days_overdue;
  if (d === 0) return 'current';
  if (d <= 30) return 'd1_30';
  if (d <= 60) return 'd31_60';
  if (d <= 90) return 'd61_90';
  return 'd90_plus';
};

async function allInvoices(where = '', params = []) {
  const rows = await query(`${INVOICE_SQL} ${where} ORDER BY i.invoice_date DESC, i.invoice_id DESC`, params);
  const today = localDate();
  return rows.map((r) => decorate(r, today));
}

// Billable assignments: active projects, plus projects that ended in the last 180 days and still
// need their final invoice. Rate = the one in effect today (or on the end date for ended projects).
async function billable() {
  const today = localDate();
  const rows = await query(`
    SELECT w.work_id, w.employee_id, e.first_name || ' ' || e.last_name AS employee_name, w.job_title, w.project_name,
           w.start_date, w.end_date, w.vendor_id, w.client_id, v.vendor_name, c.client_name,
           COALESCE(v.vendor_name, c.client_name) AS bill_to,
           r.rate_id, r.bill_rate_cents, r.rate_unit, r.payment_terms_days, r.invoice_cycle, r.effective_from,
           (SELECT MAX(i.period_end) FROM invoices i WHERE i.work_id = w.work_id AND i.is_void = 0) AS last_invoiced_through,
           -- Approved timesheet hours after the last invoiced day (ready to bill) and hours still waiting for approval
           (SELECT COALESCE(SUM(x.hours), 0) FROM timesheet_entries x JOIN timesheets t ON t.timesheet_id = x.timesheet_id
             WHERE t.work_id = w.work_id AND t.status = 'APPROVED'
               AND x.work_date > COALESCE((SELECT MAX(i.period_end) FROM invoices i WHERE i.work_id = w.work_id AND i.is_void = 0), '0000-00-00')
           ) AS approved_uninvoiced_hours,
           (SELECT COALESCE(SUM(x.hours), 0) FROM timesheet_entries x JOIN timesheets t ON t.timesheet_id = x.timesheet_id
             WHERE t.work_id = w.work_id AND t.status = 'SUBMITTED') AS pending_hours
    FROM work w
    JOIN emp e ON e.employee_id = w.employee_id
    LEFT JOIN vendors v ON v.vendor_id = w.vendor_id
    LEFT JOIN clients c ON c.client_id = w.client_id
    LEFT JOIN billing_rates r ON r.work_id = w.work_id
          AND r.effective_from <= MIN(COALESCE(w.end_date, ?), ?)
          AND (r.effective_to IS NULL OR r.effective_to >= MIN(COALESCE(w.end_date, ?), ?))
    WHERE w.status = 'PROJECT' AND (w.end_date IS NULL OR w.end_date >= date(?, '-180 days'))
    ORDER BY w.end_date IS NOT NULL, employee_name`, [today, today, today, today, today]);
  const cycleDays = { WEEKLY: 7, BIWEEKLY: 14, SEMIMONTHLY: 16, MONTHLY: 31 };
  return rows.map((r) => {
    const from = r.last_invoiced_through || addDays(r.start_date, -1);
    const gap = daysBetween(from, today);
    const ended = Boolean(r.end_date);
    // Ended: still owes a final invoice until invoiced through the end date.
    // Active: behind = more than one full cycle (plus a week's grace) since the last invoiced period.
    const finalDue = ended && (!r.last_invoiced_through || r.last_invoiced_through < r.end_date);
    const behind = r.rate_id ? (ended ? finalDue : gap > (cycleDays[r.invoice_cycle] || 31) + 7) : false;
    return { ...r, ended, final_invoice_due: finalDue, days_since_invoiced_through: gap, invoicing_behind: behind, has_rate: Boolean(r.rate_id) };
  }).filter((r) => !r.ended || r.final_invoice_due || !r.rate_id);
}

// Tiles + balances by vendor / client + aging
router.get('/summary', asyncHandler(async (req, res) => {
  const today = localDate();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const [invoices, consultants, payments] = await Promise.all([
    allInvoices(),
    billable(),
    query('SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM invoice_payments WHERE paid_on >= ?', [yearStart]),
  ]);
  const live = invoices.filter((i) => !i.is_void);
  const empty = () => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });
  const parties = {};
  for (const i of live) {
    const key = `${i.bill_to_type}:${i.vendor_id || i.client_id}`;
    const p = parties[key] ||= {
      key, bill_to: i.bill_to, bill_to_type: i.bill_to_type, vendor_id: i.vendor_id, client_id: i.vendor_id ? null : i.client_id,
      invoiced_cents: 0, paid_cents: 0, balance_cents: 0, overdue_cents: 0, open_invoices: 0, aging: empty(),
      employees: new Set(), oldest_due: null,
    };
    p.invoiced_cents += i.amount_cents;
    p.paid_cents += i.paid_cents;
    p.balance_cents += i.balance_cents;
    p.employees.add(i.employee_name);
    if (i.balance_cents > 0) {
      p.open_invoices += 1;
      p.aging[bucket(i)] += i.balance_cents;
      if (i.days_overdue > 0) p.overdue_cents += i.balance_cents;
      if (!p.oldest_due || i.due_date < p.oldest_due) p.oldest_due = i.due_date;
    }
  }
  const balances = Object.values(parties)
    .map((p) => ({ ...p, employees: [...p.employees].sort() }))
    .sort((a, b) => b.balance_cents - a.balance_cents);
  const aging = empty();
  live.forEach((i) => { const b = bucket(i); if (b) aging[b] += i.balance_cents; });
  const sum = (rows, k) => rows.reduce((t, r) => t + r[k], 0);

  res.json({
    outstanding_cents: sum(live, 'balance_cents'),
    overdue_cents: sum(live.filter((i) => i.days_overdue > 0), 'balance_cents'),
    invoiced_ytd_cents: sum(live.filter((i) => i.invoice_date >= yearStart), 'amount_cents'),
    received_ytd_cents: payments[0].cents,
    billable_consultants: consultants.filter((c) => c.has_rate).length,
    consultants_without_rate: consultants.filter((c) => !c.has_rate).length,
    invoicing_behind: consultants.filter((c) => c.invoicing_behind).length,
    aging,
    balances,
  });
}));

router.get('/billable', asyncHandler(async (req, res) => res.json(await billable())));

// ?employee_id= &vendor_id= &client_id= (client_id only matches direct-billed invoices)
router.get('/invoices', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.employee_id) { where.push('i.employee_id = ?'); params.push(req.query.employee_id); }
  if (req.query.vendor_id) { where.push('i.vendor_id = ?'); params.push(req.query.vendor_id); }
  if (req.query.client_id) { where.push('i.client_id = ? AND i.vendor_id IS NULL'); params.push(req.query.client_id); }
  res.json(await allInvoices(where.length ? `WHERE ${where.join(' AND ')}` : '', params));
}));

router.get('/invoices/:id', asyncHandler(async (req, res) => {
  const [inv] = await allInvoices('WHERE i.invoice_id = ?', [req.params.id]);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  const payments = await query(`SELECT p.*, u.full_name AS recorded_by FROM invoice_payments p
    LEFT JOIN users u ON u.user_id = p.created_by WHERE p.invoice_id = ? ORDER BY p.paid_on`, [inv.invoice_id]);
  res.json({ ...inv, payments });
}));

// Suggest the next invoice number (INV-1007 after INV-1006)
router.get('/next-invoice-number', asyncHandler(async (req, res) => {
  const rows = await query("SELECT invoice_number FROM invoices WHERE invoice_number GLOB 'INV-[0-9]*'");
  const max = rows.reduce((m, r) => Math.max(m, Number(r.invoice_number.slice(4)) || 0), 1000);
  res.json({ invoice_number: `INV-${max + 1}` });
}));

// Create an invoice for an assignment. Rate, unit and terms default to the assignment's current bill rate.
router.post('/invoices', authorize(...WRITE), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const [w] = await query(`SELECT w.*, r.bill_rate_cents, r.rate_unit, r.payment_terms_days FROM work w
    LEFT JOIN billing_rates r ON r.work_id = w.work_id AND r.effective_from <= ? AND (r.effective_to IS NULL OR r.effective_to >= ?)
    WHERE w.work_id = ?`, [b.period_end || localDate(), b.period_end || localDate(), b.work_id]);
  if (!w) return res.status(400).json({ error: 'Choose the assignment to invoice.' });
  if (!w.vendor_id && !w.client_id) return res.status(400).json({ error: 'This assignment has no vendor or client to bill. Add one on the employee page first.' });
  if (!isDate(b.period_start) || !isDate(b.period_end) || b.period_end < b.period_start) {
    return res.status(400).json({ error: 'Enter a valid billing period (end on or after start).' });
  }
  const quantity = Number(b.quantity);
  if (!(quantity > 0)) return res.status(400).json({ error: 'Enter the hours (or days) worked.' });
  const rateCents = b.rate != null && b.rate !== '' ? toCents(b.rate) : w.bill_rate_cents;
  if (!rateCents) return res.status(400).json({ error: 'No bill rate set for this assignment. Enter a rate or set one first.' });
  const unit = UNITS.includes(b.rate_unit) ? b.rate_unit : (w.rate_unit || 'HOUR');
  const invoiceDate = isDate(b.invoice_date) ? b.invoice_date : localDate();
  const terms = Number.isInteger(Number(b.payment_terms_days)) && b.payment_terms_days !== '' && b.payment_terms_days != null
    ? Number(b.payment_terms_days) : (w.payment_terms_days ?? 30);
  const dueDate = isDate(b.due_date) ? b.due_date : addDays(invoiceDate, terms);
  const number = String(b.invoice_number || '').trim();
  if (!number) return res.status(400).json({ error: 'Enter an invoice number.' });

  const [overlap] = await query(`SELECT invoice_number FROM invoices WHERE work_id = ? AND is_void = 0
    AND period_start <= ? AND period_end >= ?`, [w.work_id, b.period_end, b.period_start]);
  if (overlap && !b.allow_overlap) {
    return res.status(409).json({ error: `${overlap.invoice_number} already covers part of this period.` });
  }

  const amount = Math.round(quantity * rateCents);
  const result = await query(`INSERT INTO invoices (invoice_number, work_id, employee_id, vendor_id, client_id, period_start, period_end,
      quantity, rate_unit, rate_cents, amount_cents, invoice_date, due_date, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [number, w.work_id, w.employee_id, w.vendor_id, w.client_id, b.period_start, b.period_end, quantity, unit, rateCents, amount,
    invoiceDate, dueDate, b.notes || null, req.user.user_id]);
  const [inv] = await allInvoices('WHERE i.invoice_id = ?', [result.insertId]);
  res.status(201).json(inv);
}));

// Record a payment from the vendor / client
router.post('/invoices/:id/payments', authorize(...WRITE), asyncHandler(async (req, res) => {
  const [inv] = await allInvoices('WHERE i.invoice_id = ?', [req.params.id]);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  if (inv.is_void) return res.status(400).json({ error: 'This invoice is void.' });
  const cents = toCents(req.body?.amount);
  if (!cents) return res.status(400).json({ error: 'Enter the amount received.' });
  if (cents > inv.balance_cents) {
    return res.status(400).json({ error: `That is more than the balance of $${(inv.balance_cents / 100).toFixed(2)}.` });
  }
  const paidOn = isDate(req.body?.paid_on) ? req.body.paid_on : localDate();
  if (paidOn > localDate()) return res.status(400).json({ error: 'Payment date cannot be in the future.' });
  await query('INSERT INTO invoice_payments (invoice_id, amount_cents, paid_on, reference, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [inv.invoice_id, cents, paidOn, req.body?.reference || null, req.body?.notes || null, req.user.user_id]);
  const [updated] = await allInvoices('WHERE i.invoice_id = ?', [inv.invoice_id]);
  res.status(201).json(updated);
}));

// Void an invoice sent in error (kept for the record; excluded from balances)
router.patch('/invoices/:id/void', authorize(...WRITE), asyncHandler(async (req, res) => {
  const [inv] = await allInvoices('WHERE i.invoice_id = ?', [req.params.id]);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  if (inv.paid_cents > 0) return res.status(400).json({ error: 'This invoice has payments recorded, so it cannot be voided.' });
  await query("UPDATE invoices SET is_void = 1, notes = TRIM(COALESCE(notes, '') || ' [Voided ' || ? || ']') WHERE invoice_id = ?",
    [localDate(), inv.invoice_id]);
  res.json({ invoice_id: inv.invoice_id, status: 'VOID' });
}));

// Bill-rate history for an assignment
router.get('/rates', asyncHandler(async (req, res) => {
  res.json(await query('SELECT * FROM billing_rates WHERE work_id = ? ORDER BY effective_from DESC', [req.query.work_id]));
}));

// Set a new bill rate for an assignment; closes the previous rate the day before
router.post('/rates', authorize(...WRITE), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const [w] = await query('SELECT work_id, start_date FROM work WHERE work_id = ?', [b.work_id]);
  if (!w) return res.status(400).json({ error: 'Choose an assignment.' });
  const cents = toCents(b.bill_rate);
  if (!cents) return res.status(400).json({ error: 'Enter the bill rate.' });
  const unit = UNITS.includes(b.rate_unit) ? b.rate_unit : 'HOUR';
  const cycle = CYCLES.includes(b.invoice_cycle) ? b.invoice_cycle : 'MONTHLY';
  const terms = b.payment_terms_days === '' || b.payment_terms_days == null ? 30 : Number(b.payment_terms_days);
  if (!Number.isInteger(terms) || terms < 0 || terms > 180) return res.status(400).json({ error: 'Payment terms must be 0–180 days.' });
  const from = isDate(b.effective_from) ? b.effective_from : localDate();

  const [later] = await query('SELECT effective_from FROM billing_rates WHERE work_id = ? AND effective_from >= ?', [w.work_id, from]);
  if (later) return res.status(400).json({ error: `A rate already starts on ${later.effective_from}. Pick a later date.` });

  const id = transaction((q) => {
    q('UPDATE billing_rates SET effective_to = ? WHERE work_id = ? AND (effective_to IS NULL OR effective_to >= ?)',
      [addDays(from, -1), w.work_id, from]);
    return q(`INSERT INTO billing_rates (work_id, bill_rate_cents, rate_unit, payment_terms_days, invoice_cycle, effective_from, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [w.work_id, cents, unit, terms, cycle, from, b.notes || null]).insertId;
  });
  const [rate] = await query('SELECT * FROM billing_rates WHERE rate_id = ?', [id]);
  res.status(201).json(rate);
}));

// Billing picture for one employee (employee page card)
router.get('/employees/:id', asyncHandler(async (req, res) => {
  const [rates, invoices] = await Promise.all([
    query(`SELECT r.*, w.project_name, COALESCE(v.vendor_name, c.client_name) AS bill_to FROM billing_rates r
           JOIN work w ON w.work_id = r.work_id
           LEFT JOIN vendors v ON v.vendor_id = w.vendor_id LEFT JOIN clients c ON c.client_id = w.client_id
           WHERE w.employee_id = ? ORDER BY r.effective_from DESC`, [req.params.id]),
    allInvoices('WHERE i.employee_id = ?', [req.params.id]),
  ]);
  const live = invoices.filter((i) => !i.is_void);
  const sum = (k) => live.reduce((t, i) => t + i[k], 0);
  res.json({
    rates, invoices,
    totals: { invoiced_cents: sum('amount_cents'), paid_cents: sum('paid_cents'), balance_cents: sum('balance_cents'),
      overdue_cents: live.filter((i) => i.days_overdue > 0).reduce((t, i) => t + i.balance_cents, 0) },
  });
}));

module.exports = router;
