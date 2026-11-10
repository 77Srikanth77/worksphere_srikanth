const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { query, transaction } = require('../db');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');
const { localDate } = require('../utils/followups');
const { notify, userIdsForEmployees } = require('../utils/notify');

/**
 * Weekly timesheets. The employee enters hours per day for each project assignment and submits;
 * HR approves or rejects. Approved hours feed invoices (Finance) and the payroll hours report.
 *   DRAFT / REJECTED  -> employee can edit and submit
 *   SUBMITTED         -> waiting for HR; employee can recall it to DRAFT
 *   APPROVED          -> locked; HR can send it back only if no invoice covers that week
 */
const REVIEW = ['HR', 'CEO'];
const APPROVE = ['HR'];
const MISSING_WEEKS = 8;

const router = express.Router();

// Client-approved timesheet copies: PDF, image, Word or Excel, max 10 MB, stored in api-node/uploads/timesheets/
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'timesheets');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED = /\.(pdf|png|jpe?g|docx?|xlsx?|csv)$/i;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${file.originalname.replace(/[^\w.-]/g, '_')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.test(file.originalname)),
});
/** Runs multer and turns its errors (e.g. file too large) into a 400 */
const uploadOne = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10 MB.' : 'Upload failed.' });
  next();
});

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + n);
  return localDate(x);
};
/** Monday of the week containing d */
const mondayOf = (d = localDate()) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return localDate(x);
};
/** 'YYYY-MM-DD HH:MM:SS' local time */
const nowStamp = () => `${localDate()} ${new Date().toTimeString().slice(0, 8)}`;
const weekDays = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** Project assignments of an employee that overlap the week */
function assignmentsInWeek(employeeId, monday) {
  return query(`
    SELECT w.work_id, w.project_name, w.job_title, w.start_date, w.end_date, w.client_timesheet_required, c.client_name, v.vendor_name
    FROM work w LEFT JOIN clients c ON c.client_id = w.client_id LEFT JOIN vendors v ON v.vendor_id = w.vendor_id
    WHERE w.employee_id = ? AND w.status = 'PROJECT' AND w.start_date <= ? AND (w.end_date IS NULL OR w.end_date >= ?)
    ORDER BY w.start_date`, [employeeId, addDays(monday, 6), monday]);
}

const TS_SQL = `
  SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, w.project_name, w.start_date AS work_start, w.end_date AS work_end,
         c.client_name, v.vendor_name, u.full_name AS reviewed_by_name, w.client_timesheet_required,
         COALESCE((SELECT SUM(x.hours) FROM timesheet_entries x WHERE x.timesheet_id = t.timesheet_id), 0) AS total_hours,
         (SELECT COUNT(*) FROM timesheet_attachments a WHERE a.timesheet_id = t.timesheet_id) AS attachment_count
  FROM timesheets t
  JOIN emp e ON e.employee_id = t.employee_id
  JOIN work w ON w.work_id = t.work_id
  LEFT JOIN clients c ON c.client_id = w.client_id
  LEFT JOIN vendors v ON v.vendor_id = w.vendor_id
  LEFT JOIN users u ON u.user_id = t.reviewed_by`;

async function withEntries(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.timesheet_id);
  const marks = ids.map(() => '?').join(',');
  const [entries, files] = await Promise.all([
    query(`SELECT timesheet_id, work_date, hours FROM timesheet_entries WHERE timesheet_id IN (${marks}) ORDER BY work_date`, ids),
    query(`SELECT a.attachment_id, a.timesheet_id, a.file_name, a.size_bytes, a.uploaded_at, a.uploaded_by, u.full_name AS uploaded_by_name
           FROM timesheet_attachments a LEFT JOIN users u ON u.user_id = a.uploaded_by
           WHERE a.timesheet_id IN (${marks}) ORDER BY a.uploaded_at`, ids),
  ]);
  const by = {};
  entries.forEach((e) => { (by[e.timesheet_id] ||= {})[e.work_date] = e.hours; });
  const att = {};
  files.forEach((f) => { (att[f.timesheet_id] ||= []).push(f); });
  return rows.map((r) => ({ ...r, entries: by[r.timesheet_id] || {}, attachments: att[r.timesheet_id] || [] }));
}

