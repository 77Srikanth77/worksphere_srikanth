const express = require('express');
const { query, transaction } = require('../db');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');
const { syncCases } = require('../utils/capSync');

/**
 * H-1B cap cases: the people Legal files cap petitions for each season (Legal's "Cap cases" sheet).
 *   GET    /h1b-cap?cap_year=2026-27   cases for one season, with the employee and (once approved) visa / LCA
 *   GET    /h1b-cap/years              seasons that have cases
 *   POST   /h1b-cap                    add a case            -> employee record created / linked automatically
 *   PUT    /h1b-cap/:id                edit a case           -> same
 *   POST   /h1b-cap/:id/approve        approval + LCA details -> H-1B visa record on the employee's file,
 *                                      LCA on their current assignment, expiry alerts from then on
 *   DELETE /h1b-cap/:id
 */
const READ = ['CEO', 'HR', 'LEGAL'];
const WRITE = ['HR', 'LEGAL'];
const STATUSES = ['REGISTERED', 'SELECTED', 'FILED', 'RFE', 'APPROVED', 'DENIED', 'WITHDRAWN'];
const FIELDS = ['first_name', 'last_name', 'on_project', 'vendor_name', 'client_name', 'job_title', 'lca_wage_cents',
  'work_mode', 'lca_location', 'case_status', 'employment_status', 'notes'];

/** Current filing season: registration in March, petitions from April, start date Oct 1 of the same year. */
const currentCapYear = (d = new Date()) => `${d.getFullYear()}-${String((d.getFullYear() + 1) % 100).padStart(2, '0')}`;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
const clean = (v) => (v === undefined ? undefined : (String(v ?? '').trim() || null));

const router = express.Router();

router.get('/years', authorize(...READ), asyncHandler(async (req, res) => {
  const rows = await query('SELECT cap_year, COUNT(*) AS cases FROM h1b_cap_cases GROUP BY cap_year ORDER BY cap_year DESC');
  res.json({ current: currentCapYear(), years: rows });
}));

router.get('/', authorize(...READ), asyncHandler(async (req, res) => {
  res.json(await query(`
    SELECT c.*, i.start_date AS visa_start_date, i.expiry_date AS visa_expiry_date,
           i.lca_number, i.lca_start_date, i.lca_expiry_date
    FROM h1b_cap_cases c LEFT JOIN immigration i ON i.visa_id = c.visa_id
    WHERE c.cap_year = ? ORDER BY c.case_id`, [req.query.cap_year || currentCapYear()]));
}));

/** Validates the editable fields of a case. Returns { data } or { error } */
function readCase(body, { creating, current }) {
  const data = {};
  FIELDS.forEach((k) => { if (body[k] !== undefined) data[k] = k === 'on_project' || k === 'lca_wage_cents' ? body[k] : clean(body[k]); });
  for (const [k, label] of [['first_name', 'First name'], ['last_name', 'Last name'], ['job_title', 'Job title']]) {
    if ((creating || k in data) && !data[k]) return { error: `${label} is required.` };
  }
  if ('on_project' in data) data.on_project = data.on_project ? 1 : 0;
  if ('lca_wage_cents' in data && data.lca_wage_cents != null && !(Number(data.lca_wage_cents) > 0)) return { error: 'LCA amount must be a positive number.' };
  if (data.case_status && !STATUSES.includes(data.case_status)) return { error: 'Unknown case status.' };
  if (data.case_status === 'APPROVED' && current?.case_status !== 'APPROVED') {
    return { error: 'Use "Approve" to mark a case approved. It asks for the H-1B and LCA details.' };
  }
  return { data };
}

