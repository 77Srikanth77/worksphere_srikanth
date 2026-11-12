const express = require('express');
const fs = require('fs');
const path = require('path');
const { query, transaction } = require('../db');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');
const { reviewAfterResponse } = require('../utils/lcaReview');

/**
 * PATCH  /api/work/:id/details       job title, job duties, worksite, client manager, LCA (HR, Legal; Legal can't change anything else)
 * PUT    /api/work/:id               (generic router) a job title, when sent, can't be blank
 * GET    /api/work/:id/delete-check  what deleting would affect (CEO, Admin)
 * DELETE /api/work/:id               delete an assignment with a reason (CEO, Admin only), audit-logged
 */
const DELETERS = ['CEO']; // ADMIN always passes
const router = express.Router();

const TEXT = ['job_title', 'job_duties', 'work_location', 'city', 'state', 'worksite_address', 'worksite_zip',
  'client_manager_name', 'client_manager_title', 'client_manager_email', 'client_manager_phone', 'lca_case_number'];

router.put('/:id', (req, res, next) => {
  if (req.body && 'job_title' in req.body && !String(req.body.job_title ?? '').trim()) {
    return res.status(400).json({ error: 'Job title is required for every assignment.' });
  }
  reviewAfterResponse(req, res, { workIds: [req.params.id] }); // H-1B: client / worksite / title change -> LCA review
  next();
});

// New assignment (saved by the generic router below): H-1B employees get an LCA review / bench reminder
router.post('/', (req, res, next) => {
  reviewAfterResponse(req, res, { employeeIds: [req.body?.employee_id] });
  next();
});

router.patch('/:id/details', authorize('HR', 'LEGAL'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const [w] = await query('SELECT work_id FROM work WHERE work_id = ?', [req.params.id]);
  if (!w) return res.status(404).json({ error: 'Assignment not found.' });
  reviewAfterResponse(req, res, { workIds: [w.work_id] });

  const set = {};
  TEXT.forEach((k) => { if (b[k] !== undefined) set[k] = String(b[k] ?? '').trim() || null; });
  if ('job_title' in set && !set.job_title) return res.status(400).json({ error: 'Job title is required for every assignment.' });
  if (set.client_manager_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(set.client_manager_email)) {
    return res.status(400).json({ error: 'Client manager email does not look right.' });
  }
  if (set.worksite_zip && !/^\d{5}(-\d{4})?$/.test(set.worksite_zip)) return res.status(400).json({ error: 'ZIP code should be 5 digits (or ZIP+4).' });
  if (set.state && !/^[A-Za-z]{2}$/.test(set.state)) return res.status(400).json({ error: 'Use the 2-letter state code (e.g. TX).' });
  if (set.state) set.state = set.state.toUpperCase();
  if (b.lca_wage !== undefined) {
    const raw = String(b.lca_wage ?? '').replace(/[$,\s]/g, '');
    if (!raw) set.lca_wage_cents = null;
    else {
      const n = Number(raw);
      if (!(n > 0)) return res.status(400).json({ error: 'LCA wage must be a positive amount.' });
      set.lca_wage_cents = Math.round(n * 100);
    }
  }
  if (b.lca_wage_unit !== undefined) {
    if (b.lca_wage_unit && !['YEAR', 'HOUR'].includes(b.lca_wage_unit)) return res.status(400).json({ error: 'LCA wage is per year or per hour.' });
    set.lca_wage_unit = b.lca_wage_unit || null;
  }
  if (set.lca_wage_cents && !(set.lca_wage_unit || b.lca_wage_unit)) set.lca_wage_unit = 'YEAR';
  const cols = Object.keys(set);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update.' });
  await query(`UPDATE work SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE work_id = ?`, [...Object.values(set), w.work_id]);
  const [row] = await query('SELECT * FROM work WHERE work_id = ?', [w.work_id]);
  res.json(row);
}));

// ---------------------------------------------------------------- deleting an assignment (CEO / Admin)

const TS_DIR = path.join(__dirname, '..', '..', 'uploads', 'timesheets');

