const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query } = require('../db');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');
const { localDate } = require('../utils/followups');
const { DOC_TYPES, requiredFor } = require('../utils/documentTypes');
const { notify, userIdsForEmployees } = require('../utils/notify');

/**
 * Employee document vault.
 *  HR / LEGAL      upload (auto-verified), review employee uploads, edit details. HR can delete.
 *  CEO             read everything
 *  MARKETING       résumés only (read + upload)
 *  EMPLOYEE        their own documents: view, upload (pending HR review), remove while pending
 * Files live in api-node/uploads/documents/ and are only served through /download with these checks.
 */
const FULL_READ = ['HR', 'LEGAL', 'CEO', 'ADMIN'];
const REVIEWERS = ['HR', 'LEGAL', 'ADMIN'];
const EXPIRING_DAYS = 90;

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'documents');
const LEGACY_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${file.originalname.replace(/[^\w.-]/g, '_')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(pdf|png|jpe?g|heic|docx?)$/i.test(file.originalname)),
});
const uploadOne = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10 MB.' : 'Upload failed.' });
  next();
});
const fileOf = (doc) => {
  const p = path.join(UPLOAD_DIR, path.basename(doc.file_path));
  return fs.existsSync(p) ? p : path.join(LEGACY_DIR, path.basename(doc.file_path));
};
const removeFile = (doc) => fs.rm(fileOf(doc), { force: true }, () => {});
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const daysUntil = (d) => Math.round((new Date(`${d}T00:00:00`) - new Date(`${localDate()}T00:00:00`)) / 86400000);

const DOC_SQL = `
  SELECT d.*, ub.full_name AS uploaded_by_name, rb.full_name AS reviewed_by_name
  FROM documents d
  LEFT JOIN users ub ON ub.user_id = d.uploaded_by
  LEFT JOIN users rb ON rb.user_id = d.reviewed_by`;
const decorate = (d) => ({
  ...d,
  type_label: DOC_TYPES[d.doc_type]?.label || d.doc_type,
  days_left: d.expiry_date ? daysUntil(d.expiry_date) : null,
});

/** Required-document checklist + every document on file for one employee */
async function checklist(employeeId) {
  const [[emp], [visa], docs] = await Promise.all([
    query("SELECT employee_id, first_name || ' ' || last_name AS employee_name FROM emp WHERE employee_id = ?", [employeeId]),
    query('SELECT visa_type FROM immigration WHERE employee_id = ? ORDER BY expiry_date DESC LIMIT 1', [employeeId]),
    query(`${DOC_SQL} WHERE d.employee_id = ? ORDER BY d.uploaded_at DESC, d.document_id DESC`, [employeeId]),
  ]);
  if (!emp) return null;
  const all = docs.map(decorate);
  const required = requiredFor(visa?.visa_type);
  const items = required.map((type) => {
    const ofType = all.filter((d) => d.doc_type === type);
    const current = ofType.find((d) => d.status !== 'REJECTED') || ofType[0] || null;
    let state = 'MISSING';
    if (current) {
      if (current.status === 'REJECTED') state = 'REJECTED';
      else if (current.status === 'PENDING') state = 'PENDING';
      else if (current.days_left != null && current.days_left < 0) state = 'EXPIRED';
      else if (current.days_left != null && current.days_left <= EXPIRING_DAYS) state = 'EXPIRING';
      else state = 'VERIFIED';
    }
    return { doc_type: type, label: DOC_TYPES[type].label, category: DOC_TYPES[type].category, expires: DOC_TYPES[type].expires, state, current, versions: ofType.length };
  });
  const count = (st) => items.filter((i) => i.state === st).length;
  return {
    ...emp,
    visa_type: visa?.visa_type || null,
    items,
    documents: all,
    summary: {
      required: items.length,
      complete: items.filter((i) => ['VERIFIED', 'EXPIRING'].includes(i.state)).length,
      missing: count('MISSING'), pending: count('PENDING'), rejected: count('REJECTED'),
      expired: count('EXPIRED'), expiring: count('EXPIRING'),
    },
  };
}

/** Validates the details sent with an upload or edit. Returns an error message or null. */
function checkDetails(type, b) {
  if (!DOC_TYPES[type]) return 'Choose a document type.';
  if (b.issue_date && !isDate(b.issue_date)) return 'Issue date is not a valid date.';
  if (b.expiry_date && !isDate(b.expiry_date)) return 'Expiry date is not a valid date.';
  if (DOC_TYPES[type].expires && !b.expiry_date) return `Enter the expiry date of the ${DOC_TYPES[type].label}.`;
  if (b.issue_date && b.expiry_date && b.expiry_date < b.issue_date) return 'Expiry date is before the issue date.';
  if (type === 'SSN_CARD' && b.doc_number && !/^\d{4}$/.test(b.doc_number)) return 'For the SSN card store only the last 4 digits.';
  return null;
}

