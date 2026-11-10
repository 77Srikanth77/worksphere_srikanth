const express = require('express');
const { query } = require('../db');
const { authorize } = require('../middleware/auth');
const { pick, buildInsert, asyncHandler } = require('../utils/helpers');

const router = express.Router();

/** Marketing agents see their own data; CEO / ADMIN / HR may pass ?agent_id=. */
function agentIdFor(req) {
  if (req.user.role === 'MARKETING') return req.user.user_id;
  return Number(req.query.agent_id || req.body?.agent_user_id) || null;
}

// List of marketing agents (for assignment dropdowns)
router.get('/agents', authorize('CEO', 'HR', 'MARKETING'), asyncHandler(async (req, res) => {
  res.json(await query(`
    SELECT u.user_id, u.full_name, u.email FROM users u JOIN roles r ON r.role_id = u.role_id
    WHERE r.role_name = 'MARKETING' AND u.is_active = TRUE ORDER BY u.full_name`));
}));

// Everything the marketing agent sees on login
router.get('/dashboard', authorize('MARKETING', 'CEO', 'HR'), asyncHandler(async (req, res) => {
  const agentId = agentIdFor(req);
  if (!agentId) return res.status(400).json({ error: 'Choose a marketing agent (agent_id).' });

  const [employees, submissions, vendorsContacted, weekly] = await Promise.all([
    query(`
      SELECT e.employee_id, e.first_name || ' ' || e.last_name AS employee_name, e.email,
             w.job_title, w.status AS current_status, ma.assigned_on,
             (SELECT COUNT(*) FROM submissions s WHERE s.employee_id = e.employee_id AND s.agent_user_id = ma.agent_user_id) AS profiles_submitted,
             (SELECT COUNT(*) FROM interviews i WHERE i.employee_id = e.employee_id AND i.result = 'PIPELINE') AS interviews_pipeline,
             (SELECT COUNT(*) FROM interviews i WHERE i.employee_id = e.employee_id AND i.result = 'AWAITING_RESULT') AS interviews_awaiting
      FROM marketing_assignments ma
      JOIN emp e ON e.employee_id = ma.employee_id
      LEFT JOIN work w ON w.employee_id = e.employee_id AND w.end_date IS NULL
      WHERE ma.agent_user_id = ? AND ma.is_active = TRUE
      ORDER BY employee_name`, [agentId]),
    query(`
      SELECT s.*, e.first_name || ' ' || e.last_name AS employee_name, v.vendor_name
      FROM submissions s
      JOIN emp e ON e.employee_id = s.employee_id
      LEFT JOIN vendors v ON v.vendor_id = s.vendor_id
      WHERE s.agent_user_id = ? ORDER BY s.submitted_on DESC`, [agentId]),
    query(`
      SELECT vc.*, v.vendor_name, v.contact_name, v.contact_email
      FROM vendor_contacts vc JOIN vendors v ON v.vendor_id = vc.vendor_id
      WHERE vc.agent_user_id = ? ORDER BY vc.contacted_on DESC`, [agentId]),
    query('SELECT * FROM weekly_status WHERE agent_user_id = ? ORDER BY week_start DESC', [agentId]),
  ]);

  const placed = submissions.filter((s) => s.status === 'PLACED');
  res.json({
    summary: {
      employees_assigned: employees.length,
      profiles_submitted: submissions.length,
      vendors_contacted: new Set(vendorsContacted.map((v) => v.vendor_id)).size,
      employees_placed: new Set(placed.map((s) => s.employee_id)).size,
    },
    employees, submissions, vendors_contacted: vendorsContacted, placed, weekly_status: weekly,
  });
}));

// Assign a bench employee to an agent
router.post('/assignments', authorize('CEO', 'HR'), asyncHandler(async (req, res) => {
  const data = pick(req.body, ['employee_id', 'agent_user_id', 'assigned_on']);
  if (!data.employee_id || !data.agent_user_id) return res.status(400).json({ error: 'Employee and agent are required.' });
  data.assigned_on = data.assigned_on || new Date().toISOString().slice(0, 10);
  const [agent] = await query(`
    SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
    WHERE u.user_id = ? AND r.role_name = 'MARKETING' AND u.is_active = TRUE`, [data.agent_user_id]);
  if (!agent) return res.status(400).json({ error: 'That user is not an active marketing agent.' });
  // Only one active agent per employee
  await query('UPDATE marketing_assignments SET is_active = FALSE WHERE employee_id = ?', [data.employee_id]);
  const { sql, params } = buildInsert('marketing_assignments', { ...data, is_active: true });
  const result = await query(sql, params);
  res.status(201).json({ assignment_id: result.insertId, ...data });
}));

// End an assignment (employee placed, or taken off marketing)
router.patch('/assignments/:id/end', authorize('CEO', 'HR'), asyncHandler(async (req, res) => {
  const result = await query('UPDATE marketing_assignments SET is_active = FALSE WHERE assignment_id = ? AND is_active = TRUE', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Active assignment not found.' });
  res.json({ assignment_id: Number(req.params.id), is_active: false });
}));

// Record a profile submission
router.post('/submissions', authorize('MARKETING'), asyncHandler(async (req, res) => {
  const data = pick(req.body, ['employee_id', 'vendor_id', 'client_name', 'job_title', 'rate', 'submitted_on', 'status']);
  data.agent_user_id = agentIdFor(req);
  if (!data.employee_id || !data.agent_user_id) return res.status(400).json({ error: 'Employee is required.' });
  data.submitted_on = data.submitted_on || new Date().toISOString().slice(0, 10);
  const { sql, params } = buildInsert('submissions', data);
  const result = await query(sql, params);
  res.status(201).json({ submission_id: result.insertId, ...data });
}));

// Update a submission's status (SUBMITTED, SHORTLISTED, REJECTED, PLACED)
router.patch('/submissions/:id', authorize('MARKETING'), asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['SUBMITTED', 'SHORTLISTED', 'REJECTED', 'PLACED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `Status must be one of ${allowed.join(', ')}.` });
  const params = [status, req.params.id];
  let sql = 'UPDATE submissions SET status = ? WHERE submission_id = ?';
  if (req.user.role === 'MARKETING') { sql += ' AND agent_user_id = ?'; params.push(req.user.user_id); }
  const result = await query(sql, params);
  if (!result.affectedRows) return res.status(404).json({ error: 'Submission not found.' });
  res.json({ submission_id: Number(req.params.id), status });
}));

router.post('/vendor-contacts', authorize('MARKETING'), asyncHandler(async (req, res) => {
  const data = pick(req.body, ['vendor_id', 'contacted_on', 'notes']);
  data.agent_user_id = agentIdFor(req);
  if (!data.vendor_id) return res.status(400).json({ error: 'Vendor is required.' });
  data.contacted_on = data.contacted_on || new Date().toISOString().slice(0, 10);
  const { sql, params } = buildInsert('vendor_contacts', data);
  const result = await query(sql, params);
  res.status(201).json({ contact_id: result.insertId, ...data });
}));

// Save (or overwrite) this week's status
router.post('/weekly-status', authorize('MARKETING'), asyncHandler(async (req, res) => {
  const { week_start, summary } = req.body || {};
  if (!week_start || !summary) return res.status(400).json({ error: 'Week start and summary are required.' });
  await query(`
    INSERT INTO weekly_status (agent_user_id, week_start, summary) VALUES (?, ?, ?)
    ON CONFLICT (agent_user_id, week_start) DO UPDATE SET summary = excluded.summary`,[agentIdFor(req), week_start, summary]);
  res.status(201).json({ week_start, summary });
}));

module.exports = router;
