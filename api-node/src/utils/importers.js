/**
 * Excel imports. Each import type lists its columns and knows how to check rows (plan) and save them (apply).
 *
 *   plan(rows)   -> every row gets an action (CREATE / UPDATE / ERROR) with reasons; nothing is written
 *   apply(q, plannedRows) -> writes the valid rows inside one transaction
 *
 * The commit step re-plans from the submitted values, so the browser can't skip validation.
 * On UPDATE a blank cell means "leave as is", so a sheet can carry just the columns being changed;
 * required columns other than the matching keys (`keys`) are only required when a row creates a new record.
 */
const { query } = require('../db');

// ---------------------------------------------------------------- value helpers

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Plain value from an exceljs cell value (rich text, hyperlinks, formulas, dates) */
function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return cellValue(v.text);
    if ('error' in v) return null;
    return null;
  }
  return v;
}

/** Excel date cell, serial number, 2026-01-31, 01/31/2026 (US), 31-Jan-2026, Jan 31 2026 -> 'YYYY-MM-DD' | null | undefined(invalid) */
function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()) || undefined;
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { // Excel serial date
      const d = new Date(Math.round((v - 25569) * 86400000));
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) || undefined;
    }
    return undefined;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]) || undefined;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]) || undefined; // US month/day/year
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]+(\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]) || undefined;
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]) || undefined;
  return undefined;
}

/** Cell -> trimmed text ('' when empty). Whole numbers lose the ".0" Excel gives them. */
function toText(v) {
  const c = cellValue(v);
  if (c == null) return '';
  if (c instanceof Date) return toDate(c) || '';
  if (typeof c === 'number') return Number.isInteger(c) ? String(c) : String(c);
  return String(c).trim();
}

const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- import types

const col = (key, label, opts = {}) => ({ key, label, type: 'text', required: false, aliases: [], ...opts });