/** What depends on an assignment, and whether it may be deleted */
async function deleteImpact(workId) {
  const [[w], invoices, timesheets, rates, files] = await Promise.all([
    query(`SELECT w.*, c.client_name, v.vendor_name, e.first_name || ' ' || e.last_name AS employee_name FROM work w
           JOIN emp e ON e.employee_id = w.employee_id LEFT JOIN clients c ON c.client_id = w.client_id
           LEFT JOIN vendors v ON v.vendor_id = w.vendor_id WHERE w.work_id = ?`, [workId]),
    query('SELECT invoice_number, is_void FROM invoices WHERE work_id = ?', [workId]),
    query('SELECT status, COUNT(*) AS n FROM timesheets WHERE work_id = ? GROUP BY status', [workId]),
    query('SELECT COUNT(*) AS n FROM billing_rates WHERE work_id = ?', [workId]),
    query(`SELECT a.file_path FROM timesheet_attachments a JOIN timesheets t ON t.timesheet_id = a.timesheet_id WHERE t.work_id = ?`, [workId]),
  ]);
  if (!w) return null;
  const ts = Object.fromEntries(timesheets.map((t) => [t.status, t.n]));
  const blockers = [];
  const liveInvoices = invoices.filter((i) => !i.is_void);
  if (liveInvoices.length) blockers.push(`${liveInvoices.length} invoice(s) were billed for it (${liveInvoices.map((i) => i.invoice_number).join(', ')})`);
  if (ts.APPROVED) blockers.push(`${ts.APPROVED} approved timesheet week(s) (used for pay and billing)`);
  if (ts.SUBMITTED) blockers.push(`${ts.SUBMITTED} timesheet week(s) waiting for HR approval`);
  return {
    work: w,
    can_delete: blockers.length === 0,
    blockers,
    removes: {
      draft_timesheets: (ts.DRAFT || 0) + (ts.REJECTED || 0),
      bill_rates: rates[0].n,
      void_invoices_unlinked: invoices.length - liveInvoices.length,
    },
    files: files.map((f) => f.file_path),
  };
}

router.get('/:id/delete-check', authorize(...DELETERS), asyncHandler(async (req, res) => {
  const impact = await deleteImpact(req.params.id);
  if (!impact) return res.status(404).json({ error: 'Assignment not found.' });
  const { files, ...rest } = impact;
  res.json(rest);
}));

// Only CEO / Admin delete; everyone else (including HR) is stopped here before the generic /work router
router.delete('/:id', authorize(...DELETERS), asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ error: 'Give a reason for deleting this assignment (at least 5 characters).' });
  const impact = await deleteImpact(req.params.id);
  if (!impact) return res.status(404).json({ error: 'Assignment not found.' });
  if (!impact.can_delete) {
    return res.status(409).json({ error: `This assignment can't be deleted because ${impact.blockers.join(' and ')}. End it instead.`, blockers: impact.blockers });
  }
  transaction((q) => {
    q(`INSERT INTO audit_log (entity, entity_id, employee_id, action, reason, snapshot, user_id) VALUES ('WORK', ?, ?, 'DELETE', ?, ?, ?)`,
      [String(impact.work.work_id), impact.work.employee_id, reason, JSON.stringify({ work: impact.work, removed: impact.removes }), req.user.user_id]);
    q('DELETE FROM work WHERE work_id = ?', [impact.work.work_id]); // bill rates and draft timesheets go with it
  });
  impact.files.forEach((f) => fs.rm(path.join(TS_DIR, path.basename(f)), { force: true }, () => {}));
  res.json({ deleted: impact.work.work_id });
}));

// Deleted assignments of an employee (CEO / Admin / HR can see what was removed and why)
router.get('/deleted/:employeeId', authorize('CEO', 'HR'), asyncHandler(async (req, res) => {
  const rows = await query(`SELECT a.audit_id, a.reason, a.snapshot, a.created_at, u.full_name AS deleted_by FROM audit_log a
    LEFT JOIN users u ON u.user_id = a.user_id WHERE a.entity = 'WORK' AND a.action = 'DELETE' AND a.employee_id = ? ORDER BY a.created_at DESC`,
  [req.params.employeeId]);
  res.json(rows.map(({ snapshot, ...r }) => {
    const { work } = JSON.parse(snapshot);
    return { ...r, client_name: work.client_name, project_name: work.project_name, status: work.status, start_date: work.start_date, end_date: work.end_date };
  }));
}));

module.exports = router;
