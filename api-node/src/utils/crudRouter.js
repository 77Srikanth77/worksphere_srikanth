const express = require('express');
const { query } = require('../db');
const { authorize } = require('../middleware/auth');
const { pick, buildInsert, buildUpdate, asyncHandler } = require('./helpers');

/**
 * Builds a standard list / get / create / update / delete router for a table.
 * options: { table, id, columns, readRoles, writeRoles, required, orderBy, filters }
 * `filters` are query-string keys allowed in ?key=value (e.g. employee_id).
 */
function crudRouter({ table, id, columns, readRoles, writeRoles, required = [], orderBy, filters = [] }) {
  const router = express.Router();

  router.get('/', authorize(...readRoles), asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    for (const f of filters) {
      if (req.query[f]) { where.push(`${f} = ?`); params.push(req.query[f]); }
    }
    const sql = `SELECT * FROM ${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy || id}`;
    res.json(await query(sql, params));
  }));

  router.get('/:id', authorize(...readRoles), asyncHandler(async (req, res) => {
    const rows = await query(`SELECT * FROM ${table} WHERE ${id} = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Record not found.' });
    res.json(rows[0]);
  }));

  router.post('/', authorize(...writeRoles), asyncHandler(async (req, res) => {
    const data = pick(req.body, columns);
    const missing = required.filter((c) => data[c] == null);
    if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    const { sql, params } = buildInsert(table, data);
    const result = await query(sql, params);
    const newId = data[id] ?? result.insertId;
    const rows = await query(`SELECT * FROM ${table} WHERE ${id} = ?`, [newId]);
    res.status(201).json(rows[0]);
  }));

  router.put('/:id', authorize(...writeRoles), asyncHandler(async (req, res) => {
    const data = pick(req.body, columns.filter((c) => c !== id));
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update.' });
    const { sql, params } = buildUpdate(table, data, id, req.params.id);
    const result = await query(sql, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Record not found.' });
    const rows = await query(`SELECT * FROM ${table} WHERE ${id} = ?`, [req.params.id]);
    res.json(rows[0]);
  }));

  router.delete('/:id', authorize(...writeRoles), asyncHandler(async (req, res) => {
    const result = await query(`DELETE FROM ${table} WHERE ${id} = ?`, [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Record not found.' });
    res.status(204).end();
  }));

  return router;
}

module.exports = crudRouter;
