/**
 * Keep only whitelisted keys from a request body. Column names in SQL come
 * from this whitelist, never from user input, which prevents SQL injection.
 * Empty strings become NULL so optional DATE / INT columns save cleanly.
 */
function pick(body, allowed) {
  const out = {};
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key] === '' ? null : body[key];
  }
  return out;
}

function buildInsert(table, data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return { sql, params: Object.values(data) };
}

function buildUpdate(table, data, idColumn, id) {
  const cols = Object.keys(data);
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${idColumn} = ?`;
  return { sql, params: [...Object.values(data), id] };
}

/** Wraps async route handlers so thrown errors reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { pick, buildInsert, buildUpdate, asyncHandler };