const TYPES = {
  EMPLOYEES: {
    label: 'Employees',
    roles: ['HR'],
    keys: ['employee_id'],
    description: 'Add new employees or update their personal details. Matched on Employee ID.',
    columns: [
      col('employee_id', 'Employee ID', { required: true, aliases: ['emp id', 'id', 'empid', 'employee number'], example: 'EMP010' }),
      col('first_name', 'First name', { required: true, aliases: ['firstname', 'given name'], example: 'Anil' }),
      col('middle_name', 'Middle name', { example: '' }),
      col('last_name', 'Last name', { required: true, aliases: ['lastname', 'surname', 'family name'], example: 'Sharma' }),
      col('date_of_birth', 'Date of birth', { type: 'date', aliases: ['dob', 'birth date'], example: '1994-06-15' }),
      col('hire_date', 'Hire date', { type: 'date', required: true, aliases: ['date of joining', 'doj', 'joining date', 'start date'], example: '2026-01-05' }),
      col('email', 'Email', { type: 'email', required: true, aliases: ['email address', 'work email'], example: 'anil.sharma@example.com' }),
      col('phone_number', 'Phone', { aliases: ['phone number', 'mobile', 'cell'], example: '555-0110' }),
      col('emergency_contact_name', 'Emergency contact name', { example: 'Ritu Sharma' }),
      col('emergency_contact_number', 'Emergency contact phone', { aliases: ['emergency contact number', 'emergency phone'], example: '555-0910' }),
      col('bio', 'Bio / skills summary', { aliases: ['bio', 'summary', 'skills'], example: 'Java / Spring Boot developer, 6 years.' }),
    ],
  },
  WORK: {
    label: 'Work assignments',
    roles: ['HR'],
    keys: ['employee_id', 'start_date'],
    description: 'Projects and bench periods: client, vendor, dates, location and client manager. Matched on Employee ID + Start date.',
    columns: [
      col('employee_id', 'Employee ID', { required: true, aliases: ['emp id', 'id'], example: 'EMP001' }),
      col('status', 'Status', { type: 'enum', values: ['PROJECT', 'BENCH'], aliases: ['project or bench'], example: 'PROJECT', help: 'PROJECT or BENCH (default PROJECT)' }),
      col('start_date', 'Start date', { type: 'date', required: true, example: '2026-02-01' }),
      col('end_date', 'End date', { type: 'date', example: '' }),
      col('client_name', 'Client', { aliases: ['client name', 'end client'], example: 'Northwind Bank', help: 'New client names are added automatically' }),
      col('vendor_name', 'Vendor', { aliases: ['vendor name', 'implementation partner', 'prime vendor'], example: 'Apex Staffing', help: 'New vendor names are added automatically' }),
      col('project_name', 'Project', { aliases: ['project name'], example: 'Core Payments' }),
      col('job_title', 'Job title', { required: true, aliases: ['title', 'designation', 'role'], example: 'Senior Java Developer' }),
      col('job_duties', 'Job duties', { aliases: ['duties', 'responsibilities'], example: 'Build Spring Boot microservices…' }),
      col('work_location', 'Work arrangement', { aliases: ['work location', 'work mode'], example: 'Client site' }),
      col('worksite_address', 'Worksite address', { aliases: ['address', 'client address', 'street'], example: '525 N Tryon St' }),
      col('city', 'City', { example: 'Charlotte' }),
      col('state', 'State', { type: 'state', example: 'NC' }),
      col('worksite_zip', 'ZIP', { type: 'zip', aliases: ['zip code', 'postal code', 'zipcode'], example: '28202' }),
      col('client_manager_name', 'Client manager', { aliases: ['reporting manager', 'manager name', 'client manager name'], example: 'Laura Hill' }),
      col('client_manager_title', 'Client manager title', { aliases: ['manager title'], example: 'Director' }),
      col('client_manager_email', 'Client manager email', { type: 'email', aliases: ['manager email'], example: 'laura.hill@example.com' }),
      col('client_manager_phone', 'Client manager phone', { aliases: ['manager phone'], example: '555-0201' }),
    ],
  },
  IMMIGRATION: {
    label: 'Visa & LCA records',
    roles: ['HR', 'LEGAL'],
    keys: ['employee_id', 'visa_type'],
    description: 'Visa type, receipt number, visa and LCA dates, case status. Matched on Employee ID + Receipt # (or visa type).',
    columns: [
      col('employee_id', 'Employee ID', { required: true, aliases: ['emp id', 'id'], example: 'EMP002' }),
      col('visa_type', 'Visa type', { required: true, aliases: ['visa', 'status', 'work authorization'], example: 'H1B' }),
      col('receipt_number', 'Receipt number', { aliases: ['receipt', 'receipt #', 'receipt no'], example: 'WAC2612345678' }),
      col('start_date', 'Visa start date', { type: 'date', aliases: ['valid from', 'visa start'], example: '2025-10-01' }),
      col('expiry_date', 'Visa expiry date', { type: 'date', required: true, aliases: ['expiry', 'expiration date', 'valid to', 'visa end date'], example: '2028-09-30' }),
      col('lca_number', 'LCA number', { aliases: ['lca case number', 'lca #', 'lca no'], example: 'I-200-25270-111111' }),
      col('lca_start_date', 'LCA start date', { type: 'date', example: '2025-10-01' }),
      col('lca_expiry_date', 'LCA expiry date', { type: 'date', aliases: ['lca end date', 'lca expiration'], example: '2028-09-30' }),
      col('case_status', 'Case status', { type: 'enum', values: ['ACTIVE', 'IN_PROGRESS', 'FILED', 'RENEWED', 'EXPIRED'], example: 'ACTIVE', help: 'ACTIVE, IN_PROGRESS, FILED, RENEWED or EXPIRED' }),
      col('notes', 'Notes', { example: '' }),
    ],
  },
  WORK_DETAILS: {
    label: 'Assignment legal details',
    roles: ['HR', 'LEGAL'],
    keys: ['employee_id'],
    description: 'Job title, job duties, worksite address, client reporting manager, LCA case number and wage for existing assignments.',
    columns: [
      col('employee_id', 'Employee ID', { required: true, aliases: ['emp id', 'id'], example: 'EMP002' }),
      col('start_date', 'Assignment start date', { type: 'date', aliases: ['start date', 'project start date'], example: '', help: 'Leave empty to update the employee\'s current project' }),
      col('job_title', 'Job title', { aliases: ['title', 'designation', 'role', 'position'], example: 'Data Engineer' }),
      col('job_duties', 'Job duties', { aliases: ['duties', 'responsibilities'], example: 'Design Airflow DAGs…' }),
      col('worksite_address', 'Worksite address', { aliases: ['address', 'client address'], example: '2000 Main St' }),
      col('city', 'City', { example: 'Austin' }),
      col('state', 'State', { type: 'state', example: 'TX' }),
      col('worksite_zip', 'ZIP', { type: 'zip', aliases: ['zip code', 'postal code'], example: '73301' }),
      col('work_location', 'Work arrangement', { aliases: ['work location', 'work mode'], example: 'Remote' }),
      col('client_manager_name', 'Client manager', { aliases: ['reporting manager', 'manager name'], example: 'Mark Evans' }),
      col('client_manager_title', 'Client manager title', { aliases: ['manager title'], example: 'Data Platform Manager' }),
      col('client_manager_email', 'Client manager email', { type: 'email', aliases: ['manager email'], example: 'mark.evans@example.com' }),
      col('client_manager_phone', 'Client manager phone', { aliases: ['manager phone'], example: '555-0202' }),
      col('lca_case_number', 'LCA case number', { aliases: ['lca number', 'lca #'], example: 'I-200-24120-654321' }),
      col('lca_wage', 'LCA wage', { type: 'money', aliases: ['lca wage amount', 'wage', 'lca salary', 'lca amount'], example: '108000' }),
      col('lca_wage_unit', 'LCA wage per', { type: 'enum', values: ['YEAR', 'HOUR'], aliases: ['wage unit', 'per'], example: 'YEAR', help: 'YEAR or HOUR (default YEAR)' }),
    ],
  },
  H1B_CAP: {
    label: 'H-1B cap cases',
    roles: ['LEGAL', 'HR'],
    keys: ['first_name', 'last_name'],
    description: 'Everyone filed for in an H-1B cap season. New people get an employee record automatically. Matched on Cap year + First and Last name; without a Cap year column rows go to the current season.',
    columns: [
      col('cap_year', 'Cap year', { type: 'capyear', aliases: ['cap season', 'season', 'h1b year', 'fiscal year', 'fy', 'filing year'], example: '2026-27', help: 'e.g. 2026-27 or 26-27 (FY2027 also works). Empty = current season' }),
      col('first_name', 'First name', { required: true, aliases: ['firstname', 'given name'], example: 'Anil' }),
      col('last_name', 'Last name', { required: true, aliases: ['lastname', 'surname', 'family name'], example: 'Sharma' }),
      col('employee_id', 'Employee ID', { aliases: ['emp id', 'empid'], example: '', help: 'Optional. Without it the case is linked by matching first + last name' }),
      col('on_project', 'Project', { type: 'yesno', aliases: ['on project', 'project yes no', 'placed'], example: 'Yes', help: 'Yes or No' }),
      col('vendor_name', 'Vendor', { aliases: ['vendor name', 'implementation partner', 'prime vendor'], example: 'Apex Staffing' }),
      col('client_name', 'Client', { aliases: ['client name', 'end client'], example: 'Northwind Bank' }),
      col('notes', 'Notes', { aliases: ['note', 'comments', 'remarks'], example: '', help: '"NL" / "no longer with" marks the person as left the company' }),
      col('lca_wage', 'LCA amount', { type: 'money', aliases: ['lca wage', 'lca salary', 'wage', 'salary', 'offered wage'], example: '95000', help: 'Yearly wage on the LCA' }),
      col('lca_location', 'LCA location', { aliases: ['lca worksite', 'worksite', 'work location', 'location'], example: 'Remote Austin, TX', help: 'Starting with "Remote" or ending with "(Client Site)" also sets the work mode' }),
      col('job_title', 'Job title', { required: true, aliases: ['title', 'designation', 'position', 'soc title'], example: 'Data Engineer' }),
      col('work_mode', 'Work mode', { type: 'enum', values: ['REMOTE', 'CLIENT_SITE', 'HYBRID'], aliases: ['work arrangement'], example: '', help: 'REMOTE, CLIENT_SITE or HYBRID (read from LCA location when empty)' }),
      col('receipt_number', 'Receipt number', { aliases: ['receipt', 'receipt #', 'receipt no'], example: '' }),
      col('case_status', 'Case status', { type: 'enum', values: ['REGISTERED', 'SELECTED', 'FILED', 'RFE', 'APPROVED', 'DENIED', 'WITHDRAWN'], aliases: ['status', 'petition status'], example: 'FILED', help: 'Default FILED' }),
    ],
  },
};