/**
 * Completed weeks (last MISSING_WEEKS) where an employee on a project has no submitted/approved timesheet.
 * Draft and rejected weeks count as missing.
 */
async function missingWeeks(employeeId = null) {
  const thisMonday = mondayOf();
  const firstMonday = addDays(thisMonday, -7 * MISSING_WEEKS);
  const work = await query(`
    SELECT w.work_id, w.employee_id, e.first_name || ' ' || e.last_name AS employee_name, w.start_date, w.end_date,
           c.client_name, v.vendor_name
    FROM work w JOIN emp e ON e.employee_id = w.employee_id
    LEFT JOIN clients c ON c.client_id = w.client_id LEFT JOIN vendors v ON v.vendor_id = w.vendor_id
    WHERE w.status = 'PROJECT' AND (w.end_date IS NULL OR w.end_date >= ?) AND w.start_date < ?
    ${employeeId ? 'AND w.employee_id = ?' : ''}`, employeeId ? [firstMonday, thisMonday, employeeId] : [firstMonday, thisMonday]);
  if (!work.length) return [];
  const done = await query(`SELECT work_id, week_start, status FROM timesheets WHERE week_start >= ?
    AND work_id IN (${work.map(() => '?').join(',')})`, [firstMonday, ...work.map((w) => w.work_id)]);
  const state = Object.fromEntries(done.map((d) => [`${d.work_id}:${d.week_start}`, d.status]));
  const out = [];
  for (const w of work) {
    for (let m = firstMonday; m < thisMonday; m = addDays(m, 7)) {
      const sunday = addDays(m, 6);
      if (w.start_date > sunday || (w.end_date && w.end_date < m)) continue;
      const st = state[`${w.work_id}:${m}`];
      if (st === 'SUBMITTED' || st === 'APPROVED') continue;
      out.push({ ...w, week_start: m, status: st || 'NOT_STARTED' });
    }
  }
  return out.sort((a, b) => a.week_start.localeCompare(b.week_start) || a.employee_name.localeCompare(b.employee_name));
}

// ---------------------------------------------------------------- employee

// One week for the signed-in employee: assignments, their timesheets, recent weeks, missing weeks
router.get('/mine', authorize('EMPLOYEE'), asyncHandler(async (req, res) => {
  const emp = req.user.employee_id;
  if (!emp) return res.status(400).json({ error: 'Your login is not linked to an employee record.' });
  const monday = mondayOf(isDate(req.query.week) ? req.query.week : localDate());
  const [assignments, sheets, recent, missing] = await Promise.all([
    assignmentsInWeek(emp, monday),
    query(`${TS_SQL} WHERE t.employee_id = ? AND t.week_start = ?`, [emp, monday]).then(withEntries),
    query(`${TS_SQL} WHERE t.employee_id = ? ORDER BY t.week_start DESC LIMIT 16`, [emp]),
    missingWeeks(emp),
  ]);
  res.json({ week_start: monday, days: weekDays(monday), today: localDate(), assignments, timesheets: sheets, recent, missing });
}));