// Document types, for the upload form
router.get('/types', (req, res) => res.json(Object.entries(DOC_TYPES).map(([key, t]) => ({ key, ...t }))));

// ---------------------------------------------------------------- employee self-service

router.get('/mine', authorize('EMPLOYEE'), asyncHandler(async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'Your login is not linked to an employee record.' });
  res.json(await checklist(req.user.employee_id));
}));

router.post('/mine', authorize('EMPLOYEE'), uploadOne, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const err = !req.user.employee_id ? 'Your login is not linked to an employee record.'
    : !req.file ? 'Attach a PDF, photo or Word file (max 10 MB).' : checkDetails(b.doc_type, b);
  if (err) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return res.status(400).json({ error: err });
  }
  const r = await query(`INSERT INTO documents (employee_id, doc_type, doc_number, issue_date, expiry_date, file_name, file_path,
      content_type, size_bytes, status, notes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
  [req.user.employee_id, b.doc_type, b.doc_number || null, b.issue_date || null, b.expiry_date || null, req.file.originalname,
    req.file.filename, req.file.mimetype, req.file.size, b.notes || null, req.user.user_id]);
  res.status(201).json({ document_id: r.insertId, status: 'PENDING' });
}));

// ---------------------------------------------------------------- HR / Legal / CEO

// Compliance overview: every employee's checklist summary
router.get('/compliance', authorize(...FULL_READ), asyncHandler(async (req, res) => {
  const emps = await query('SELECT employee_id FROM emp ORDER BY employee_id');
  const lists = await Promise.all(emps.map((e) => checklist(e.employee_id)));
  res.json(lists.map(({ documents, ...rest }) => ({ ...rest, items: rest.items.map(({ current, ...i }) => ({
    ...i, document_id: current?.document_id || null, expiry_date: current?.expiry_date || null, days_left: current?.days_left ?? null,
  })) })));
}));

// Documents waiting for review, and documents expiring soon, across all employees
router.get('/queue', authorize(...FULL_READ), asyncHandler(async (req, res) => {
  const rows = await query(`${DOC_SQL.replace('FROM documents d', ", e.first_name || ' ' || e.last_name AS employee_name FROM documents d JOIN emp e ON e.employee_id = d.employee_id")}
    WHERE d.status = 'PENDING' OR (d.status = 'VERIFIED' AND d.expiry_date IS NOT NULL AND d.expiry_date <= date('now','localtime','+${EXPIRING_DAYS} days'))
    ORDER BY d.status = 'PENDING' DESC, d.expiry_date`);
  // Expiring list: only the newest document of each type per employee (a renewed passport replaces the old one)
  const newest = await query(`SELECT employee_id, doc_type, MAX(uploaded_at) AS latest FROM documents WHERE status != 'REJECTED' GROUP BY employee_id, doc_type`);
  const latest = Object.fromEntries(newest.map((n) => [`${n.employee_id}:${n.doc_type}`, n.latest]));
  res.json(rows.map(decorate).filter((d) => d.status === 'PENDING' || latest[`${d.employee_id}:${d.doc_type}`] === d.uploaded_at));
}));

router.get('/checklist/:employeeId', authorize(...FULL_READ), asyncHandler(async (req, res) => {
  const c = await checklist(req.params.employeeId);
  if (!c) return res.status(404).json({ error: 'Employee not found.' });
  res.json(c);
}));

// Marketing gets résumés only; HR / Legal / CEO get everything
router.get('/', authorize(...FULL_READ, 'MARKETING'), asyncHandler(async (req, res) => {
  if (!req.query.employee_id) return res.status(400).json({ error: 'employee_id is required.' });
  const onlyResume = req.user.role === 'MARKETING';
  const rows = await query(`${DOC_SQL} WHERE d.employee_id = ? ${onlyResume ? "AND d.doc_type = 'RESUME' AND d.status != 'REJECTED'" : ''}
    ORDER BY d.uploaded_at DESC`, [req.query.employee_id]);
  res.json(rows.map(decorate));
}));

// multipart/form-data: file, employee_id, doc_type, doc_number, issue_date, expiry_date, notes
router.post('/', authorize(...REVIEWERS, 'MARKETING'), uploadOne, asyncHandler(async (req, res) => {
  const b = req.body || {};
  let err = !req.file ? 'Attach a PDF, photo or Word file (max 10 MB).' : !b.employee_id ? 'Choose the employee.' : checkDetails(b.doc_type, b);
  if (!err && req.user.role === 'MARKETING' && b.doc_type !== 'RESUME') err = 'Marketing can only upload résumés.';
  if (!err) {
    const [e] = await query('SELECT 1 FROM emp WHERE employee_id = ?', [b.employee_id]);
    if (!e) err = 'Employee not found.';
  }
  if (err) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return res.status(400).json({ error: err });
  }
  // Uploaded by HR / Legal / Marketing = already checked, so verified straight away
  const r = await query(`INSERT INTO documents (employee_id, doc_type, doc_number, issue_date, expiry_date, file_name, file_path,
      content_type, size_bytes, status, reviewed_by, reviewed_at, notes, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, datetime('now','localtime'), ?, ?)`,
  [b.employee_id, b.doc_type, b.doc_number || null, b.issue_date || null, b.expiry_date || null, req.file.originalname, req.file.filename,
    req.file.mimetype, req.file.size, req.user.user_id, b.notes || null, req.user.user_id]);
  res.status(201).json({ document_id: r.insertId, status: 'VERIFIED' });
}));

// Verify or reject an employee upload (a reason is required to reject)
router.patch('/:id/review', authorize(...REVIEWERS), asyncHandler(async (req, res) => {
  const { status, note } = req.body || {};
  if (!['VERIFIED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Choose verify or reject.' });
  if (status === 'REJECTED' && !String(note || '').trim()) return res.status(400).json({ error: 'Tell the employee why it was rejected.' });
  const r = await query(`UPDATE documents SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = datetime('now','localtime')
    WHERE document_id = ?`, [status, status === 'REJECTED' ? note.trim() : (note || null), req.user.user_id, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Document not found.' });
  if (status === 'REJECTED') {
    const [doc] = await query('SELECT employee_id, doc_type FROM documents WHERE document_id = ?', [req.params.id]);
    await notify(await userIdsForEmployees(doc.employee_id), {
      type: 'DOCUMENT_REJECTED', title: `Please upload your ${DOC_TYPES[doc.doc_type]?.label || 'document'} again`, body: note.trim(), link: '/profile',
    });
  }
  res.json({ document_id: Number(req.params.id), status });
}));

// Correct the number / dates / notes
router.patch('/:id', authorize(...REVIEWERS), asyncHandler(async (req, res) => {
  const [doc] = await query('SELECT * FROM documents WHERE document_id = ?', [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  const b = { ...doc, ...req.body };
  const err = checkDetails(doc.doc_type, b);
  if (err) return res.status(400).json({ error: err });
  await query('UPDATE documents SET doc_number = ?, issue_date = ?, expiry_date = ?, notes = ? WHERE document_id = ?',
    [b.doc_number || null, b.issue_date || null, b.expiry_date || null, b.notes || null, doc.document_id]);
  // A corrected expiry date should be able to trigger fresh reminders
  if (b.expiry_date !== doc.expiry_date) await query('DELETE FROM document_alerts WHERE document_id = ?', [doc.document_id]);
  res.json({ document_id: doc.document_id });
}));

/** Loads a document if the caller may access it */
async function accessible(req, id) {
  const [doc] = await query('SELECT * FROM documents WHERE document_id = ?', [id]);
  if (!doc) return null;
  const { role } = req.user;
  if (FULL_READ.includes(role)) return doc;
  if (role === 'MARKETING') return doc.doc_type === 'RESUME' ? doc : null;
  if (role === 'EMPLOYEE') return doc.employee_id === req.user.employee_id ? doc : null;
  return null;
}

router.get('/:id/download', asyncHandler(async (req, res) => {
  const doc = await accessible(req, req.params.id);
  if (!doc || !fs.existsSync(fileOf(doc))) return res.status(404).json({ error: 'File not found.' });
  res.download(fileOf(doc), doc.file_name);
}));

// HR deletes anything; an employee can withdraw their own upload while it is still pending
router.delete('/:id', authorize('HR', 'EMPLOYEE'), asyncHandler(async (req, res) => {
  const doc = await accessible(req, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  if (req.user.role === 'EMPLOYEE' && (doc.status !== 'PENDING' || doc.uploaded_by !== req.user.user_id)) {
    return res.status(403).json({ error: 'Only your own uploads that are still pending review can be removed. Ask HR.' });
  }
  await query('DELETE FROM documents WHERE document_id = ?', [doc.document_id]);
  removeFile(doc);
  res.status(204).end();
}));

module.exports = router;
