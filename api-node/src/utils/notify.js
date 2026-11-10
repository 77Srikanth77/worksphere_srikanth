const { query } = require('../db');

/**
 * Adds an in-app notification (bell in the top bar) for one or more users.
 * notify(userIds, { type, title, body, link })
 */
async function notify(userIds, { type, title, body = null, link = null }) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await query('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)', [id, type, title, body, link]);
  }
  return ids.length;
}

/** Login user ids of employees (employees without a login are skipped) */
async function userIdsForEmployees(employeeIds) {
  const ids = [].concat(employeeIds).filter(Boolean);
  if (!ids.length) return [];
  const rows = await query(`SELECT user_id FROM users WHERE is_active = TRUE AND employee_id IN (${ids.map(() => '?').join(',')})`, ids);
  return rows.map((r) => r.user_id);
}

module.exports = { notify, userIdsForEmployees };