router.post('/', authorize(...WRITE), asyncHandler(async (req, res) => {
  const { data, error } = readCase(req.body || {}, { creating: true });
  if (error) return res.status(400).json({ error });
  const capYear = clean(req.body.cap_year) || currentCapYear();
  const id = transaction((q) => {
    const cols = ['cap_year', ...Object.keys(data)];
    const newId = q(`INSERT INTO h1b_cap_cases (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, [capYear, ...Object.values(data)]).insertId;
    syncCases(q, { caseId: newId });
    return newId;
  });
  res.status(201).json((await query('SELECT * FROM h1b_cap_cases WHERE case_id = ?', [id]))[0]);
}));

router.put('/:id', authorize(...WRITE), asyncHandler(async (req, res) => {
  const [current] = await query('SELECT * FROM h1b_cap_cases WHERE case_id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Case not found.' });
  const { data, error } = readCase(req.body || {}, { creating: false, current });
  if (error) return res.status(400).json({ error });
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update.' });
  transaction((q) => {
    q(`UPDATE h1b_cap_cases SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')} WHERE case_id = ?`, [...Object.values(data), current.case_id]);
    syncCases(q, { caseId: current.case_id });
  });
  res.json((await query('SELECT * FROM h1b_cap_cases WHERE case_id = ?', [current.case_id]))[0]);
}));

/**
 * Approval: { receipt_number, start_date, expiry_date, lca_number, lca_start_date, lca_expiry_date }
 * In one transaction: employee record (created / linked), H-1B visa record with the LCA, LCA on the
 * current assignment, case marked APPROVED. Saving again updates the same visa record.
 */
router.post('/:id/approve', authorize(...WRITE), asyncHandler(async (req, res) => {
  const [c] = await query('SELECT * FROM h1b_cap_cases WHERE case_id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  if (c.employment_status === 'LEFT') return res.status(400).json({ error: `${c.first_name} ${c.last_name} is marked as no longer with the company.` });
  const b = Object.fromEntries(['receipt_number', 'start_date', 'expiry_date', 'lca_number', 'lca_start_date', 'lca_expiry_date']
    .map((k) => [k, clean(req.body?.[k])]));
  const labels = { receipt_number: 'Receipt number', start_date: 'H-1B valid from', expiry_date: 'H-1B valid until', lca_number: 'LCA case number', lca_start_date: 'LCA valid from', lca_expiry_date: 'LCA valid until' };
  const missing = Object.keys(labels).filter((k) => !b[k]);
  if (missing.length) return res.status(400).json({ error: `Please fill in: ${missing.map((k) => labels[k]).join(', ')}.` });
  const badDate = ['start_date', 'expiry_date', 'lca_start_date', 'lca_expiry_date'].find((k) => !isDate(b[k]));
  if (badDate) return res.status(400).json({ error: `${labels[badDate]} is not a valid date.` });
  if (b.expiry_date <= b.start_date) return res.status(400).json({ error: 'H-1B "valid until" must be after "valid from".' });
  if (b.lca_expiry_date <= b.lca_start_date) return res.status(400).json({ error: 'LCA "valid until" must be after "valid from".' });
  b.receipt_number = b.receipt_number.toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{3}\d{10}$/.test(b.receipt_number)) return res.status(400).json({ error: 'Receipt number should be 3 letters and 10 digits, e.g. WAC2690012345.' });
  b.lca_number = b.lca_number.toUpperCase().replace(/\s+/g, '');

  const result = transaction((q) => {
    syncCases(q, { caseId: c.case_id }); // makes sure the employee record exists and is linked
    const [{ employee_id: employeeId }] = q('SELECT employee_id FROM h1b_cap_cases WHERE case_id = ?', [c.case_id]);
    const visa = {
      employee_id: employeeId, visa_type: 'H1B', receipt_number: b.receipt_number, start_date: b.start_date, expiry_date: b.expiry_date,
      lca_number: b.lca_number, lca_start_date: b.lca_start_date, lca_expiry_date: b.lca_expiry_date, case_status: 'ACTIVE',
    };
    // Same visa record when approving again (or when Legal already entered this receipt by hand)
    const [existing] = q(`SELECT visa_id FROM immigration WHERE visa_id = ? OR (employee_id = ? AND upper(receipt_number) = ?)
                          ORDER BY visa_id = ? DESC LIMIT 1`, [c.visa_id, employeeId, b.receipt_number, c.visa_id]);
    let visaId;
    if (existing) {
      visaId = existing.visa_id;
      q(`UPDATE immigration SET ${Object.keys(visa).map((k) => `${k} = ?`).join(', ')} WHERE visa_id = ?`, [...Object.values(visa), visaId]);
    } else {
      visaId = q(`INSERT INTO immigration (${Object.keys(visa).join(', ')}, notes) VALUES (${Object.keys(visa).map(() => '?').join(', ')}, ?)`,
        [...Object.values(visa), `H-1B cap ${c.cap_year}`]).insertId;
    }
    // LCA on the current assignment (wage from the case when the assignment has none)
    const [work] = q(`SELECT work_id FROM work WHERE employee_id = ? AND end_date IS NULL
                      ORDER BY start_date DESC, work_id DESC LIMIT 1`, [employeeId]);
    if (work) {
      q(`UPDATE work SET lca_case_number = ?,
                         lca_wage_unit = CASE WHEN lca_wage_cents IS NULL THEN ? ELSE lca_wage_unit END,
                         lca_wage_cents = COALESCE(lca_wage_cents, ?)
         WHERE work_id = ?`, [b.lca_number, c.lca_wage_cents ? c.lca_wage_unit : null, c.lca_wage_cents, work.work_id]);
    }
    q("UPDATE h1b_cap_cases SET case_status = 'APPROVED', receipt_number = ?, visa_id = ? WHERE case_id = ?", [b.receipt_number, visaId, c.case_id]);
    return { employee_id: employeeId, visa_id: visaId, assignment_updated: Boolean(work) };
  });
  res.json(result);
}));

router.delete('/:id', authorize(...WRITE), asyncHandler(async (req, res) => {
  const r = await query('DELETE FROM h1b_cap_cases WHERE case_id = ?', [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Case not found.' });
  res.status(204).end();
}));

module.exports = router;
module.exports.currentCapYear = currentCapYear;
