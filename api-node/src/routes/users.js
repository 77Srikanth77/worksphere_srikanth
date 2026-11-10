const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

// Admin-only: manage login accounts
router.get('/', authorize(), asyncHandler(async (req, res) => {
  res.json(await query(`
    SELECT u.user_id, u.email, u.full_name, u.employee_id, u.is_active, r.role_name AS role
    FROM users u JOIN roles r ON r.role_id = u.role_id ORDER BY r.role_name, u.full_name`));
}));

router.post('/', authorize(), asyncHandler(async (req, res) => {
  const { email, password, full_name, role, employee_id } = req.body || {};
  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'Email, password, full name and role are required.' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const [r] = await query('SELECT role_id FROM roles WHERE role_name = ?', [role]);
  if (!r) return res.status(400).json({ error: `Unknown role ${role}.` });
  if (role === 'EMPLOYEE' && !employee_id) {
    return res.status(400).json({ error: 'Employee accounts must be linked to an employee record.' });
  }

  const hash = await bcrypt.hash(password, 10);
  const result = await query(
    'INSERT INTO users (email, password_hash, full_name, role_id, employee_id) VALUES (?, ?, ?, ?, ?)',
    [email.trim().toLowerCase(), hash, full_name, r.role_id, employee_id || null],
  );
  res.status(201).json({ user_id: result.insertId, email, full_name, role, employee_id: employee_id || null });
}));

router.patch('/:id/active', authorize(), asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.user.user_id && !req.body?.is_active) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }
  await query('UPDATE users SET is_active = ? WHERE user_id = ?', [Boolean(req.body?.is_active), req.params.id]);
  res.json({ user_id: Number(req.params.id), is_active: Boolean(req.body?.is_active) });
}));

module.exports = router;