/** H-1B cap season 'YYYY-YY' for a date (petitions are filed from April; start date is Oct 1 of the same year) */
const currentCapYear = (d = new Date()) => `${d.getFullYear()}-${pad((d.getFullYear() + 1) % 100)}`;
/** '2026-27', '26-27', '2026-2027', 'FY2027', 'FY27' -> '2026-27' | undefined */
function toCapYear(v) {
  const s = String(v).trim().toUpperCase().replace(/\s+/g, '');
  const full = (y) => (y.length === 2 ? 2000 + +y : +y);
  let m = s.match(/^(?:FY)?(\d{2}|\d{4})[-/](\d{2}|\d{4})$/);
  if (m && full(m[2]) === full(m[1]) + 1) return `${full(m[1])}-${pad(full(m[2]) % 100)}`;
  m = s.match(/^FY(\d{2}|\d{4})$/);
  if (m) return `${full(m[1]) - 1}-${pad(full(m[1]) % 100)}`;
  return undefined;
}

/** Validates and normalizes one cell against its column. Returns { value, error } */
function checkCell(c, raw) {
  const v = c.type === 'date' ? cellValue(raw) : toText(raw);
  if (v == null || v === '') return { value: '' };
  switch (c.type) {
    case 'date': {
      const d = toDate(v);
      return d ? { value: d } : { value: toText(raw), error: `${c.label} "${toText(raw)}" is not a date (use YYYY-MM-DD or MM/DD/YYYY)` };
    }
    case 'email': return EMAIL.test(v) ? { value: v.toLowerCase() } : { value: v, error: `${c.label} "${v}" is not a valid email` };
    case 'enum': {
      const u = v.toUpperCase().replace(/[\s-]+/g, '_');
      return c.values.includes(u) ? { value: u } : { value: v, error: `${c.label} must be one of ${c.values.join(', ')}` };
    }
    case 'state': return /^[A-Za-z]{2}$/.test(v) ? { value: v.toUpperCase() } : { value: v, error: `${c.label} should be a 2-letter code like TX` };
    case 'zip': {
      const z = /^\d{4}$/.test(v) ? `0${v}` : v; // Excel drops the leading zero of ZIPs like 02139
      return /^\d{5}(-\d{4})?$/.test(z) ? { value: z } : { value: v, error: `${c.label} "${v}" should be 5 digits` };
    }
    case 'money': {
      const n = Number(v.replace(/[$,\s]/g, ''));
      return n > 0 ? { value: String(n) } : { value: v, error: `${c.label} "${v}" is not a positive amount` };
    }
    case 'yesno': {
      if (/^(y|yes|true|1|x|✓)$/i.test(v)) return { value: '1' };
      if (/^(n|no|false|0)$/i.test(v)) return { value: '0' };
      return { value: v, error: `${c.label} should be Yes or No` };
    }
    case 'capyear': {
      const y = toCapYear(v);
      return y ? { value: y } : { value: v, error: `${c.label} "${v}" should look like 2026-27` };
    }
    default: return { value: v };
  }
}

