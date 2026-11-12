/**
 * LCA change detection for H-1B employees.
 *
 * Call trackWorkChanges() around any write to the work table:
 *   const t = trackWorkChanges({ employeeIds: [...] } | { workIds: [...] });   // before the write
 *   ...write...
 *   await t.done(userId);                                                       // after the write
 *
 * For each H-1B employee (active H-1B visa on file) it compares the assignments before and after:
 *   - edit of a current/future assignment: client, worksite, work arrangement, job title
 *   - new PROJECT assignment: compared with the worksite the employee's LCA covered (latest earlier project)
 *   - move to BENCH: HR is reminded the LCA wage must still be paid
 * and opens (or updates) an lca_reviews row with a suggested outcome, then notifies Legal (and HR for bench).
 *
 * The suggestion is guidance; Legal decides. General H-1B rules behind it:
 *   - worksite outside the LCA's metro area (MSA)  -> new LCA + amended petition before the move
 *   - new worksite inside the same metro area        -> post the existing LCA notice there (10 business days)
 *   - significant change in duties / occupation      -> amendment
 *   - new client, same place and duties              -> usually no amendment (update itinerary / client letter)
 */
const { querySync } = require('../db');
const { notify } = require('./notify');

const SEVERITY = { POSTING: 1, CHECK: 2, AMENDMENT_LIKELY: 3 };
const OPEN_STATUSES = ['OPEN', 'AMENDMENT_REQUIRED', 'POSTING_REQUIRED'];
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const blank = (v) => norm(v) === '';
const place = (w) => [w.worksite_address, w.city, w.state, w.worksite_zip].filter((x) => !blank(x)).join(', ');
const cityState = (w) => [w.city, w.state].filter((x) => !blank(x)).join(', ');

/** Active H-1B on file (not expired) */
function isH1B(q, employeeId) {
  return q(`SELECT 1 FROM immigration WHERE employee_id = ?
              AND replace(replace(upper(visa_type), '-', ''), ' ', '') LIKE 'H1B%'
              AND case_status <> 'EXPIRED' AND expiry_date >= date('now','localtime') LIMIT 1`, [employeeId]).length > 0;
}

const workRows = (q, where, params) => q(`SELECT w.*, c.client_name FROM work w LEFT JOIN clients c ON c.client_id = w.client_id WHERE ${where}`, params);

/**
 * Field-by-field differences between two versions of an assignment. A field that was empty before is being
 * filled in, not changed, so it doesn't count (unless `strict`, used for new assignments vs. the LCA worksite).
 */
function diff(before, after, { strict = false } = {}) {
  const changes = [];
  const changed = (a, b) => norm(a) !== norm(b) && (strict ? !blank(b) : !blank(a));
  if (changed(before.client_name, after.client_name) && (before.client_id || null) !== (after.client_id || null)) {
    changes.push({ field: 'client', label: 'Client', from: before.client_name || '—', to: after.client_name || '—' });
  }
  const locFields = ['worksite_address', 'city', 'state', 'worksite_zip'];
  if (locFields.some((f) => changed(before[f], after[f]))) {
    changes.push({ field: 'worksite', label: 'Worksite', from: place(before) || '—', to: place(after) || '—',
      fromState: norm(before.state), toState: norm(after.state), fromCity: norm(before.city), toCity: norm(after.city) });
  }
  if (changed(before.work_location, after.work_location)) {
    changes.push({ field: 'arrangement', label: 'Work arrangement', from: before.work_location || '—', to: after.work_location || '—' });
  }
  if (changed(before.job_title, after.job_title)) {
    changes.push({ field: 'job_title', label: 'Job title', from: before.job_title || '—', to: after.job_title || '—' });
  }
  return changes;
}

