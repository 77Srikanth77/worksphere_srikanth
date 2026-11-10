const express = require('express');
const { query } = require('../db');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

// Alerts are created by the FastAPI scheduler; this API only reads them
// and lets Legal / management mark them as read.
router.get('/', authorize('CEO', 'LEGAL', 'HR'), asyncHandler(async (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  const rows = await query(`
    SELECT a.*, e.first_name || ' ' || e.last_name AS employee_name, i.visa_type, i.case_status,
           CAST(julianday(a.expiry_date) - julianday(date('now','localtime')) AS INTEGER) AS days_left
    FROM alerts a
    JOIN emp e ON e.employee_id = a.employee_id
    JOIN immigration i ON i.visa_id = a.visa_id
    ${unreadOnly ? 'WHERE a.is_read = FALSE' : ''}
    ORDER BY a.is_read, a.expiry_date`);
  res.json(rows);
}));

router.patch('/:id/read', authorize('CEO', 'LEGAL', 'HR'), asyncHandler(async (req, res) => {
  const result = await query('UPDATE alerts SET is_read = TRUE WHERE alert_id = ?', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Alert not found.' });
  res.json({ alert_id: Number(req.params.id), is_read: true });
}));

module.exports = router;
