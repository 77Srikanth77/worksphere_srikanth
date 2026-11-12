const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { query, transaction } = require('../db');
const { asyncHandler } = require('../utils/helpers');
const { TYPES, readSheet, plan, apply } = require('../utils/importers');
const { syncCases } = require('../utils/capSync');
const { trackWorkChanges } = require('../utils/lcaReview');

/**
 * Excel imports for HR and Legal.
 *   GET  /imports/types              import types this role may use, with their columns
 *   GET  /imports/:type/template     .xlsx template (Data sheet + Instructions sheet)
 *   POST /imports/:type/preview      upload .xlsx/.csv -> every row checked, nothing saved
 *   POST /imports/:type/commit       { file_name, rows: [{row, values}] } -> re-checked, saved in one transaction
 *   GET  /imports/history            recent imports
 */
const router = express.Router();
const MAX_ROWS = 2000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(xlsx|csv)$/i.test(file.originalname)),
});
const mayUse = (role, type) => TYPES[type] && (role === 'ADMIN' || TYPES[type].roles.includes(role));

router.use((req, res, next) => {
  if (!['HR', 'LEGAL', 'ADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this page.' });
  next();
});
router.param('type', (req, res, next, type) => {
  if (!mayUse(req.user.role, type)) return res.status(403).json({ error: 'Your team cannot import this kind of data.' });
  next();
});

router.get('/types', (req, res) => {
  res.json(Object.entries(TYPES).filter(([k]) => mayUse(req.user.role, k)).map(([key, t]) => ({
    key, label: t.label, description: t.description, roles: t.roles, keys: t.keys,
    columns: t.columns.map(({ key: k, label, required, type, values, help, example }) => ({ key: k, label, required, type, values, help, example })),
  })));
});

router.get('/:type/template', asyncHandler(async (req, res) => {
  const t = TYPES[req.params.type];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WorkSphere';
  const data = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  data.columns = t.columns.map((c) => ({ header: c.required ? `${c.label} *` : c.label, key: c.key, width: Math.max(14, c.label.length + 4) }));
  const head = data.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5BD3' } };
  t.columns.forEach((c, i) => {
    const letter = data.getColumn(i + 1).letter;
    if (c.type === 'date') data.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
    if (['zip', 'text'].includes(c.type) && /zip|phone|employee_id/.test(c.key)) data.getColumn(i + 1).numFmt = '@'; // keep leading zeros
    if (c.type === 'enum') {
      for (let r = 2; r <= 500; r += 1) {
        data.getCell(`${letter}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${c.values.join(',')}"`] };
      }
    }
    head.getCell(i + 1).note = [t.keys.includes(c.key) ? 'Required (identifies the record).' : c.required ? 'Required for new records.' : 'Optional.', c.help, c.example ? `Example: ${c.example}` : null].filter(Boolean).join(' ');
  });

  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 28 }, { width: 12 }, { width: 22 }, { width: 70 }];
  help.addRow([`WorkSphere import: ${t.label}`]).font = { bold: true, size: 14 };
  help.addRow([t.description]);
  help.addRow(['Fill the "Data" sheet: one row per record, starting on row 2. Column order does not matter.']);
  help.addRow(['When a row matches an existing record it is updated; empty cells leave existing values unchanged.']);
  help.addRow(['Dates: YYYY-MM-DD (or MM/DD/YYYY, or an Excel date). You will see a preview before anything is saved.']);
  help.addRow([]);
  const hr = help.addRow(['Column', 'Required', 'Format', 'Notes / example']);
  hr.font = { bold: true };
  const fmt = { date: 'Date', email: 'Email', enum: 'One of the list', state: '2-letter state', zip: '5-digit ZIP', money: 'Amount', text: 'Text', yesno: 'Yes / No', capyear: 'Season, e.g. 2026-27' };
  t.columns.forEach((c) => help.addRow([c.label, t.keys.includes(c.key) ? 'Always' : c.required ? 'New records' : '', c.type === 'enum' ? c.values.join(' / ') : fmt[c.type], [c.help, c.example ? `e.g. ${c.example}` : ''].filter(Boolean).join('. ')]));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="worksphere-${req.params.type.toLowerCase().replace('_', '-')}-template.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

