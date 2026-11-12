const express = require('express');
const { query } = require('../db');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');
const { notify } = require('../utils/notify');
const { OPEN_STATUSES } = require('../utils/lcaReview');

/**
 * LCA change reviews (opened automatically when an H-1B employee's assignment changes) and H-1B bench pay.
 *   GET  /lca-reviews?show=open|all        reviews, newest first
 *   GET  /lca-reviews/summary              counts for Home / tabs
 *   GET  /lca-reviews/bench                H-1B employees currently on bench (LCA wage must still be paid)
 *   POST /lca-reviews/:id/decide           { decision: AMENDMENT_REQUIRED | POSTING_REQUIRED | NO_ACTION, note }   Legal
 *   POST /lca-reviews/:id/amendment-filed  { receipt_number, filed_on, new_lca_number? }                          Legal
 *   POST /lca-reviews/:id/posting-done     { posted_on, posting_location }                                         Legal, HR
 */
const READ = ['CEO', 'HR', 'LEGAL'];
const router = express.Router();
const clean = (v) => String(v ?? '').trim() || null;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));

const SELECT = `
  SELECT r.*, e.first_name || ' ' || e.last_name AS employee_name,
         w.start_date AS work_start_date, w.end_date AS work_end_date, w.status AS work_status, c.client_name,
         ru.full_name AS raised_by_name, du.full_name AS decided_by_name
  FROM lca_reviews r
  JOIN emp e ON e.employee_id = r.employee_id
  LEFT JOIN work w ON w.work_id = r.work_id
  LEFT JOIN clients c ON c.client_id = w.client_id
  LEFT JOIN users ru ON ru.user_id = r.raised_by
  LEFT JOIN users du ON du.user_id = r.decided_by`;
const parse = (r) => ({ ...r, changes: JSON.parse(r.changes || '[]'), reasons: JSON.parse(r.reasons || '[]') });
const one = async (id) => { const [r] = await query(`${SELECT} WHERE r.review_id = ?`, [id]); return r ? parse(r) : null; };
const usersWithRole = async (role) => (await query(
  'SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = ? AND u.is_active = 1', [role])).map((r) => r.user_id);

/** H-1B employees whose current assignment is BENCH, with the LCA wage that must keep being paid */
const BENCH_SQL = `
  SELECT e.employee_id, e.first_name || ' ' || e.last_name AS employee_name, w.work_id, w.start_date AS bench_since,
         CAST(julianday(date('now','localtime')) - julianday(w.start_date) AS INTEGER) AS days_on_bench,
         COALESCE(w.lca_wage_cents, (SELECT w2.lca_wage_cents FROM work w2 WHERE w2.employee_id = e.employee_id AND w2.lca_wage_cents IS NOT NULL
                                     ORDER BY w2.start_date DESC LIMIT 1)) AS lca_wage_cents,
         COALESCE(w.lca_wage_unit, (SELECT w2.lca_wage_unit FROM work w2 WHERE w2.employee_id = e.employee_id AND w2.lca_wage_cents IS NOT NULL
                                    ORDER BY w2.start_date DESC LIMIT 1)) AS lca_wage_unit,
         i.expiry_date AS visa_expiry_date
  FROM emp e
  JOIN work w ON w.work_id = (SELECT w3.work_id FROM work w3 WHERE w3.employee_id = e.employee_id   -- assignment in effect today
                              AND w3.start_date <= date('now','localtime')
                              AND (w3.end_date IS NULL OR w3.end_date >= date('now','localtime'))
                              ORDER BY w3.start_date DESC, w3.work_id DESC LIMIT 1)
  JOIN immigration i ON i.visa_id = (SELECT i2.visa_id FROM immigration i2 WHERE i2.employee_id = e.employee_id
                                     AND replace(replace(upper(i2.visa_type), '-', ''), ' ', '') LIKE 'H1B%'
                                     AND i2.case_status <> 'EXPIRED' AND i2.expiry_date >= date('now','localtime')
                                     ORDER BY i2.expiry_date DESC LIMIT 1)
  WHERE w.status = 'BENCH'
  ORDER BY w.start_date`;

router.get('/', authorize(...READ), asyncHandler(async (req, res) => {
  const all = req.query.show === 'all';
  const rows = await query(`${SELECT} ${all ? '' : `WHERE r.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`}
    ORDER BY CASE r.status WHEN 'OPEN' THEN 0 WHEN 'AMENDMENT_REQUIRED' THEN 1 WHEN 'POSTING_REQUIRED' THEN 2 ELSE 3 END, r.created_at DESC`,
  all ? [] : OPEN_STATUSES);
  res.json(rows.map(parse));
}));