// Save (and optionally submit) the employee's week for one assignment
router.put('/mine', authorize('EMPLOYEE'), asyncHandler(async (req, res) => {
  const emp = req.user.employee_id;
  const b = req.body || {};
  if (!emp) return res.status(400).json({ error: 'Your login is not linked to an employee record.' });
  if (!isDate(b.week_start) || mondayOf(b.week_start) !== b.week_start) return res.status(400).json({ error: 'Week must start on a Monday.' });
  const [w] = await query("SELECT * FROM work WHERE work_id = ? AND employee_id = ? AND status = 'PROJECT'", [b.work_id, emp]);
  if (!w) return res.status(400).json({ error: 'Choose one of your project assignments.' });

  const today = localDate();
  const days = weekDays(b.week_start);
  const entries = [];
  for (const [date, raw] of Object.entries(b.entries || {})) {
    if (raw === '' || raw == null) continue;
    const hours = Number(raw);
    if (!days.includes(date)) return res.status(400).json({ error: `${date} is not in this week.` });
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) return res.status(400).json({ error: `Hours for ${date} must be between 0 and 24.` });
    if (hours > 0 && date > today) return res.status(400).json({ error: `You can't enter hours for a future day (${date}).` });
    if (hours > 0 && (date < w.start_date || (w.end_date && date > w.end_date))) {
      return res.status(400).json({ error: `${date} is outside this assignment (${w.start_date} – ${w.end_date || 'present'}).` });
    }
    entries.push([date, Math.round(hours * 100) / 100]);
  }
  const total = entries.reduce((t, [, h]) => t + h, 0);
  if (b.submit && total === 0 && !String(b.employee_note || '').trim()) {
    return res.status(400).json({ error: 'No hours entered. Add a note (e.g. vacation) to submit a zero-hour week.' });
  }

  const [existing] = await query('SELECT * FROM timesheets WHERE work_id = ? AND week_start = ?', [w.work_id, b.week_start]);
  if (existing && !['DRAFT', 'REJECTED'].includes(existing.status)) {
    return res.status(409).json({ error: existing.status === 'APPROVED' ? 'This week is already approved.' : 'This week is submitted. Recall it first to make changes.' });
  }
  if (b.submit && w.client_timesheet_required) {
    const [{ n }] = existing
      ? await query('SELECT COUNT(*) AS n FROM timesheet_attachments WHERE timesheet_id = ?', [existing.timesheet_id])
      : [{ n: 0 }];
    if (!n) return res.status(400).json({ error: 'This client requires a client-approved timesheet. Attach it before submitting.' });
  }
  const status = b.submit ? 'SUBMITTED' : (existing?.status === 'REJECTED' ? 'REJECTED' : 'DRAFT');
  const id = transaction((q) => {
    let tid = existing?.timesheet_id;
    if (tid) {
      q(`UPDATE timesheets SET status = ?, employee_note = ?, submitted_at = ?, updated_at = datetime('now','localtime')
         WHERE timesheet_id = ?`, [status, b.employee_note || null, b.submit ? nowStamp() : null, tid]);
      q('DELETE FROM timesheet_entries WHERE timesheet_id = ?', [tid]);
    } else {
      tid = q(`INSERT INTO timesheets (employee_id, work_id, week_start, status, employee_note, submitted_at)
               VALUES (?, ?, ?, ?, ?, ?)`, [emp, w.work_id, b.week_start, status, b.employee_note || null,
        b.submit ? nowStamp() : null]).insertId;
    }
    entries.forEach(([date, hours]) => q('INSERT INTO timesheet_entries (timesheet_id, work_date, hours) VALUES (?, ?, ?)', [tid, date, hours]));
    return tid;
  });
  const [saved] = await query(`${TS_SQL} WHERE t.timesheet_id = ?`, [id]).then(withEntries);
  res.json(saved);
}));

// Employee pulls a submitted (not yet approved) week back to draft
router.post('/:id/recall', authorize('EMPLOYEE'), asyncHandler(async (req, res) => {
  const r = await query(`UPDATE timesheets SET status = 'DRAFT', submitted_at = NULL, updated_at = datetime('now','localtime')
    WHERE timesheet_id = ? AND employee_id = ? AND status = 'SUBMITTED'`, [req.params.id, req.user.employee_id]);
  if (!r.affectedRows) return res.status(409).json({ error: 'Only a submitted week that is not yet approved can be recalled.' });
  res.json({ timesheet_id: Number(req.params.id), status: 'DRAFT' });
}));

// ---------------------------------------------------------------- HR / CEO

// ?status= &employee_id= &from= &to= (week_start range)
router.get('/', authorize(...REVIEW), asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
  if (req.query.employee_id) { where.push('t.employee_id = ?'); params.push(req.query.employee_id); }
  if (isDate(req.query.from)) { where.push('t.week_start >= ?'); params.push(mondayOf(req.query.from)); }
  if (isDate(req.query.to)) { where.push('t.week_start <= ?'); params.push(req.query.to); }
  const rows = await query(`${TS_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE t.status WHEN 'SUBMITTED' THEN 0 WHEN 'REJECTED' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END, t.week_start DESC, employee_name`, params);
  res.json(await withEntries(rows));
}));

router.get('/missing', authorize(...REVIEW), asyncHandler(async (req, res) => res.json(await missingWeeks())));

