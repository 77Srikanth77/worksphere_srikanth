const express = require('express');
const { query } = require('../db');
const { authorize } = require('../middleware/auth');
const { pick, buildInsert, buildUpdate, asyncHandler } = require('../utils/helpers');

const router = express.Router();

const EMP_COLUMNS = [
  'employee_id', 'first_name', 'middle_name', 'last_name', 'date_of_birth', 'hire_date',
  'email', 'phone_number', 'emergency_contact_name', 'emergency_contact_number', 'bio',
];
const REQUIRED = ['employee_id', 'first_name', 'last_name', 'hire_date', 'email'];

const READ = ['CEO', 'HR', 'LEGAL', 'MARKETING', 'MARKETING_MANAGER'];
const WRITE = ['HR'];

// Roles that may see bill rates and balances
const FINANCE = ['ADMIN', 'CEO', 'HR'];

// List employees with their current assignment, client, vendor, latest visa and marketing agent.
// Bill rate is included only for finance roles.
router.get('/', authorize(...READ), asyncHandler(async (req, res) => {
  const finance = FINANCE.includes(req.user.role);
  const rows = await query(`
    SELECT e.*, w.work_id, w.status AS current_status, w.project_name, w.job_title, w.work_location,
           w.city, w.state, w.start_date AS current_since,
           w.client_id, c.client_name, w.vendor_id, v.vendor_name,
           iv.visa_type, iv.expiry_date AS visa_expiry, iv.lca_expiry_date, iv.case_status AS visa_case_status,
           CAST(julianday(MIN(iv.expiry_date, COALESCE(iv.lca_expiry_date, iv.expiry_date))) - julianday(date('now','localtime')) AS INTEGER) AS visa_days_left,
           au.full_name AS marketing_agent
           ${finance ? `, br.bill_rate_cents, br.rate_unit, br.payment_terms_days,
           (SELECT COALESCE(SUM(i.amount_cents), 0) - COALESCE(SUM((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.invoice_id)), 0)
              FROM invoices i WHERE i.employee_id = e.employee_id AND i.is_void = 0) AS balance_cents` : ''}
    FROM emp e
    LEFT JOIN work w ON w.work_id = (SELECT w2.work_id FROM work w2 WHERE w2.employee_id = e.employee_id AND w2.end_date IS NULL
                                     ORDER BY w2.start_date DESC LIMIT 1)
    LEFT JOIN clients c ON c.client_id = w.client_id
    LEFT JOIN vendors v ON v.vendor_id = w.vendor_id
    LEFT JOIN immigration iv ON iv.visa_id = (SELECT i2.visa_id FROM immigration i2 WHERE i2.employee_id = e.employee_id
                                              ORDER BY i2.expiry_date DESC LIMIT 1)
    LEFT JOIN marketing_assignments ma ON ma.employee_id = e.employee_id AND ma.is_active = TRUE
    LEFT JOIN users au ON au.user_id = ma.agent_user_id
    ${finance ? `LEFT JOIN billing_rates br ON br.work_id = w.work_id AND br.effective_from <= date('now','localtime')
                 AND (br.effective_to IS NULL OR br.effective_to >= date('now','localtime'))` : ''}
    ORDER BY e.employee_id`);
  res.json(rows);
}));

// Full employee record: EMP + work history + visas + trainings + interviews
router.get('/:id', authorize(...READ), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const [emp] = await query('SELECT * FROM emp WHERE employee_id = ?', [id]);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });

  const [work, immigration, trainings, interviews, marketing] = await Promise.all([
    query(`SELECT w.*, c.client_name, v.vendor_name FROM work w
           LEFT JOIN clients c ON c.client_id = w.client_id
           LEFT JOIN vendors v ON v.vendor_id = w.vendor_id
           WHERE w.employee_id = ? ORDER BY w.end_date IS NULL DESC, w.start_date DESC`, [id]),
    query(`SELECT *, CAST(julianday(expiry_date) - julianday(date('now','localtime')) AS INTEGER) AS days_left,
                  CAST(julianday(lca_expiry_date) - julianday(date('now','localtime')) AS INTEGER) AS lca_days_left
           FROM immigration WHERE employee_id = ? ORDER BY expiry_date`, [id]),
    query('SELECT * FROM trainings WHERE employee_id = ? ORDER BY start_date DESC', [id]),
    query('SELECT * FROM interviews WHERE employee_id = ? ORDER BY interview_date DESC', [id]),
    query(`SELECT ma.*, u.full_name AS agent_name, u.email AS agent_email FROM marketing_assignments ma
           JOIN users u ON u.user_id = ma.agent_user_id
           WHERE ma.employee_id = ? ORDER BY ma.is_active DESC, ma.assigned_on DESC, ma.assignment_id DESC`, [id]),
  ]);
  res.json({ ...emp, work, immigration, trainings, interviews, marketing_assignments: marketing });
}));

router.post('/', authorize(...WRITE), asyncHandler(async (req, res) => {
  const data = pick(req.body, EMP_COLUMNS);
  const missing = REQUIRED.filter((c) => !data[c]);
  if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });

  const [exists] = await query('SELECT employee_id FROM emp WHERE employee_id = ?', [data.employee_id]);
  if (exists) return res.status(409).json({ error: `Employee ID ${data.employee_id} already exists.` });

  const { sql, params } = buildInsert('emp', data);
  await query(sql, params);
  const [emp] = await query('SELECT * FROM emp WHERE employee_id = ?', [data.employee_id]);
  res.status(201).json(emp);
}));

router.put('/:id', authorize(...WRITE), asyncHandler(async (req, res) => {
  const data = pick(req.body, EMP_COLUMNS.filter((c) => c !== 'employee_id'));
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update.' });
  const { sql, params } = buildUpdate('emp', data, 'employee_id', req.params.id);
  const result = await query(sql, params);
  if (!result.affectedRows) return res.status(404).json({ error: 'Employee not found.' });
  const [emp] = await query('SELECT * FROM emp WHERE employee_id = ?', [req.params.id]);
  res.json(emp);
}));

router.delete('/:id', authorize(), asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM emp WHERE employee_id = ?', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Employee not found.' });
  res.status(204).end();
}));

module.exports = router;