// ---------------------------------------------------------------- reading a workbook

/**
 * Reads the first data sheet: finds the header row, maps headers to the type's columns.
 * Returns { mapping, ignored, missingRequired, rows: [{ row, raw: {key: cellValue} }] }
 */
function readSheet(workbook, type) {
  const def = TYPES[type];
  const sheet = workbook.worksheets.find((ws) => !/instruction|help|readme/i.test(ws.name) && ws.actualRowCount > 0);
  if (!sheet) return { error: 'The file has no data sheet.' };
  const lookup = new Map();
  def.columns.forEach((c) => [c.key, c.label, ...c.aliases].forEach((n) => lookup.set(normHeader(n), c)));

  let headerRow = null;
  for (let r = 1; r <= Math.min(sheet.rowCount, 10) && !headerRow; r += 1) {
    const vals = sheet.getRow(r).values.slice(1).map(toText);
    if (vals.filter((x) => lookup.has(normHeader(x))).length >= 2) headerRow = r;
  }
  if (!headerRow) return { error: `Could not find the header row. Use the ${def.label} template (first row = column names).` };

  const mapping = [];
  const ignored = [];
  const used = new Set();
  sheet.getRow(headerRow).eachCell((cell, colNumber) => {
    const h = toText(cell.value);
    const c = lookup.get(normHeader(h));
    if (c && !used.has(c.key)) { mapping.push({ col: colNumber, header: h, key: c.key, label: c.label }); used.add(c.key); }
    else if (h) ignored.push(h);
  });
  const missingRequired = def.columns.filter((c) => c.required && !used.has(c.key)).map((c) => c.label);

  const rows = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const raw = {};
    let any = false;
    mapping.forEach((m) => {
      const v = row.getCell(m.col).value;
      raw[m.key] = v;
      if (toText(v) !== '') any = true;
    });
    // Skip blank rows and the template's example row
    if (any && !(toText(raw.employee_id).toUpperCase() === 'EXAMPLE')) rows.push({ row: r, raw });
  }
  return { mapping, ignored, missingRequired, rows };
}

