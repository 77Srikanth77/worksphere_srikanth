const express = require('express');
const { query } = require('../db');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');
const crudRouter = require('../utils/crudRouter');

const READ = ['CEO', 'HR', 'LEGAL'];
const WRITE = ['HR', 'LEGAL'];

const router = express.Router();

// Visa/LCA list sorted by whichever date expires first, with days left.
// ?within=180 limits it to records expiring in the next N days.
router.get('/', authorize(...READ), asyncHandler(async (req, res) => {
  const within = Number(req.query.within) || null;
  const rows = await query(`
    SELECT i.*, e.first_name || ' ' || e.last_name AS employee_name,
           CAST(julianday(i.expiry_date) - julianday(date('now','localtime')) AS INTEGER)     AS days_left,
           CAST(julianday(i.lca_expiry_date) - julianday(date('now','localtime')) AS INTEGER) AS lca_days_left,
           MIN(i.expiry_date, COALESCE(i.lca_expiry_date, i.expiry_date)) AS next_expiry
    FROM immigration i JOIN emp e ON e.employee_id = i.employee_id
    ${within ? `WHERE MIN(i.expiry_date, COALESCE(i.lca_expiry_date, i.expiry_date)) <= date('now', 'localtime', '+' || ? || ' days')` : ''}
    ORDER BY next_expiry`, within ? [within] : []);
  res.json(rows);
}));

router.use(crudRouter({
  table: 'immigration',
  id: 'visa_id',
  columns: ['employee_id', 'visa_type', 'receipt_number', 'start_date', 'expiry_date', 'lca_number',
    'lca_start_date', 'lca_expiry_date', 'case_status', 'notes'],
  required: ['employee_id', 'visa_type', 'expiry_date'],
  readRoles: READ,
  writeRoles: WRITE,
}));

module.exports = router;
