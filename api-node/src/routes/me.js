const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../utils/helpers');
const { withFollowUp } = require('../utils/followups');

const router = express.Router();

/**
 * GET /api/me/profile — what an employee sees after login.
 * On project: bio, hire date, current client, past & present duties, interviews, trainings.
 * On bench:   all of the above plus interview pipeline, marketing agent, profiles submitted.
 */
router.get('/profile', asyncHandler(async (req, res) => {
  const id = req.user.employee_id;
  if (!id) return res.status(404).json({ error: 'Your login is not linked to an employee record.' });

  const [emp] = await query('SELECT * FROM emp WHERE employee_id = ?', [id]);
  if (!emp) return res.status(404).json({ error: 'Employee record not found.' });

  const [work, trainings, interviews, immigration, agentRows, submissions] = await Promise.all([
    query(`SELECT w.*, c.client_name, c.contact_name AS client_contact, c.address AS client_address, v.vendor_name
           FROM work w
           LEFT JOIN clients c ON c.client_id = w.client_id
           LEFT JOIN vendors v ON v.vendor_id = w.vendor_id
           WHERE w.employee_id = ? ORDER BY w.end_date IS NULL DESC, w.start_date DESC`, [id]),
    query('SELECT * FROM trainings WHERE employee_id = ? ORDER BY start_date DESC', [id]),
    query('SELECT * FROM interviews WHERE employee_id = ? ORDER BY interview_date DESC', [id]),
    query(`SELECT visa_type, expiry_date, lca_expiry_date, case_status, CAST(julianday(expiry_date) - julianday(date('now','localtime')) AS INTEGER) AS days_left
           FROM immigration WHERE employee_id = ?`, [id]),
    query(`SELECT u.user_id, u.full_name, u.email, ma.assigned_on
           FROM marketing_assignments ma JOIN users u ON u.user_id = ma.agent_user_id
           WHERE ma.employee_id = ? AND ma.is_active = TRUE LIMIT 1`, [id]),
    // No bill rate or vendor recruiter name here: those stay internal
    query(`SELECT s.submission_id, s.client_name, s.job_title, s.position_ref, s.submitted_on, s.status,
                  s.last_activity_on, s.next_follow_up_on, v.vendor_name, u.full_name AS agent_name,
                  (SELECT a.vendor_feedback FROM submission_activities a
                    WHERE a.submission_id = s.submission_id AND a.vendor_feedback IS NOT NULL
                    ORDER BY a.created_at DESC, a.activity_id DESC LIMIT 1) AS latest_vendor_feedback,
                  (SELECT COUNT(*) FROM update_requests ur
                    WHERE ur.submission_id = s.submission_id AND ur.resolved_on IS NULL) AS open_update_request
           FROM submissions s LEFT JOIN vendors v ON v.vendor_id = s.vendor_id
           JOIN users u ON u.user_id = s.agent_user_id
           WHERE s.employee_id = ? ORDER BY s.submitted_on DESC`, [id]),
  ]);

  const current = work.find((w) => !w.end_date) || null;
  const countBy = (result) => interviews.filter((i) => i.result === result).length;

  res.json({
    employee: emp,
    status: current?.status || 'BENCH',
    current_assignment: current,
    past_assignments: work.filter((w) => w.end_date),
    trainings,
    immigration,
    interviews: {
      total: interviews.length,
      pipeline: countBy('PIPELINE'),
      attended: countBy('ATTENDED') + countBy('SELECTED') + countBy('REJECTED'),
      awaiting_result: countBy('AWAITING_RESULT'),
      list: interviews,
    },
    marketing_agent: agentRows[0] || null,
    profiles_submitted: submissions.length,
    submissions: submissions.map((s) => withFollowUp(s)),
  });
}));

module.exports = router;
