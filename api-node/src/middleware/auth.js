const jwt = require('jsonwebtoken');

/** Verifies the "Authorization: Bearer <token>" header and sets req.user. */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

/** Allows the request only if the user's role is in the list. ADMIN always passes. */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    if (req.user.role === 'ADMIN' || roles.includes(req.user.role)) return next();
    res.status(403).json({ error: 'You do not have access to this page.' });
  };
}

module.exports = { authenticate, authorize };