/** Suggested outcome + plain-language reasons for a set of changes */
function classify(changes, { newAssignment = false, after = {} } = {}) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const ws = changes.find((c) => c.field === 'worksite');
  if (ws && (!ws.fromState || !ws.toState)) {
    add('CHECK', `Worksite ${ws.to}: no earlier worksite to compare with. Confirm the LCA covers this location.`);
  } else if (ws) {
    if (ws.fromState && ws.toState && ws.fromState !== ws.toState) {
      add('AMENDMENT_LIKELY', `Worksite moves to another state (${ws.from} → ${ws.to}). This is almost certainly outside the current LCA's metro area: a new LCA and an amended H-1B petition must be filed before the employee works there.`);
    } else if (ws.fromCity && ws.toCity && ws.fromCity !== ws.toCity) {
      add('CHECK', `Worksite moves to another city (${ws.from} → ${ws.to}). If it is outside the current LCA's metro area, file a new LCA and an amendment before the move; if it is inside, post the existing LCA notice at the new site.`);
    } else {
      add('POSTING', `New address in the same city (${ws.from} → ${ws.to}). Usually no amendment: post the existing LCA notice at the new worksite for 10 business days (or electronically).`);
    }
  }
  const arr = changes.find((c) => c.field === 'arrangement');
  if (arr && arr.from === '—') add('CHECK', `Work arrangement ${arr.to}. Confirm the place the employee will actually work (home address when remote) is covered by the LCA.`);
  else if (arr) add('CHECK', `Work arrangement changes (${arr.from} → ${arr.to}). Confirm the place the employee will actually work (home address when remote) is covered by the LCA.`);
  const title = changes.find((c) => c.field === 'job_title');
  if (title && title.from === '—') add('CHECK', `Job title ${title.to}. Confirm it matches the occupation on the LCA and petition.`);
  else if (title) add('CHECK', `Job title changes (${title.from} → ${title.to}). An amendment is needed if the duties or the occupation (SOC code) change significantly.`);
  const client = changes.find((c) => c.field === 'client');
  if (client && client.from === '—') add('CHECK', `End client ${client.to}. Confirm the itinerary and end-client letter cover this placement.`);
  else if (client && !ws) add('CHECK', `New client (${client.from} → ${client.to}) at the same location. Usually no amendment if the duties stay the same; update the itinerary and end-client letter.`);
  if (newAssignment && !changes.length && !place(after)) {
    add('CHECK', 'New project with no worksite recorded. Add the worksite so Legal can confirm the LCA covers it.');
  }
  if (!out.length) return null;
  const suggestion = out.reduce((a, r) => (SEVERITY[r.level] > SEVERITY[a] ? r.level : a), 'POSTING');
  return { suggestion, reasons: out.sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level]).map((r) => r.text) };
}

