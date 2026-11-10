/**
 * Follow-up rules for vendor submissions.
 *   - Next follow-up is due FOLLOW_UP_DUE_DAYS business days after the agent's last activity.
 *   - The submission is OVERDUE once FOLLOW_UP_OVERDUE_DAYS business days pass with no activity.
 *   - Closed submissions (placed, rejected, position closed, no response) need no follow-up.
 * The Python daily job (service-python/app/jobs/followups.py) uses the same rules.
 */
const STAGES = [
  'SUBMITTED', 'ACKNOWLEDGED', 'SCREENING_SCHEDULED', 'SCREENING_DONE', 'CLIENT_INTERVIEW', 'OFFER', 'PLACED',
];
const CLOSED = ['PLACED', 'REJECTED', 'POSITION_CLOSED', 'NO_RESPONSE'];
const ALL_STATUSES = [...STAGES, 'REJECTED', 'POSITION_CLOSED', 'NO_RESPONSE'];
const CHANNELS = ['CALL', 'EMAIL', 'PORTAL', 'LINKEDIN', 'OTHER'];

const DUE_DAYS = Number(process.env.FOLLOW_UP_DUE_DAYS || 3);
const OVERDUE_DAYS = Number(process.env.FOLLOW_UP_OVERDUE_DAYS || 5);

/** 'YYYY-MM-DD' in the server's local time zone (not UTC). */
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const parse = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00`);
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

function addBusinessDays(from, n) {
  const d = parse(from);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) left -= 1;
  }
  return localDate(d);
}

/** Business days after `from` up to and including `to` (0 if same day or earlier). */
function businessDaysBetween(from, to) {
  const d = parse(from);
  const end = parse(to);
  let n = 0;
  while (d < end) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) n += 1;
  }
  return n;
}

/**
 * Adds follow_up_state (CLOSED | OK | DUE | OVERDUE), follow_up_due_on and
 * business_days_idle to a submission row.
 */
function withFollowUp(s, today = localDate()) {
  if (CLOSED.includes(s.status)) return { ...s, follow_up_state: 'CLOSED', follow_up_due_on: null, business_days_idle: null };
  const last = s.last_activity_on || s.submitted_on;
  const idle = businessDaysBetween(last, today);
  const dueOn = s.next_follow_up_on || addBusinessDays(last, DUE_DAYS);
  let state = 'OK';
  if (idle >= OVERDUE_DAYS) state = 'OVERDUE';
  else if (dueOn <= today) state = 'DUE';
  return { ...s, follow_up_state: state, follow_up_due_on: dueOn, business_days_idle: idle };
}

/** How far a submission got in the pipeline, using its current status and its history. */
function furthestStage(status, history = []) {
  const ranks = [status, ...history].map((st) => STAGES.indexOf(st)).filter((i) => i >= 0);
  return ranks.length ? STAGES[Math.max(...ranks)] : 'SUBMITTED';
}

module.exports = {
  STAGES, CLOSED, ALL_STATUSES, CHANNELS, DUE_DAYS, OVERDUE_DAYS,
  localDate, addBusinessDays, businessDaysBetween, withFollowUp, furthestStage,
};
