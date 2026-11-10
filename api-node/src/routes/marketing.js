const express = require('express');
const { query, transaction } = require('../db');
const { authorize } = require('../middleware/auth');
const { pick, buildInsert, asyncHandler } = require('../utils/helpers');
const { notify, userIdsForEmployees } = require('../utils/notify');
const {
  STAGES, CLOSED, ALL_STATUSES, CHANNELS, DUE_DAYS, OVERDUE_DAYS, localDate, addBusinessDays, withFollowUp, furthestStage,
} = require('../utils/followups');

const router = express.Router();

/** Marketing agents see their own data; CEO / ADMIN / HR / Marketing Manager may pass ?agent_id=. */
function agentIdFor(req) {
  if (req.user.role === 'MARKETING') return req.user.user_id;
  return Number(req.query.agent_id || req.body?.agent_user_id) || null;
}

// List of marketing agents (for assignment dropdowns)
router.get('/agents', authorize('CEO', 'HR', 'MARKETING', 'MARKETING_MANAGER'), asyncHandler(async (req, res) => {
  res.json(await query(`
    SELECT u.user_id, u.full_name, u.email FROM users u JOIN roles r ON r.role_id = u.role_id
    WHERE r.role_name = 'MARKETING' AND u.is_active = TRUE ORDER BY u.full_name`));
}));

// Everything the marketing agent sees on login
router.get('/dashboard', authorize('MARKETING', 'CEO', 'HR', 'MARKETING_MANAGER'), asyncHandler(async (req, res) => {
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
      SELECT s.*, e.first_name || ' ' || e.last_name AS employee_name, v.vendor_name,
             (SELECT COUNT(*) FROM update_requests ur WHERE ur.submission_id = s.submission_id AND ur.resolved_on IS NULL) AS open_update_request
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

  const order = { OVERDUE: 0, DUE: 1, OK: 2, CLOSED: 3 };
  const subs = submissions.map((s) => withFollowUp(s))
    .sort((a, b) => b.open_update_request - a.open_update_request
      || order[a.follow_up_state] - order[b.follow_up_state]
      || String(a.follow_up_due_on || '').localeCompare(String(b.follow_up_due_on || ''))
      || b.submitted_on.localeCompare(a.submitted_on));
  const placed = subs.filter((s) => s.status === 'PLACED');
  const count = (st) => subs.filter((s) => s.follow_up_state === st).length;
  res.json({
    summary: {
      employees_assigned: employees.length,
      profiles_submitted: subs.length,
      vendors_contacted: new Set(vendorsContacted.map((v) => v.vendor_id)).size,
      employees_placed: new Set(placed.map((s) => s.employee_id)).size,
      follow_ups_due: count('DUE'),
      follow_ups_overdue: count('OVERDUE'),
      open_update_requests: subs.filter((s) => s.open_update_request).length,
    },
    rules: { due_days: DUE_DAYS, overdue_days: OVERDUE_DAYS },
    employees, submissions: subs, vendors_contacted: vendorsContacted, placed, weekly_status: weekly,
  });
}));