/** Normalizes raw cells (or already-normalized values from the browser) to { values, errors } */
function normalizeRow(type, raw) {
  const values = {};
  const errors = [];
  TYPES[type].columns.forEach((c) => {
    if (!(c.key in raw)) return;
    const { value, error } = checkCell(c, raw[c.key]);
    values[c.key] = value;
    if (error) errors.push(error);
  });
  // Columns that identify the record are always needed; the other required columns only for new records (see plan)
  TYPES[type].columns.filter((c) => c.required && TYPES[type].keys.includes(c.key)).forEach((c) => {
    if (!values[c.key] && !errors.some((e) => e.startsWith(c.label))) errors.push(`${c.label} is required`);
  });
  return { values, errors };
}

// ---------------------------------------------------------------- planning (validation + create/update decision)

async function context() {
  const [emps, clients, vendors, work, imm] = await Promise.all([
    query('SELECT employee_id, email, first_name, last_name FROM emp'),
    query('SELECT client_id, client_name FROM clients'),
    query('SELECT vendor_id, vendor_name FROM vendors'),
    query('SELECT work_id, employee_id, status, start_date, end_date FROM work'),
    query('SELECT visa_id, employee_id, visa_type, receipt_number FROM immigration'),
  ]);
  const caps = await query('SELECT case_id, cap_year, first_name, last_name, case_status FROM h1b_cap_cases');
  const nameKey = (y, f, l) => `${y}|${String(f).trim().toLowerCase()}|${String(l).trim().toLowerCase()}`;
  const byLower = (rows, k) => new Map(rows.map((r) => [String(r[k]).trim().toLowerCase(), r]));
  return {
    emp: new Map(emps.map((e) => [e.employee_id, e])),
    empByEmail: new Map(emps.map((e) => [e.email.toLowerCase(), e.employee_id])),
    clients: byLower(clients, 'client_name'),
    vendors: byLower(vendors, 'vendor_name'),
    work,
    imm,
    nameKey,
    caps: new Map(caps.map((c) => [nameKey(c.cap_year, c.first_name, c.last_name), c])),
    empByName: emps.reduce((m, e) => {
      const k = nameKey('', e.first_name, e.last_name);
      m.set(k, m.has(k) ? null : e.employee_id); // null = more than one employee with this name
      return m;
    }, new Map()),
  };
}