router.post('/:type/preview', (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB.' : 'Upload failed.' });
  next();
}), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an Excel (.xlsx) or CSV file.' });
  const wb = new ExcelJS.Workbook();
  try {
    if (/\.csv$/i.test(req.file.originalname)) {
      const { Readable } = require('stream');
      await wb.csv.read(Readable.from(req.file.buffer.toString('utf8')));
    } else {
      await wb.xlsx.load(req.file.buffer);
    }
  } catch {
    return res.status(400).json({ error: 'Could not read this file. Save it as .xlsx (Excel Workbook) or .csv and try again.' });
  }
  const sheet = readSheet(wb, req.params.type);
  if (sheet.error) return res.status(400).json({ error: sheet.error });
  if (sheet.missingRequired.length) {
    return res.status(400).json({ error: `Missing required column(s): ${sheet.missingRequired.join(', ')}.`, found: sheet.mapping.map((m) => m.header) });
  }
  if (!sheet.rows.length) return res.status(400).json({ error: 'The sheet has a header row but no data rows.' });
  if (sheet.rows.length > MAX_ROWS) return res.status(400).json({ error: `Too many rows (${sheet.rows.length}). Import at most ${MAX_ROWS} at a time.` });
  const result = await plan(req.params.type, sheet.rows);
  res.json({
    type: req.params.type, file_name: req.file.originalname,
    columns: sheet.mapping.map(({ header, key, label }) => ({ header, key, label })), ignored_columns: sheet.ignored,
    ...result,
  });
}));

router.post('/:type/commit', asyncHandler(async (req, res) => {
  const { rows = [], file_name: fileName = null, skip_errors: skipErrors = false } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Import at most ${MAX_ROWS} rows at a time.` });
  // Check everything again on the server: what the browser sends is never trusted
  const result = await plan(req.params.type, rows.map((r) => ({ row: r.row, values: r.values || {} })));
  if (result.summary.errors && !skipErrors) {
    return res.status(400).json({ error: `${result.summary.errors} row(s) have errors. Fix them or choose to skip them.`, ...result });
  }
  const done = result.rows.filter((r) => r.action !== 'ERROR');
  // Assignment imports: H-1B changes open LCA reviews just like edits on screen
  const tracker = ['WORK', 'WORK_DETAILS'].includes(req.params.type) ? trackWorkChanges({ employeeIds: done.map((r) => r.values.employee_id) }) : null;
  const id = transaction((q) => {
    apply(q, req.params.type, result.rows);
    if (req.params.type === 'H1B_CAP') { // cap cases -> employee records, automatically
      [...new Set(done.map((r) => r.values.cap_year))].forEach((capYear) => syncCases(q, { capYear }));
    }
    return q(`INSERT INTO import_log (import_type, file_name, created, updated, skipped, details, imported_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.type, fileName, result.summary.create, result.summary.update, result.summary.errors,
        JSON.stringify(done.map((r) => ({ row: r.row, action: r.action, key: r.key }))), req.user.user_id]).insertId;
  });
  if (tracker) await tracker.done(req.user.user_id);
  res.status(201).json({ import_id: id, created: result.summary.create, updated: result.summary.update, skipped: result.summary.errors });
}));

router.get('/history', asyncHandler(async (req, res) => {
  const allowed = Object.keys(TYPES).filter((k) => mayUse(req.user.role, k));
  res.json(await query(`SELECT l.import_id, l.import_type, l.file_name, l.created, l.updated, l.skipped, l.imported_at, u.full_name AS imported_by_name
    FROM import_log l LEFT JOIN users u ON u.user_id = l.imported_by
    WHERE l.import_type IN (${allowed.map(() => '?').join(',')}) ORDER BY l.imported_at DESC LIMIT 25`, allowed));
}));

module.exports = router;