router.get('/summary', authorize(...REVIEW), asyncHandler(async (req, res) => {
  const monthStart = `${localDate().slice(0, 7)}-01`;
  const [[counts], [hours], missing] = await Promise.all([
    query(`SELECT SUM(status = 'SUBMITTED') AS pending, SUM(status = 'REJECTED') AS rejected FROM timesheets`),
    query(`SELECT COALESCE(SUM(x.hours), 0) AS approved_hours_month FROM timesheet_entries x
           JOIN timesheets t ON t.timesheet_id = x.timesheet_id WHERE t.status = 'APPROVED' AND x.work_date >= ?`, [monthStart]),
    missingWeeks(),
  ]);
  res.json({ pending: counts.pending || 0, rejected: counts.rejected || 0, missing: missing.length,
    approved_hours_month: hours.approved_hours_month, month_start: monthStart });
}));

// Approved / pending hours per assignment between two dates: payroll report and invoice pre-fill.
// ?from= &to= [&work_id=]
router.get('/hours', authorize(...REVIEW), asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to) || to < from) return res.status(400).json({ error: 'Choose a valid date range.' });
  const params = [from, to];
  let extra = '';
  if (req.query.work_id) { extra = 'AND t.work_id = ?'; params.push(req.query.work_id); }
  const rows = await query(`
    SELECT t.work_id, t.employee_id, e.first_name || ' ' || e.last_name AS employee_name, c.client_name, v.vendor_name, w.project_name,
           SUM(CASE WHEN t.status = 'APPROVED' THEN x.hours ELSE 0 END) AS approved_hours,
           SUM(CASE WHEN t.status = 'SUBMITTED' THEN x.hours ELSE 0 END) AS pending_hours,
           SUM(CASE WHEN t.status IN ('DRAFT','REJECTED') THEN x.hours ELSE 0 END) AS unsubmitted_hours,
           COUNT(DISTINCT CASE WHEN t.status = 'APPROVED' AND x.hours > 0 THEN x.work_date END) AS approved_days,
           MAX(w.client_timesheet_required) AS client_timesheet_required,
           COUNT(DISTINCT CASE WHEN w.client_timesheet_required = 1 AND t.status IN ('SUBMITTED','APPROVED')
                 AND NOT EXISTS (SELECT 1 FROM timesheet_attachments a WHERE a.timesheet_id = t.timesheet_id)
                 THEN t.timesheet_id END) AS weeks_missing_client_copy
    FROM timesheet_entries x
    JOIN timesheets t ON t.timesheet_id = x.timesheet_id
    JOIN emp e ON e.employee_id = t.employee_id
    JOIN work w ON w.work_id = t.work_id
    LEFT JOIN clients c ON c.client_id = w.client_id
    LEFT JOIN vendors v ON v.vendor_id = w.vendor_id
    WHERE x.work_date BETWEEN ? AND ? ${extra}
    GROUP BY t.work_id ORDER BY employee_name`, params);
  res.json(rows);
}));

/** Is any part of this timesheet's week already on a (non-void) invoice? */
async function invoicedWeek(ts) {
  const [inv] = await query(`SELECT invoice_number FROM invoices WHERE work_id = ? AND is_void = 0
    AND period_start <= ? AND period_end >= ?`, [ts.work_id, addDays(ts.week_start, 6), ts.week_start]);
  return inv?.invoice_number || null;
}

router.post('/:id/approve', authorize(...APPROVE), asyncHandler(async (req, res) => {
  const [ts] = await query(`${TS_SQL} WHERE t.timesheet_id = ?`, [req.params.id]);
  if (ts?.client_timesheet_required && !ts.attachment_count) {
    return res.status(409).json({ error: 'This client requires a client-approved timesheet. Attach it (or send the week back) before approving.' });
  }
  const r = await query(`UPDATE timesheets SET status = 'APPROVED', reviewed_by = ?, reviewed_at = datetime('now','localtime'),
    review_note = NULL WHERE timesheet_id = ? AND status = 'SUBMITTED'`, [req.user.user_id, req.params.id]);
  if (!r.affectedRows) return res.status(409).json({ error: 'Only a submitted timesheet can be approved.' });
  res.json({ timesheet_id: Number(req.params.id), status: 'APPROVED' });
}));