const PLANNERS = {
  EMPLOYEES(values, errors, ctx, seen) {
    const id = values.employee_id;
    const exists = ctx.emp.has(id);
    if (id && id.length > 20) errors.push('Employee ID is longer than 20 characters');
    if (values.email) {
      const owner = ctx.empByEmail.get(values.email);
      if (owner && owner !== id) errors.push(`Email ${values.email} already belongs to ${owner}`);
      if (seen.emails.has(values.email) && seen.emails.get(values.email) !== id) errors.push(`Email ${values.email} is used twice in this file`);
      seen.emails.set(values.email, id);
    }
    if (values.date_of_birth && values.hire_date && values.date_of_birth >= values.hire_date) errors.push('Date of birth is after the hire date');
    return { action: exists ? 'UPDATE' : 'CREATE', key: id };
  },
  WORK(values, errors, ctx, seen, warnings) {
    const id = values.employee_id;
    if (id && !ctx.emp.has(id)) errors.push(`Employee ${id} not found. Import employees first`);
    if (values.end_date && values.start_date && values.end_date < values.start_date) errors.push('End date is before the start date');
    if (values.client_name && !ctx.clients.has(values.client_name.toLowerCase())) warnings.push(`New client "${values.client_name}" will be added`);
    if (values.vendor_name && !ctx.vendors.has(values.vendor_name.toLowerCase())) warnings.push(`New vendor "${values.vendor_name}" will be added`);
    const match = ctx.work.find((w) => w.employee_id === id && w.start_date === values.start_date);
    return { action: match ? 'UPDATE' : 'CREATE', key: `${id} from ${values.start_date || '?'}`, target: match?.work_id };
  },
  IMMIGRATION(values, errors, ctx) {
    const id = values.employee_id;
    if (id && !ctx.emp.has(id)) errors.push(`Employee ${id} not found`);
    if (values.lca_start_date && values.lca_expiry_date && values.lca_expiry_date < values.lca_start_date) errors.push('LCA expiry is before LCA start');
    if (values.start_date && values.expiry_date && values.expiry_date < values.start_date) errors.push('Visa expiry is before visa start');
    const mine = ctx.imm.filter((v) => v.employee_id === id);
    let match = values.receipt_number ? mine.find((v) => v.receipt_number && v.receipt_number.toLowerCase() === values.receipt_number.toLowerCase()) : null;
    if (!match && values.visa_type) {
      const same = mine.filter((v) => v.visa_type.toLowerCase() === values.visa_type.toLowerCase() && (!values.receipt_number || !v.receipt_number));
      if (same.length === 1) match = same[0];
    }
    return { action: match ? 'UPDATE' : 'CREATE', key: `${id} ${values.visa_type || ''} ${values.receipt_number || ''}`.trim(), target: match?.visa_id };
  },
  WORK_DETAILS(values, errors, ctx) {
    const id = values.employee_id;
    if (id && !ctx.emp.has(id)) { errors.push(`Employee ${id} not found`); return { action: 'UPDATE', key: id }; }
    const mine = ctx.work.filter((w) => w.employee_id === id);
    let match;
    if (values.start_date) {
      match = mine.find((w) => w.start_date === values.start_date);
      if (!match) errors.push(`No assignment for ${id} starting ${values.start_date}`);
    } else {
      const current = mine.filter((w) => !w.end_date && w.status === 'PROJECT');
      if (current.length === 1) [match] = current;
      else errors.push(current.length ? `${id} has several current projects. Add the assignment start date` : `${id} has no current project. Add the assignment start date`);
    }
    const changes = TYPES.WORK_DETAILS.columns.filter((c) => !['employee_id', 'start_date'].includes(c.key) && values[c.key]);
    if (match && !changes.length) errors.push('Nothing to update in this row');
    return { action: 'UPDATE', key: `${id}${match ? ` (assignment from ${match.start_date})` : ''}`, target: match?.work_id };
  },
  H1B_CAP(values, errors, ctx, seen, warnings) {
    if (!values.cap_year) values.cap_year = currentCapYear();
    const name = `${values.first_name || '?'} ${values.last_name || '?'}`;
    // "Acme Bank (When we filed we used the company name)" -> client + note
    const filedAs = values.client_name && values.client_name.match(/^(.*?)\s*\(([^)]*\bfiled\b[^)]*)\)\s*$/i);
    if (filedAs) {
      values.client_name = filedAs[1];
      values.notes = [values.notes, filedAs[2]].filter(Boolean).join('; ');
      warnings.push(`"${filedAs[2]}" moved from Client to Notes`);
    }
    // "Remote San Diego" / "Rempoe Saint Johns, FL" / "1981 N Central Expy ... (Client Site)" -> work mode + location
    if (values.lca_location) {
      const remote = values.lca_location.match(/^(remote|remot|rempoe|remte|remoe)\b[\s,]*/i);
      const site = values.lca_location.match(/\s*\(client\s*site\)\s*$/i);
      if (remote) values.lca_location = values.lca_location.slice(remote[0].length);
      if (site) values.lca_location = values.lca_location.slice(0, site.index);
      if (!values.work_mode && (remote || site)) values.work_mode = remote ? 'REMOTE' : 'CLIENT_SITE';
      values.lca_location = values.lca_location.replace(/\s+/g, ' ').trim();
    }
    if (values.notes && /(^|\W)NL(\W|$)|no longer with|left the company|resigned/i.test(values.notes)) {
      values.employment_status = 'LEFT';
      warnings.push('Notes say this person is no longer with the company. Marked as left');
    }
    if (values.employee_id) {
      if (!ctx.emp.has(values.employee_id)) errors.push(`Employee ${values.employee_id} not found`);
    } else if (values.first_name && values.last_name) {
      const linked = ctx.empByName.get(ctx.nameKey('', values.first_name, values.last_name));
      if (linked) values.employee_id = linked;
      else if (linked === null) warnings.push(`Several employees are named ${name}. Add the Employee ID to link the right one`);
      else warnings.push('Not an employee yet: an employee record will be created');
    }
    const existing = ctx.caps.get(ctx.nameKey(values.cap_year, values.first_name, values.last_name));
    if (values.case_status === 'APPROVED' && existing?.case_status !== 'APPROVED') {
      errors.push('Mark approvals in WorkSphere with "Approve": it needs the H-1B and LCA details');
    }
    return { action: existing ? 'UPDATE' : 'CREATE', key: `${values.cap_year} ${name}`, target: existing?.case_id };
  },
};

