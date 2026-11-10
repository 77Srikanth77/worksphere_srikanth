const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

const USER_SQL = `
  SELECT u.user_id, u.email, u.full_name, u.password_hash, u.employee_id, u.is_active, r.role_name AS role
  FROM users u JOIN roles r ON r.role_id = u.role_id`;

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });

  const [user] = await query(`${USER_SQL} WHERE u.email = ?`, [email.trim().toLowerCase()]);
  const ok = user && user.is_active && (await bcrypt.compare(password, user.password_hash));
  if (!ok) return res.status(401).json({ error: 'Email or password is incorrect.' });

  const payload = { user_id: user.user_id, role: user.role, employee_id: user.employee_id, full_name: user.full_name };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
  res.json({ token, user: { ...payload, email: user.email } });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const [user] = await query(`${USER_SQL} WHERE u.user_id = ?`, [req.user.user_id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  delete user.password_hash;
  res.json(user);
}));

module.exports = router;
