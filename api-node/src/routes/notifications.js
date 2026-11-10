const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../utils/helpers');

// The signed-in user's notifications (bell in the top bar). Every role has one.
const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const [items, [{ unread }]] = await Promise.all([
    query('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, notification_id DESC LIMIT 30', [req.user.user_id]),
    query('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.user_id]),
  ]);
  res.json({ unread, items });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  await query("UPDATE notifications SET read_at = datetime('now','localtime') WHERE user_id = ? AND read_at IS NULL", [req.user.user_id]);
  res.json({ ok: true });
}));

router.post('/:id/read', asyncHandler(async (req, res) => {
  await query("UPDATE notifications SET read_at = COALESCE(read_at, datetime('now','localtime')) WHERE notification_id = ? AND user_id = ?",
    [req.params.id, req.user.user_id]);
  res.json({ ok: true });
}));

module.exports = router;