/** rows: [{ row, raw }] or [{ row, values }] -> planned rows + summary */
async function plan(type, rows) {
  const ctx = await context();
  const seen = { keys: new Map(), emails: new Map() };
  const planned = rows.map((r) => {
    const { values, errors } = normalizeRow(type, r.raw || r.values || {});
    const warnings = [];
    const p = PLANNERS[type](values, errors, ctx, seen, warnings);
    if (p.action === 'CREATE') {
      TYPES[type].columns.filter((c) => c.required && !TYPES[type].keys.includes(c.key) && !values[c.key]).forEach((c) => {
        if (!errors.some((e) => e.startsWith(c.label))) errors.push(`${c.label} is required for a new record`);
      });
    }
    const dupKey = `${p.key}`;
    if (seen.keys.has(dupKey)) errors.push(`Same record as row ${seen.keys.get(dupKey)}`);
    else seen.keys.set(dupKey, r.row);
    return { row: r.row, action: errors.length ? 'ERROR' : p.action, key: p.key, target: p.target, errors, warnings, values };
  });
  const count = (a) => planned.filter((p) => p.action === a).length;
  return { rows: planned, summary: { total: planned.length, create: count('CREATE'), update: count('UPDATE'), errors: count('ERROR') } };
}

// ---------------------------------------------------------------- applying

