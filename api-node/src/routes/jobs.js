const express = require('express');
const { query, transaction } = require('../db');
const { authorize } = require('../middleware/auth');
const { pick, asyncHandler } = require('../utils/helpers');
const { score } = require('../utils/matching');
const { notify, userIdsForEmployees } = require('../utils/notify');
const { localDate, addBusinessDays, DUE_DAYS } = require('../utils/followups');

/**
 * Job postings: a marketing agent describes a role, sees matching employees ranked live,
 * and sends the posting to the ones they choose. Employees get a notification, reply
 * Interested / Not interested, and the agent turns interest into a vendor submission.
 *   MARKETING           own postings; can send only to their assigned employees
 *   MARKETING_MANAGER   all postings; can send to any employee
 *   EMPLOYEE            postings sent to them (never the rate or other recipients)
 */
const STAFF = ['MARKETING', 'MARKETING_MANAGER'];
const FIELDS = ['title', 'client_name', 'vendor_id', 'location', 'work_mode', 'duration', 'rate', 'skills', 'description'];

const router = express.Router();
const isManager = (req) => ['MARKETING_MANAGER', 'ADMIN'].includes(req.user.role);

/** Every employee with profile text for matching, current status, visa and marketing agent */
async function candidates() {
  const [emps, work, trainings] = await Promise.all([
    query(`SELECT e.employee_id, e.first_name || ' ' || e.last_name AS employee_name, e.bio,
             cw.status AS current_status, cw.job_title AS current_title, cw.city, cw.state, cw.end_date AS current_end,
             (SELECT i.visa_type FROM immigration i WHERE i.employee_id = e.employee_id ORDER BY i.expiry_date DESC LIMIT 1) AS visa_type,
             ma.agent_user_id, au.full_name AS agent_name
           FROM emp e
           LEFT JOIN work cw ON cw.work_id = (SELECT w2.work_id FROM work w2 WHERE w2.employee_id = e.employee_id AND w2.end_date IS NULL ORDER BY w2.start_date DESC LIMIT 1)
           LEFT JOIN marketing_assignments ma ON ma.employee_id = e.employee_id AND ma.is_active = TRUE
           LEFT JOIN users au ON au.user_id = ma.agent_user_id`),
    query('SELECT employee_id, job_title, project_name, job_duties FROM work'),
    query('SELECT employee_id, training_name FROM trainings'),
  ]);
  const text = {};
  const add = (id, ...parts) => { text[id] = `${text[id] || ''} ${parts.filter(Boolean).join(' ')}`; };
  work.forEach((w) => add(w.employee_id, w.job_title, w.project_name, w.job_duties));
  trainings.forEach((t) => add(t.employee_id, t.training_name));
  return emps.map((e) => ({ ...e, profile: `${e.bio || ''} ${text[e.employee_id] || ''}` }));
}

// Rank employees against a draft posting (called as the agent types)
router.post('/match', authorize(...STAFF), asyncHandler(async (req, res) => {
  const p = pick(req.body || {}, ['title', 'skills', 'description']);
  const scope = req.body?.scope || 'BENCH'; // BENCH | ALL
  if (!`${p.title || ''}${p.skills || ''}${p.description || ''}`.trim()) return res.json([]);
  const me = req.user.user_id;
  const rows = (await candidates())
    .filter((c) => scope === 'ALL' || (c.current_status || 'BENCH') === 'BENCH')
    .map(({ profile, bio, ...c }) => ({
      ...c,
      ...score(p, `${profile}`),
      current_status: c.current_status || 'BENCH',
      can_send: isManager(req) || c.agent_user_id === me,
      mine: c.agent_user_id === me,
    }))
    .sort((a, b) => b.score - a.score || Number(b.mine) - Number(a.mine) || a.employee_name.localeCompare(b.employee_name));
  res.json(rows);
}));

/** Checks the agent may send to these employees; returns an error message or null */
async function checkRecipients(req, ids) {
  if (!ids.length) return 'Choose at least one employee.';
  if (isManager(req)) return null;
  const own = await query(`SELECT employee_id FROM marketing_assignments WHERE agent_user_id = ? AND is_active = TRUE
    AND employee_id IN (${ids.map(() => '?').join(',')})`, [req.user.user_id, ...ids]);
  return own.length === ids.length ? null : 'You can only send postings to employees assigned to you.';
}

/** Adds recipients (skipping ones already on the posting) and notifies them */
async function sendTo(req, posting, ids, scores = {}) {
  const added = transaction((q) => ids.filter((id) => q(`INSERT OR IGNORE INTO job_posting_recipients (posting_id, employee_id, match_score)
    VALUES (?, ?, ?)`, [posting.posting_id, id, scores[id] ?? null]).affectedRows));
  const users = await userIdsForEmployees(added);
  await notify(users, {
    type: 'JOB_POSTING',
    title: `New job opening: ${posting.title}${posting.client_name ? ` at ${posting.client_name}` : ''}`,
    body: `${req.user.full_name} thinks this role fits your profile. Let them know if you're interested.`,
    link: `/my-jobs/${posting.posting_id}`,
  });
  return added;
}