// Assign a bench employee to an agent
router.post('/assignments', authorize('CEO', 'HR', 'MARKETING_MANAGER'), asyncHandler(async (req, res) => {
  const data = pick(req.body, ['employee_id', 'agent_user_id', 'assigned_on']);
  if (!data.employee_id || !data.agent_user_id) return res.status(400).json({ error: 'Employee and agent are required.' });
  data.assigned_on = data.assigned_on || localDate();
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
router.patch('/assignments/:id/end', authorize('CEO', 'HR', 'MARKETING_MANAGER'), asyncHandler(async (req, res) => {
  const result = await query('UPDATE marketing_assignments SET is_active = FALSE WHERE assignment_id = ? AND is_active = TRUE', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Active assignment not found.' });
  res.json({ assignment_id: Number(req.params.id), is_active: false });
}));

// Record a profile submission (starts its follow-up timeline)
router.post('/submissions', authorize('MARKETING'), asyncHandler(async (req, res) => {
  const data = pick(req.body, ['employee_id', 'vendor_id', 'client_name', 'job_title', 'rate', 'position_ref',
    'vendor_contact_name', 'submitted_on']);
  data.agent_user_id = agentIdFor(req);
  if (!data.employee_id || !data.agent_user_id) return res.status(400).json({ error: 'Employee is required.' });
  const channel = req.body?.channel || null;
  if (channel && !CHANNELS.includes(channel)) return res.status(400).json({ error: `Channel must be one of ${CHANNELS.join(', ')}.` });

  const [assigned] = await query(
    'SELECT 1 FROM marketing_assignments WHERE employee_id = ? AND agent_user_id = ? AND is_active = TRUE',
    [data.employee_id, data.agent_user_id],
  );
  if (!assigned && req.user.role === 'MARKETING') {
    return res.status(403).json({ error: 'You can only submit employees assigned to you.' });
  }

  data.submitted_on = data.submitted_on || localDate();
  data.status = 'SUBMITTED';
  data.last_activity_on = data.submitted_on;
  data.next_follow_up_on = addBusinessDays(data.submitted_on, DUE_DAYS);

  const id = transaction((q) => {
    const { sql, params } = buildInsert('submissions', data);
    const { insertId } = q(sql, params);
    q(`INSERT INTO submission_activities (submission_id, user_id, activity_type, channel, vendor_contact_name, note, to_status)
       VALUES (?, ?, 'SUBMITTED', ?, ?, ?, 'SUBMITTED')`,
    [insertId, req.user.user_id, channel, data.vendor_contact_name || null, req.body?.note || null]);
    return insertId;
  });
  res.status(201).json({ submission_id: id, ...data });
}));

// All submissions the caller may see (agents: their own), with follow-up state. Used by dashboard drill-downs.
router.get('/submissions', authorize('MARKETING', 'MARKETING_MANAGER', 'CEO', 'HR'), asyncHandler(async (req, res) => {
  const own = req.user.role === 'MARKETING';
  const rows = await query(`
    SELECT s.*, e.first_name || ' ' || e.last_name AS employee_name, v.vendor_name, u.full_name AS agent_name,
           (SELECT COUNT(*) FROM update_requests ur WHERE ur.submission_id = s.submission_id AND ur.resolved_on IS NULL) AS open_update_request
    FROM submissions s
    JOIN emp e ON e.employee_id = s.employee_id
    JOIN users u ON u.user_id = s.agent_user_id
    LEFT JOIN vendors v ON v.vendor_id = s.vendor_id
    ${own ? 'WHERE s.agent_user_id = ?' : ''}
    ORDER BY s.submitted_on DESC, s.submission_id DESC`, own ? [req.user.user_id] : []);
  res.json(rows.map((s) => withFollowUp(s)));
}));

/** Loads a submission and checks the caller may see it. Returns null (and responds) if not. */
async function loadSubmission(req, res) {
  const [s] = await query(`
    SELECT s.*, e.first_name || ' ' || e.last_name AS employee_name, v.vendor_name, u.full_name AS agent_name
    FROM submissions s
    JOIN emp e ON e.employee_id = s.employee_id
    JOIN users u ON u.user_id = s.agent_user_id
    LEFT JOIN vendors v ON v.vendor_id = s.vendor_id
    WHERE s.submission_id = ?`, [req.params.id]);
  const { role, user_id: userId, employee_id: empId } = req.user;
  const allowed = s && (
    ['ADMIN', 'CEO', 'HR', 'MARKETING_MANAGER'].includes(role)
    || (role === 'MARKETING' && s.agent_user_id === userId)
    || (role === 'EMPLOYEE' && s.employee_id === empId));
  if (!allowed) {
    res.status(404).json({ error: 'Submission not found.' });
    return null;
  }
  return s;
}

// One submission with its full timeline
router.get('/submissions/:id', asyncHandler(async (req, res) => {
  const s = await loadSubmission(req, res);
  if (!s) return;
  const [activities, requests] = await Promise.all([
    query(`SELECT a.*, u.full_name AS by_name, r.role_name AS by_role
           FROM submission_activities a
           LEFT JOIN users u ON u.user_id = a.user_id
           LEFT JOIN roles r ON r.role_id = u.role_id
           WHERE a.submission_id = ? ORDER BY a.created_at DESC, a.activity_id DESC`, [s.submission_id]),
    query('SELECT * FROM update_requests WHERE submission_id = ? ORDER BY requested_on DESC', [s.submission_id]),
  ]);
  const out = { ...withFollowUp(s), activities, update_requests: requests,
    open_update_request: requests.find((r) => !r.resolved_on) || null };
  if (req.user.role === 'EMPLOYEE') {
    // Internal details stay with the company: bill rate and the vendor recruiter's name
    delete out.rate;
    delete out.vendor_contact_name;
    out.activities = activities.map(({ vendor_contact_name: _v, ...a }) => a);
  }
  res.json(out);
}));

// Agent logs a follow-up with the vendor (optionally moving the stage)
router.post('/submissions/:id/follow-ups', authorize('MARKETING', 'MARKETING_MANAGER'), asyncHandler(async (req, res) => {
  const s = await loadSubmission(req, res);
  if (!s) return;
  const b = req.body || {};
  if (!CHANNELS.includes(b.channel)) return res.status(400).json({ error: `Choose how you followed up (${CHANNELS.join(', ')}).` });
  if (!b.vendor_feedback?.trim() && !b.note?.trim()) {
    return res.status(400).json({ error: 'Write what the vendor said or add a note.' });
  }
  const newStatus = b.status && b.status !== s.status ? b.status : null;
  if (newStatus && !ALL_STATUSES.includes(newStatus)) return res.status(400).json({ error: 'Unknown stage.' });

  const status = newStatus || s.status;
  const today = localDate();
  const closed = CLOSED.includes(status);
  const next = closed ? null : (b.next_follow_up_on || addBusinessDays(today, DUE_DAYS));
  if (next && next < today) return res.status(400).json({ error: 'Next follow-up date cannot be in the past.' });

  transaction((q) => {
    q(`INSERT INTO submission_activities (submission_id, user_id, activity_type, channel, vendor_contact_name,
                                          vendor_feedback, note, from_status, to_status)
       VALUES (?, ?, 'FOLLOW_UP', ?, ?, ?, ?, ?, ?)`,
    [s.submission_id, req.user.user_id, b.channel, b.vendor_contact_name || null, b.vendor_feedback?.trim() || null,
      b.note?.trim() || null, newStatus ? s.status : null, newStatus]);
    q(`UPDATE submissions SET status = ?, last_activity_on = ?, next_follow_up_on = ?, closed_on = ?,
              vendor_contact_name = COALESCE(?, vendor_contact_name)
       WHERE submission_id = ?`,
    [status, today, next, closed ? (s.closed_on || today) : null, b.vendor_contact_name || null, s.submission_id]);
    // A follow-up answers any open "request update" from the employee
    q("UPDATE update_requests SET resolved_on = datetime('now','localtime') WHERE submission_id = ? AND resolved_on IS NULL",
      [s.submission_id]);
  });
  if (b.vendor_feedback?.trim() || newStatus) {
    await notify(await userIdsForEmployees(s.employee_id), {
      type: 'SUBMISSION_UPDATE',
      title: `Update on ${s.job_title || 'your submission'}${s.vendor_name ? ` (${s.vendor_name})` : ''}${newStatus ? `: ${newStatus.replaceAll('_', ' ').toLowerCase()}` : ''}`,
      body: b.vendor_feedback?.trim() || null,
      link: '/profile',
    });
  }
  res.status(201).json({ submission_id: s.submission_id, status, next_follow_up_on: next });
}));

// Bench employee adds their own feedback (e.g. confirms a screening call happened)
router.post('/submissions/:id/feedback', authorize('EMPLOYEE'), asyncHandler(async (req, res) => {
  const s = await loadSubmission(req, res);
  if (!s) return;
  const note = req.body?.note?.trim();
  if (!note) return res.status(400).json({ error: 'Write your feedback.' });
  await query(`INSERT INTO submission_activities (submission_id, user_id, activity_type, note)
               VALUES (?, ?, 'EMPLOYEE_FEEDBACK', ?)`, [s.submission_id, req.user.user_id, note]);
  res.status(201).json({ submission_id: s.submission_id });
}));

// Bench employee asks the agent for an update; escalated by the daily job if not answered
router.post('/submissions/:id/update-request', authorize('EMPLOYEE'), asyncHandler(async (req, res) => {
  const s = await loadSubmission(req, res);
  if (!s) return;
  if (CLOSED.includes(s.status)) return res.status(400).json({ error: 'This submission is closed.' });
  const [open] = await query('SELECT requested_on FROM update_requests WHERE submission_id = ? AND resolved_on IS NULL',
    [s.submission_id]);
  if (open) return res.status(409).json({ error: `You already asked for an update on ${open.requested_on.slice(0, 10)}. Your agent has been notified.` });
  const message = req.body?.message?.trim() || null;
  transaction((q) => {
    q('INSERT INTO update_requests (submission_id, employee_id, message) VALUES (?, ?, ?)',
      [s.submission_id, s.employee_id, message]);
    q(`INSERT INTO submission_activities (submission_id, user_id, activity_type, note)
       VALUES (?, ?, 'UPDATE_REQUEST', ?)`, [s.submission_id, req.user.user_id, message || 'Requested an update.']);
  });
  await notify(s.agent_user_id, {
    type: 'UPDATE_REQUEST',
    title: `${s.employee_name} asked for an update on ${s.job_title || 'a submission'}`,
    body: message,
    link: '/marketing',
  });
  res.status(201).json({ submission_id: s.submission_id });
}));

// Marketing Manager / CEO: agent scorecard, follow-ups needing attention, update requests
router.get('/team', authorize('CEO', 'MARKETING_MANAGER'), asyncHandler(async (req, res) => {
  const today = localDate();
  const since = localDate(new Date(Date.now() - 30 * 86400000));
  const [agents, subs, history, followUps, requests] = await Promise.all([
    query(`SELECT u.user_id, u.full_name, u.email,
                  (SELECT COUNT(*) FROM marketing_assignments ma WHERE ma.agent_user_id = u.user_id AND ma.is_active) AS employees_assigned
           FROM users u JOIN roles r ON r.role_id = u.role_id
           WHERE r.role_name = 'MARKETING' AND u.is_active ORDER BY u.full_name`),
    query(`SELECT s.*, e.first_name || ' ' || e.last_name AS employee_name, v.vendor_name, u.full_name AS agent_name
           FROM submissions s JOIN emp e ON e.employee_id = s.employee_id
           JOIN users u ON u.user_id = s.agent_user_id
           LEFT JOIN vendors v ON v.vendor_id = s.vendor_id`),
    query('SELECT submission_id, to_status FROM submission_activities WHERE to_status IS NOT NULL'),
    query(`SELECT user_id, COUNT(*) AS n FROM submission_activities
           WHERE activity_type = 'FOLLOW_UP' AND created_at >= ? GROUP BY user_id`, [since]),
    query(`SELECT ur.*, s.agent_user_id, s.client_name, s.job_title, s.status, v.vendor_name, u.full_name AS agent_name,
                  e.first_name || ' ' || e.last_name AS employee_name
           FROM update_requests ur JOIN submissions s ON s.submission_id = ur.submission_id
           JOIN emp e ON e.employee_id = ur.employee_id
           JOIN users u ON u.user_id = s.agent_user_id
           LEFT JOIN vendors v ON v.vendor_id = s.vendor_id
           ORDER BY ur.requested_on DESC`),
  ]);

  const stagesBySub = {};
  history.forEach((h) => { (stagesBySub[h.submission_id] ||= []).push(h.to_status); });
  const rank = (st) => STAGES.indexOf(st);
  const all = subs.map((s) => ({ ...withFollowUp(s, today), furthest_stage: furthestStage(s.status, stagesBySub[s.submission_id]) }));
  const followUpsBy = Object.fromEntries(followUps.map((f) => [f.user_id, f.n]));

  const scorecard = agents.map((a) => {
    const mine = all.filter((s) => s.agent_user_id === a.user_id);
    const open = mine.filter((s) => s.follow_up_state !== 'CLOSED');
    const overdue = open.filter((s) => s.follow_up_state === 'OVERDUE').length;
    const myRequests = requests.filter((r) => r.agent_user_id === a.user_id);
    return {
      ...a,
      submissions_30d: mine.filter((s) => s.submitted_on >= since).length,
      follow_ups_30d: followUpsBy[a.user_id] || 0,
      open_submissions: open.length,
      overdue,
      on_schedule_pct: open.length ? Math.round(((open.length - overdue) / open.length) * 100) : null,
      avg_idle_days: open.length ? Math.round((open.reduce((t, s) => t + s.business_days_idle, 0) / open.length) * 10) / 10 : null,
      total_submissions: mine.length,
      reached_screening: mine.filter((s) => rank(s.furthest_stage) >= rank('SCREENING_SCHEDULED')).length,
      reached_interview: mine.filter((s) => rank(s.furthest_stage) >= rank('CLIENT_INTERVIEW')).length,
      placed: mine.filter((s) => s.status === 'PLACED').length,
      update_requests_30d: myRequests.filter((r) => r.requested_on >= since).length,
      open_update_requests: myRequests.filter((r) => !r.resolved_on).length,
    };
  });

  const order = { OVERDUE: 0, DUE: 1 };
  const attention = all.filter((s) => s.follow_up_state in order)
    .sort((x, y) => order[x.follow_up_state] - order[y.follow_up_state] || y.business_days_idle - x.business_days_idle);

  res.json({
    rules: { due_days: DUE_DAYS, overdue_days: OVERDUE_DAYS },
    scorecard,
    attention,
    open_update_requests: requests.filter((r) => !r.resolved_on),
  });
}));

router.post('/vendor-contacts', authorize('MARKETING'), asyncHandler(async (req, res) => {
  const data = pick(req.body, ['vendor_id', 'contacted_on', 'notes']);
  data.agent_user_id = agentIdFor(req);
  if (!data.vendor_id) return res.status(400).json({ error: 'Vendor is required.' });
  data.contacted_on = data.contacted_on || localDate();
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