router.get('/summary', authorize(...READ), asyncHandler(async (req, res) => {
  const [c] = await query(`SELECT
      SUM(status = 'OPEN') AS awaiting_decision,
      SUM(status = 'AMENDMENT_REQUIRED') AS amendment_to_file,
      SUM(status = 'POSTING_REQUIRED') AS posting_to_do
    FROM lca_reviews`);
  const bench = await query(BENCH_SQL);
  res.json({ awaiting_decision: c.awaiting_decision || 0, amendment_to_file: c.amendment_to_file || 0, posting_to_do: c.posting_to_do || 0, h1b_on_bench: bench.length });
}));

router.get('/bench', authorize(...READ), asyncHandler(async (req, res) => res.json(await query(BENCH_SQL))));

router.post('/:id/decide', authorize('LEGAL'), asyncHandler(async (req, res) => {
  const r = await one(req.params.id);
  if (!r) return res.status(404).json({ error: 'Review not found.' });
  if (r.status !== 'OPEN') return res.status(400).json({ error: 'This change was already decided.' });
  const decision = req.body?.decision;
  const note = clean(req.body?.note);
  if (!['AMENDMENT_REQUIRED', 'POSTING_REQUIRED', 'NO_ACTION'].includes(decision)) return res.status(400).json({ error: 'Choose a decision.' });
  if (!note || note.length < 5) return res.status(400).json({ error: 'Add a short reason. It is kept for audits.' });
  await query(`UPDATE lca_reviews SET status = ?, decision_note = ?, decided_by = ?, decided_at = datetime('now','localtime'),
               updated_at = datetime('now','localtime') WHERE review_id = ?`, [decision, note, req.user.user_id, r.review_id]);
  if (decision === 'AMENDMENT_REQUIRED') {
    await notify(await usersWithRole('HR'), {
      type: 'LCA_REVIEW', title: `LCA amendment required: ${r.employee_name}`,
      body: 'Legal decided a new LCA and amended petition are needed. The employee must not start or move until Legal records the filing.',
      link: `/employees/${r.employee_id}`,
    });
  }
  res.json(await one(r.review_id));
}));

router.post('/:id/amendment-filed', authorize('LEGAL'), asyncHandler(async (req, res) => {
  const r = await one(req.params.id);
  if (!r) return res.status(404).json({ error: 'Review not found.' });
  if (!['AMENDMENT_REQUIRED', 'AMENDMENT_FILED'].includes(r.status)) return res.status(400).json({ error: 'This change does not need an amendment.' });
  const receipt = String(req.body?.receipt_number || '').toUpperCase().replace(/\s+/g, '');
  const filedOn = clean(req.body?.filed_on);
  const lca = clean(req.body?.new_lca_number)?.toUpperCase().replace(/\s+/g, '') || null;
  if (!/^[A-Z]{3}\d{10}$/.test(receipt)) return res.status(400).json({ error: 'Receipt number should be 3 letters and 10 digits, e.g. WAC2690012345.' });
  if (!isDate(filedOn)) return res.status(400).json({ error: 'Enter the date the amendment was filed.' });
  if (!lca) return res.status(400).json({ error: 'Enter the new LCA case number.' });
  await query(`UPDATE lca_reviews SET status = 'AMENDMENT_FILED', amendment_receipt = ?, amendment_filed_on = ?, new_lca_number = ?,
               updated_at = datetime('now','localtime') WHERE review_id = ?`, [receipt, filedOn, lca, r.review_id]);
  if (r.work_id) await query('UPDATE work SET lca_case_number = ? WHERE work_id = ?', [lca, r.work_id]); // the assignment now runs under the new LCA
  await notify(await usersWithRole('HR'), {
    type: 'LCA_REVIEW', title: `Amendment filed: ${r.employee_name} may start`,
    body: `Receipt ${receipt}, filed ${filedOn}. The employee can start working under the new terms.`,
    link: `/employees/${r.employee_id}`,
  });
  res.json(await one(r.review_id));
}));

router.post('/:id/posting-done', authorize('LEGAL', 'HR'), asyncHandler(async (req, res) => {
  const r = await one(req.params.id);
  if (!r) return res.status(404).json({ error: 'Review not found.' });
  if (!['POSTING_REQUIRED', 'POSTING_DONE'].includes(r.status)) return res.status(400).json({ error: 'This change does not need a notice posting.' });
  const postedOn = clean(req.body?.posted_on);
  const where = clean(req.body?.posting_location);
  if (!isDate(postedOn)) return res.status(400).json({ error: 'Enter the date the notice was posted.' });
  if (!where) return res.status(400).json({ error: 'Say where it was posted (e.g. two break rooms at the client site, or the electronic notice link).' });
  await query(`UPDATE lca_reviews SET status = 'POSTING_DONE', posted_on = ?, posting_location = ?, updated_at = datetime('now','localtime')
               WHERE review_id = ?`, [postedOn, where, r.review_id]);
  res.json(await one(r.review_id));
}));

module.exports = router;