// Create a posting and send it
router.post('/', authorize(...STAFF), asyncHandler(async (req, res) => {
  const p = pick(req.body || {}, FIELDS);
  if (!p.title?.trim()) return res.status(400).json({ error: 'Enter the job title.' });
  if (!p.description?.trim()) return res.status(400).json({ error: 'Enter the job duties.' });
  if (p.work_mode && !['ONSITE', 'HYBRID', 'REMOTE'].includes(p.work_mode)) return res.status(400).json({ error: 'Work mode must be onsite, hybrid or remote.' });
  const ids = [...new Set(req.body?.employee_ids || [])];
  const err = await checkRecipients(req, ids);
  if (err) return res.status(400).json({ error: err });

  const cols = Object.keys(p);
  const r = await query(`INSERT INTO job_postings (agent_user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    [req.user.user_id, ...Object.values(p)]);
  const [posting] = await query('SELECT * FROM job_postings WHERE posting_id = ?', [r.insertId]);
  const all = await candidates();
  const scores = Object.fromEntries(all.filter((c) => ids.includes(c.employee_id)).map((c) => [c.employee_id, score(p, c.profile).score]));
  const sent = await sendTo(req, posting, ids, scores);
  res.status(201).json({ posting_id: posting.posting_id, sent: sent.length });
}));

// Agent: own postings; manager: all
router.get('/', authorize(...STAFF), asyncHandler(async (req, res) => {
  const own = !isManager(req);
  res.json(await query(`
    SELECT p.*, v.vendor_name, u.full_name AS agent_name,
           COUNT(r.employee_id) AS sent,
           SUM(r.response = 'INTERESTED') AS interested,
           SUM(r.response = 'NOT_INTERESTED') AS not_interested,
           SUM(r.response = 'PENDING') AS pending,
           SUM(r.submission_id IS NOT NULL) AS submitted
    FROM job_postings p
    JOIN users u ON u.user_id = p.agent_user_id
    LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
    LEFT JOIN job_posting_recipients r ON r.posting_id = p.posting_id
    ${own ? 'WHERE p.agent_user_id = ?' : ''}
    GROUP BY p.posting_id ORDER BY p.status = 'OPEN' DESC, p.created_at DESC`, own ? [req.user.user_id] : []));
}));

// Employee: postings sent to me (no rate)
router.get('/mine', authorize('EMPLOYEE'), asyncHandler(async (req, res) => {
  res.json(await query(`
    SELECT p.posting_id, p.title, p.client_name, p.location, p.work_mode, p.duration, p.skills, p.description, p.status, p.created_at,
           v.vendor_name, u.full_name AS agent_name, u.email AS agent_email,
           r.match_score, r.sent_at, r.seen_at, r.response, r.response_note, r.responded_at, r.submission_id
    FROM job_posting_recipients r
    JOIN job_postings p ON p.posting_id = r.posting_id
    JOIN users u ON u.user_id = p.agent_user_id
    LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
    WHERE r.employee_id = ? ORDER BY r.sent_at DESC`, [req.user.employee_id]));
}));

/** Loads a posting the caller may see */
async function loadPosting(req, res) {
  const [p] = await query(`SELECT p.*, v.vendor_name, u.full_name AS agent_name, u.email AS agent_email FROM job_postings p
    JOIN users u ON u.user_id = p.agent_user_id LEFT JOIN vendors v ON v.vendor_id = p.vendor_id WHERE p.posting_id = ?`, [req.params.id]);
  const { role, user_id: uid, employee_id: eid } = req.user;
  let ok = p && (isManager(req) || (role === 'MARKETING' && p.agent_user_id === uid));
  if (p && !ok && role === 'EMPLOYEE') {
    const [r] = await query('SELECT 1 FROM job_posting_recipients WHERE posting_id = ? AND employee_id = ?', [p.posting_id, eid]);
    ok = Boolean(r);
  }
  if (!ok) {
    res.status(404).json({ error: 'Job posting not found.' });
    return null;
  }
  return p;
}

router.get('/:id', asyncHandler(async (req, res) => {
  const p = await loadPosting(req, res);
  if (!p) return;
  if (req.user.role === 'EMPLOYEE') {
    await query("UPDATE job_posting_recipients SET seen_at = COALESCE(seen_at, datetime('now','localtime')) WHERE posting_id = ? AND employee_id = ?",
      [p.posting_id, req.user.employee_id]);
    const [mine] = await query('SELECT * FROM job_posting_recipients WHERE posting_id = ? AND employee_id = ?', [p.posting_id, req.user.employee_id]);
    const { rate, ...visible } = p; // the rate stays internal
    return res.json({ ...visible, my_response: mine });
  }
  const recipients = await query(`
    SELECT r.*, e.first_name || ' ' || e.last_name AS employee_name, s.status AS submission_status,
           (SELECT i.visa_type FROM immigration i WHERE i.employee_id = e.employee_id ORDER BY i.expiry_date DESC LIMIT 1) AS visa_type
    FROM job_posting_recipients r JOIN emp e ON e.employee_id = r.employee_id
    LEFT JOIN submissions s ON s.submission_id = r.submission_id
    WHERE r.posting_id = ? ORDER BY CASE r.response WHEN 'INTERESTED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END, r.match_score DESC`, [p.posting_id]);
  res.json({ ...p, recipients });
}));

// Send an existing posting to more employees
router.post('/:id/recipients', authorize(...STAFF), asyncHandler(async (req, res) => {
  const p = await loadPosting(req, res);
  if (!p) return;
  if (p.status !== 'OPEN') return res.status(400).json({ error: 'This posting is closed.' });
  const ids = [...new Set(req.body?.employee_ids || [])];
  const err = await checkRecipients(req, ids);
  if (err) return res.status(400).json({ error: err });
  const all = await candidates();
  const scores = Object.fromEntries(all.filter((c) => ids.includes(c.employee_id)).map((c) => [c.employee_id, score(p, c.profile).score]));
  const sent = await sendTo(req, p, ids, scores);
  res.status(201).json({ sent: sent.length, already: ids.length - sent.length });
}));

// Employee replies Interested / Not interested
router.post('/:id/respond', authorize('EMPLOYEE'), asyncHandler(async (req, res) => {
  const p = await loadPosting(req, res);
  if (!p) return;
  const { response, note } = req.body || {};
  if (!['INTERESTED', 'NOT_INTERESTED'].includes(response)) return res.status(400).json({ error: 'Choose interested or not interested.' });
  if (p.status !== 'OPEN') return res.status(400).json({ error: 'This posting has been closed.' });
  await query(`UPDATE job_posting_recipients SET response = ?, response_note = ?, responded_at = datetime('now','localtime')
    WHERE posting_id = ? AND employee_id = ?`, [response, note?.trim() || null, p.posting_id, req.user.employee_id]);
  await notify(p.agent_user_id, {
    type: 'JOB_RESPONSE',
    title: `${req.user.full_name} is ${response === 'INTERESTED' ? 'interested in' : 'not interested in'} ${p.title}`,
    body: note?.trim() || null,
    link: `/jobs/${p.posting_id}`,
  });
  res.json({ posting_id: p.posting_id, response });
}));

// Agent turns an interested employee into a vendor submission (starts follow-up tracking)
router.post('/:id/recipients/:employeeId/submit', authorize(...STAFF), asyncHandler(async (req, res) => {
  const p = await loadPosting(req, res);
  if (!p) return;
  const [r] = await query('SELECT * FROM job_posting_recipients WHERE posting_id = ? AND employee_id = ?', [p.posting_id, req.params.employeeId]);
  if (!r) return res.status(404).json({ error: 'This employee did not receive the posting.' });
  if (r.submission_id) return res.status(409).json({ error: 'Already submitted to the vendor.' });
  const [assign] = await query('SELECT agent_user_id FROM marketing_assignments WHERE employee_id = ? AND is_active = TRUE', [r.employee_id]);
  const agentId = req.user.role === 'MARKETING' ? req.user.user_id : (assign?.agent_user_id || p.agent_user_id);
  if (req.user.role === 'MARKETING' && assign?.agent_user_id !== req.user.user_id) {
    return res.status(403).json({ error: 'You can only submit employees assigned to you.' });
  }
  const today = localDate();
  const id = transaction((q) => {
    const s = q(`INSERT INTO submissions (employee_id, agent_user_id, vendor_id, client_name, job_title, rate, submitted_on, status,
        last_activity_on, next_follow_up_on) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?)`,
    [r.employee_id, agentId, p.vendor_id, p.client_name, p.title, p.rate, today, today, addBusinessDays(today, DUE_DAYS)]).insertId;
    q(`INSERT INTO submission_activities (submission_id, user_id, activity_type, note, to_status)
       VALUES (?, ?, 'SUBMITTED', ?, 'SUBMITTED')`, [s, req.user.user_id, `Submitted from job posting "${p.title}".`]);
    q('UPDATE job_posting_recipients SET submission_id = ? WHERE posting_id = ? AND employee_id = ?', [s, p.posting_id, r.employee_id]);
    return s;
  });
  await notify(await userIdsForEmployees(r.employee_id), {
    type: 'SUBMISSION_UPDATE',
    title: `Your profile was submitted for ${p.title}${p.client_name ? ` at ${p.client_name}` : ''}`,
    body: 'You can follow the vendor feedback on My Profile.',
    link: '/profile',
  });
  res.status(201).json({ submission_id: id });
}));

router.patch('/:id/status', authorize(...STAFF), asyncHandler(async (req, res) => {
  const p = await loadPosting(req, res);
  if (!p) return;
  const status = req.body?.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
  await query('UPDATE job_postings SET status = ? WHERE posting_id = ?', [status, p.posting_id]);
  res.json({ posting_id: p.posting_id, status });
}));

module.exports = router;
