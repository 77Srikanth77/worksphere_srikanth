const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query } = require('../db');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => cb(null, /\.(pdf|docx?|png|jpe?g)$/i.test(file.originalname)),
});

router.get('/', authorize('HR', 'LEGAL', 'CEO', 'MARKETING'), asyncHandler(async (req, res) => {
  if (!req.query.employee_id) return res.status(400).json({ error: 'employee_id is required.' });
  res.json(await query('SELECT * FROM documents WHERE employee_id = ? ORDER BY uploaded_at DESC', [req.query.employee_id]));
}));

// multipart/form-data: file, employee_id, doc_type
router.post('/', authorize('HR', 'LEGAL', 'MARKETING'), upload.single('file'), asyncHandler(async (req, res) => {
  const { employee_id, doc_type } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Attach a PDF, Word or image file (max 10 MB).' });
  if (!employee_id || !doc_type) return res.status(400).json({ error: 'Employee and document type are required.' });
  const result = await query(
    'INSERT INTO documents (employee_id, doc_type, file_name, file_path, uploaded_by) VALUES (?, ?, ?, ?, ?)',
    [employee_id, doc_type, req.file.originalname, req.file.filename, req.user.user_id],
  );
  res.status(201).json({ document_id: result.insertId, employee_id, doc_type, file_name: req.file.originalname });
}));

router.get('/:id/download', authorize('HR', 'LEGAL', 'CEO', 'MARKETING'), asyncHandler(async (req, res) => {
  const [doc] = await query('SELECT * FROM documents WHERE document_id = ?', [req.params.id]);
  const file = doc && path.join(UPLOAD_DIR, path.basename(doc.file_path));
  if (!doc || !fs.existsSync(file)) return res.status(404).json({ error: 'File not found.' });
  res.download(file, doc.file_name);
}));

module.exports = router;