/** Opens a review, or updates the open one for the same assignment. Returns { reviewId, created } or null. */
function openReview(q, { employeeId, workId, kind, changes, result, userId }) {
  const [open] = q("SELECT * FROM lca_reviews WHERE work_id = ? AND status = 'OPEN' ORDER BY review_id DESC LIMIT 1", [workId]);
  if (open) {
    // Keep the original "from" of each field so the review always shows the full change since it opened
    const prev = JSON.parse(open.changes);
    const merged = changes.map((c) => {
      const p = prev.find((x) => x.field === c.field);
      return p ? { ...c, from: p.from, fromState: p.fromState, fromCity: p.fromCity } : c; // starting point = when the review opened
    });
    prev.forEach((p) => { if (!merged.some((m) => m.field === p.field)) merged.push(p); });
    const effective = merged.filter((c) => norm(c.from) !== norm(c.to));
    if (!effective.length) { q('DELETE FROM lca_reviews WHERE review_id = ?', [open.review_id]); return null; } // changed back
    let again = classify(effective, { newAssignment: open.change_kind === 'NEW_ASSIGNMENT' }) || result;
    if (open.change_kind === 'NEW_ASSIGNMENT' && effective.every((c) => c.from === '—')) {
      again = { suggestion: 'CHECK', reasons: ['First project on record for this H-1B employee. Confirm the LCA covers this worksite, job title and client.', ...again.reasons] };
    }
    q(`UPDATE lca_reviews SET changes = ?, suggestion = ?, reasons = ?, updated_at = datetime('now','localtime') WHERE review_id = ?`,
      [JSON.stringify(effective), again.suggestion, JSON.stringify(again.reasons), open.review_id]);
    return { reviewId: open.review_id, created: false, suggestion: again.suggestion };
  }
  const id = q(`INSERT INTO lca_reviews (employee_id, work_id, change_kind, changes, suggestion, reasons, raised_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [employeeId, workId, kind, JSON.stringify(changes), result.suggestion, JSON.stringify(result.reasons), userId || null]).insertId;
  return { reviewId: id, created: true, suggestion: result.suggestion };
}

/** Compares before/after work rows of the given employees and records reviews. Returns notification events. */
function compareAndRecord(q, before, employeeIds, userId) {
  const events = [];
  const today = q("SELECT date('now','localtime') AS d")[0].d;
  employeeIds.forEach((empId) => {
    if (!isH1B(q, empId)) return;
    const [emp] = q("SELECT first_name || ' ' || last_name AS name FROM emp WHERE employee_id = ?", [empId]);
    const after = workRows(q, 'w.employee_id = ?', [empId]);
    const beforeById = new Map(before.filter((w) => w.employee_id === empId).map((w) => [w.work_id, w]));
    after.forEach((w) => {
      const live = !w.end_date || w.end_date >= today; // ended assignments don't need LCA review
      const old = beforeById.get(w.work_id);
      if (!old) {
        if (!live) return;
        if (w.status === 'BENCH') { events.push({ type: 'BENCH', empId, name: emp.name, work: w }); return; }
        // New project: compare with the worksite the LCA covered = the latest earlier project
        const [base] = after.filter((x) => x.work_id !== w.work_id && x.status === 'PROJECT' && x.start_date <= w.start_date)
          .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
        // No earlier project: list what the new project is, so Legal sees it at a glance
        const changes = base ? diff(base, w, { strict: true }) : diff({}, w, { strict: true });
        let result = classify(changes, { newAssignment: true, after: w });
        if (!base) {
          result = { suggestion: 'CHECK', reasons: ['First project on record for this H-1B employee. Confirm the LCA covers this worksite, job title and client.', ...(result?.reasons || [])] };
        }
        if (!result) return;
        const r = openReview(q, { employeeId: empId, workId: w.work_id, kind: 'NEW_ASSIGNMENT', changes, result, userId });
        if (r) events.push({ type: 'REVIEW', empId, name: emp.name, ...r });
        return;
      }
      if (!live) return;
      if (old.status !== 'BENCH' && w.status === 'BENCH') { events.push({ type: 'BENCH', empId, name: emp.name, work: w }); return; }
      const changes = diff(old, w);
      if (!changes.length) return;
      const result = classify(changes);
      if (!result) return;
      const r = openReview(q, { employeeId: empId, workId: w.work_id, kind: 'ASSIGNMENT_CHANGE', changes, result, userId });
      if (r) events.push({ type: 'REVIEW', empId, name: emp.name, ...r });
    });
  });
  return events;
}

const SUGGESTION_TEXT = { AMENDMENT_LIKELY: 'LCA amendment likely needed', CHECK: 'LCA check needed', POSTING: 'LCA notice posting needed' };

async function sendEvents(events) {
  const legal = querySync("SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'LEGAL' AND u.is_active = 1").map((r) => r.user_id);
  const hr = querySync("SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'HR' AND u.is_active = 1").map((r) => r.user_id);
  for (const e of events) {
    if (e.type === 'REVIEW' && e.created) {
      // eslint-disable-next-line no-await-in-loop
      await notify(legal, { type: 'LCA_REVIEW', title: `${SUGGESTION_TEXT[e.suggestion]}: ${e.name}`, body: 'An H-1B assignment changed. Review it and record your decision.', link: '/immigration?tab=changes' });
    }
    if (e.type === 'BENCH') {
      // eslint-disable-next-line no-await-in-loop
      await notify([...hr, ...legal], { type: 'H1B_BENCH', title: `H-1B employee on bench: ${e.name}`, body: 'Keep paying the LCA wage while on bench. Unpaid bench time violates the LCA.', link: '/immigration?tab=changes' });
    }
  }
}

/**
 * Snapshot before a work write. scope: { employeeIds } or { workIds }.
 * Returns { done(userId) } to call after the write; never throws (logs instead) so it can't break the save.
 */
function trackWorkChanges(scope) {
  let before = [];
  let employeeIds = [];
  try {
    if (scope.workIds?.length) {
      const ids = scope.workIds.map(Number).filter(Boolean);
      employeeIds = ids.length ? querySync(`SELECT DISTINCT employee_id FROM work WHERE work_id IN (${ids.map(() => '?').join(',')})`, ids).map((r) => r.employee_id) : [];
    }
    employeeIds = [...new Set([...employeeIds, ...(scope.employeeIds || [])].filter(Boolean))];
    if (employeeIds.length) before = workRows(querySync, `w.employee_id IN (${employeeIds.map(() => '?').join(',')})`, employeeIds);
  } catch (err) { console.error('LCA review snapshot failed', err); }
  return {
    async done(userId) {
      if (!employeeIds.length) return [];
      try {
        const events = compareAndRecord(querySync, before, employeeIds, userId);
        await sendEvents(events);
        return events;
      } catch (err) { console.error('LCA review check failed', err); return []; }
    },
  };
}

/** Express helper: snapshot now, check after a successful response */
function reviewAfterResponse(req, res, scope) {
  const t = trackWorkChanges(scope);
  res.on('finish', () => { if (res.statusCode < 300) t.done(req.user?.user_id); });
}

module.exports = { trackWorkChanges, reviewAfterResponse, classify, diff, isH1B, OPEN_STATUSES };
