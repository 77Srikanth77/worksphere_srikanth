require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { authenticate } = require('./middleware/auth');
const crudRouter = require('./utils/crudRouter');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Public
app.use('/api/auth', require('./routes/auth'));

// Everything below requires a valid login token
app.use('/api', authenticate);

app.use('/api/me', require('./routes/me'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/immigration', require('./routes/immigration'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/marketing', require('./routes/marketing'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/users', require('./routes/users'));
app.use('/api/documents', require('./routes/documents'));

app.use('/api/work', crudRouter({
  table: 'work',
  id: 'work_id',
  columns: ['employee_id', 'client_id', 'vendor_id', 'project_name', 'job_title', 'job_duties',
    'work_location', 'city', 'state', 'status', 'start_date', 'end_date'],
  required: ['employee_id', 'status', 'start_date'],
  readRoles: ['CEO', 'HR', 'LEGAL', 'MARKETING'],
  writeRoles: ['HR'],
  filters: ['employee_id', 'status'],
  orderBy: 'start_date DESC',
}));

app.use('/api/clients', crudRouter({
  table: 'clients',
  id: 'client_id',
  columns: ['client_name', 'contact_name', 'contact_email', 'phone', 'address'],
  required: ['client_name'],
  readRoles: ['CEO', 'HR', 'LEGAL', 'MARKETING'],
  writeRoles: ['HR', 'MARKETING'],
  orderBy: 'client_name',
}));

app.use('/api/vendors', crudRouter({
  table: 'vendors',
  id: 'vendor_id',
  columns: ['vendor_name', 'contact_name', 'contact_email', 'phone'],
  required: ['vendor_name'],
  readRoles: ['CEO', 'HR', 'MARKETING'],
  writeRoles: ['HR', 'MARKETING'],
  orderBy: 'vendor_name',
}));

app.use('/api/trainings', crudRouter({
  table: 'trainings',
  id: 'training_id',
  columns: ['employee_id', 'training_name', 'provider', 'start_date', 'end_date', 'status'],
  required: ['employee_id', 'training_name'],
  readRoles: ['CEO', 'HR', 'MARKETING'],
  writeRoles: ['HR'],
  filters: ['employee_id'],
  orderBy: 'start_date DESC',
}));

app.use('/api/interviews', crudRouter({
  table: 'interviews',
  id: 'interview_id',
  columns: ['employee_id', 'submission_id', 'interview_date', 'round_name', 'mode', 'result', 'feedback'],
  required: ['employee_id'],
  readRoles: ['CEO', 'HR', 'MARKETING'],
  writeRoles: ['HR', 'MARKETING'],
  filters: ['employee_id', 'result'],
  orderBy: 'interview_date DESC',
}));

app.use('/api', (req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` }));

// Central error handler: turns SQLite errors into readable messages
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (['SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(err.code)) {
    return res.status(409).json({ error: 'That record already exists.' });
  }
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return res.status(400).json({ error: 'A linked record (employee, client or vendor) does not exist.' });
  }
  if (err.code === 'SQLITE_CONSTRAINT_CHECK') {
    return res.status(400).json({ error: 'One of the values is not allowed (check status / type fields).' });
  }
  if (err.code === 'SQLITE_CONSTRAINT_NOTNULL') {
    return res.status(400).json({ error: 'A required field is missing.' });
  }
  if (err.code === 'SQLITE_BUSY') return res.status(503).json({ error: 'The database is busy. Try again in a moment.' });
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`WorkSphere API listening on http://localhost:${port}`));