// Reject a submitted week, or send back an approved one that hasn't been invoiced. A reason is required.
router.post('/:id/reject', authorize(...APPROVE), asyncHandler(async (req, res) => {
  const note = String(req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'Tell the employee what to fix.' });
  const [ts] = await query('SELECT * FROM timesheets WHERE timesheet_id = ?', [req.params.id]);
  if (!ts || !['SUBMITTED', 'APPROVED'].includes(ts.status)) return res.status(409).json({ error: 'Only a submitted or approved timesheet can be sent back.' });
  if (ts.status === 'APPROVED') {
    const inv = await invoicedWeek(ts);
    if (inv) return res.status(409).json({ error: `This week is already billed on ${inv}. Void that invoice first.` });
  }
  await query(`UPDATE timesheets SET status = 'REJECTED', reviewed_by = ?, reviewed_at = datetime('now','localtime'), review_note = ?
    WHERE timesheet_id = ?`, [req.user.user_id, note, ts.timesheet_id]);
  await notify(await userIdsForEmployees(ts.employee_id), {
    type: 'TIMESHEET_REJECTED', title: `HR sent back your timesheet for the week of ${ts.week_start}`, body: note, link: '/timesheets',
  });
  res.json({ timesheet_id: ts.timesheet_id, status: 'REJECTED' });
}));

// ---------------------------------------------------------------- client-approved copies

/** Loads a timesheet the caller may see: the employee's own, or any for HR / CEO / ADMIN */
async function visibleTimesheet(req, id) {
  const [ts] = await query(`${TS_SQL} WHERE t.timesheet_id = ?`, [id]);
  if (!ts) return null;
  if (['HR', 'CEO', 'ADMIN'].includes(req.user.role)) return ts;
  return req.user.role === 'EMPLOYEE' && ts.employee_id === req.user.employee_id ? ts : null;
}
const removeFile = (stored) => fs.rm(path.join(UPLOAD_DIR, path.basename(stored)), { force: true }, () => {});

// multipart/form-data: file. Employee (own week, until approved) or HR (any week).
router.post('/:id/attachments', authorize('EMPLOYEE', 'HR'), uploadOne, asyncHandler(async (req, res) => {
  const ts = await visibleTimesheet(req, req.params.id);
  if (!ts) {
    if (req.file) removeFile(req.file.filename);
    return res.status(404).json({ error: 'Timesheet not found.' });
  }
  if (req.user.role === 'EMPLOYEE' && ts.status === 'APPROVED') {
    if (req.file) removeFile(req.file.filename);
    return res.status(409).json({ error: 'This week is approved. Ask HR to add the file.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Attach a PDF, image, Word or Excel file (max 10 MB).' });
  const r = await query(`INSERT INTO timesheet_attachments (timesheet_id, file_name, file_path, content_type, size_bytes, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)`, [ts.timesheet_id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.user_id]);
  res.status(201).json({ attachment_id: r.insertId, timesheet_id: ts.timesheet_id, file_name: req.file.originalname, size_bytes: req.file.size });
}));

router.get('/attachments/:aid/download', authorize('EMPLOYEE', 'HR', 'CEO'), asyncHandler(async (req, res) => {
  const [a] = await query('SELECT * FROM timesheet_attachments WHERE attachment_id = ?', [req.params.aid]);
  const ts = a && await visibleTimesheet(req, a.timesheet_id);
  const file = ts && path.join(UPLOAD_DIR, path.basename(a.file_path));
  if (!ts || !fs.existsSync(file)) return res.status(404).json({ error: 'File not found.' });
  res.download(file, a.file_name);
}));

// Employee removes their own file before approval; HR can remove any
router.delete('/attachments/:aid', authorize('EMPLOYEE', 'HR'), asyncHandler(async (req, res) => {
  const [a] = await query('SELECT * FROM timesheet_attachments WHERE attachment_id = ?', [req.params.aid]);
  const ts = a && await visibleTimesheet(req, a.timesheet_id);
  if (!ts) return res.status(404).json({ error: 'File not found.' });
  if (req.user.role === 'EMPLOYEE' && (ts.status === 'APPROVED' || a.uploaded_by !== req.user.user_id)) {
    return res.status(403).json({ error: 'You can only remove files you uploaded, before the week is approved.' });
  }
  await query('DELETE FROM timesheet_attachments WHERE attachment_id = ?', [a.attachment_id]);
  removeFile(a.file_path);
  res.status(204).end();
}));

module.exports = router;
