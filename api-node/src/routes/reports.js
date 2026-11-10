const express = require('express');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

/**
 * Proxies /api/reports/* and /api/reports/alerts/run to the Python FastAPI
 * service. The browser never calls FastAPI directly; Node checks the role
 * and adds the shared internal key.
 */
async function forward(req, res, path, method = 'GET') {
  const base = process.env.PY_SERVICE_URL || 'http://localhost:8000';
  const qs = new URLSearchParams(req.query).toString();
  try {
    const r = await fetch(`${base}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: { 'X-Internal-Key': process.env.INTERNAL_API_KEY || '' },
    });
    const body = await r.json().catch(() => ({}));
    res.status(r.status).json(body);
  } catch {
    res.status(502).json({ error: 'The reports service is not running. Start service-python and try again.' });
  }
}

router.get('/summary', authorize('CEO', 'HR', 'LEGAL'), asyncHandler((req, res) => forward(req, res, '/reports/summary')));
router.get('/expiring', authorize('CEO', 'HR', 'LEGAL'), asyncHandler((req, res) => forward(req, res, '/reports/expiring')));
router.get('/marketing', authorize('CEO', 'HR'), asyncHandler((req, res) => forward(req, res, '/reports/marketing')));
// Lets Legal / Admin run the alert check now instead of waiting for 06:00
router.post('/alerts/run', authorize('LEGAL'), asyncHandler((req, res) => forward(req, res, '/alerts/run', 'POST')));

module.exports = router;