const filled = (values, keys) => Object.fromEntries(keys.filter((k) => values[k] !== undefined && values[k] !== '').map((k) => [k, values[k]]));
function upsert(q, table, idCol, id, data) {
  const cols = Object.keys(data);
  if (!cols.length) return;
  if (id == null) {
    q(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(data));
  } else {
    q(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${idCol} = ?`, [...Object.values(data), id]);
  }
}

const APPLIERS = {
  EMPLOYEES(q, r) {
    const keys = TYPES.EMPLOYEES.columns.map((c) => c.key);
    if (r.action === 'CREATE') upsert(q, 'emp', 'employee_id', null, filled(r.values, keys));
    else upsert(q, 'emp', 'employee_id', r.values.employee_id, filled(r.values, keys.filter((k) => k !== 'employee_id')));
  },
  WORK(q, r, cache) {
    const lookupOrCreate = (table, idCol, nameCol, name) => {
      if (!name) return undefined;
      const k = `${table}:${name.toLowerCase()}`;
      if (!cache.has(k)) {
        const [found] = q(`SELECT ${idCol} AS id FROM ${table} WHERE lower(trim(${nameCol})) = ?`, [name.toLowerCase()]);
        cache.set(k, found ? found.id : q(`INSERT INTO ${table} (${nameCol}) VALUES (?)`, [name]).insertId);
      }
      return cache.get(k);
    };
    const keys = ['employee_id', 'status', 'start_date', 'end_date', 'project_name', 'job_title', 'job_duties', 'work_location',
      'worksite_address', 'city', 'state', 'worksite_zip', 'client_manager_name', 'client_manager_title', 'client_manager_email', 'client_manager_phone'];
    const data = filled(r.values, keys);
    const clientId = lookupOrCreate('clients', 'client_id', 'client_name', r.values.client_name);
    const vendorId = lookupOrCreate('vendors', 'vendor_id', 'vendor_name', r.values.vendor_name);
    if (clientId) data.client_id = clientId;
    if (vendorId) data.vendor_id = vendorId;
    if (r.action === 'CREATE') upsert(q, 'work', 'work_id', null, { status: 'PROJECT', ...data });
    else { delete data.employee_id; delete data.start_date; upsert(q, 'work', 'work_id', r.target, data); }
  },
  IMMIGRATION(q, r) {
    const keys = TYPES.IMMIGRATION.columns.map((c) => c.key);
    const data = filled(r.values, keys);
    if (r.action === 'CREATE') upsert(q, 'immigration', 'visa_id', null, { case_status: 'ACTIVE', ...data });
    else { delete data.employee_id; upsert(q, 'immigration', 'visa_id', r.target, { ...data, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') }); }
  },
  WORK_DETAILS(q, r) {
    const keys = ['job_title', 'job_duties', 'worksite_address', 'city', 'state', 'worksite_zip', 'work_location', 'client_manager_name',
      'client_manager_title', 'client_manager_email', 'client_manager_phone', 'lca_case_number', 'lca_wage_unit'];
    const data = filled(r.values, keys);
    if (r.values.lca_wage) {
      data.lca_wage_cents = Math.round(Number(r.values.lca_wage) * 100);
      if (!data.lca_wage_unit) data.lca_wage_unit = 'YEAR';
    }
    upsert(q, 'work', 'work_id', r.target, data);
  },
};

APPLIERS.H1B_CAP = (q, r) => {
  const keys = ['cap_year', 'first_name', 'last_name', 'employee_id', 'vendor_name', 'client_name', 'notes', 'lca_location',
    'job_title', 'work_mode', 'receipt_number', 'case_status', 'employment_status'];
  const data = filled(r.values, keys);
  if (r.values.on_project !== undefined && r.values.on_project !== '') data.on_project = Number(r.values.on_project);
  if (r.values.lca_wage) data.lca_wage_cents = Math.round(Number(r.values.lca_wage) * 100);
  if (r.action === 'CREATE') upsert(q, 'h1b_cap_cases', 'case_id', null, data);
  else { delete data.cap_year; delete data.first_name; delete data.last_name; upsert(q, 'h1b_cap_cases', 'case_id', r.target, data); }
};

function apply(q, type, plannedRows) {
  const cache = new Map();
  plannedRows.filter((r) => r.action !== 'ERROR').forEach((r) => APPLIERS[type](q, r, cache));
}

module.exports = { TYPES, readSheet, plan, apply };
