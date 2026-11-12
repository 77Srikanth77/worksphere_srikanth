/**
 * Turns an H-1B cap season into employee records.
 *
 * Runs automatically when cap cases are imported, added or edited. For every cap case:
 *   - employee: linked by employee_id, else by exact first + last name. Missing -> created with
 *     a new EMPnnn id, a placeholder email (…@email-pending.invalid, never deliverable) and today as hire date.
 *   - login: an EMPLOYEE account is created switched off (is_active = 0, no password) when there is none.
 *     HR turns it on once the real email is in.
 *   - assignment: no current assignment -> one is started today (Project Yes -> PROJECT with client / vendor,
 *     No -> BENCH). A current assignment only has its blanks filled (job title, LCA wage, location):
 *     once an employee exists, HR's work history wins over the filing sheet.
 *     People marked as left the company get no assignment.
 *
 * planSync() only reads; applySync() writes inside the caller's transaction.
 */
const COMPANY = (process.env.COMPANY_NAME || 'Sysintelli').toLowerCase().replace(/[^a-z0-9]/g, '');
const PLACEHOLDER_DOMAIN = 'email-pending.invalid';

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); // "Apex IT" == "ApexIT"
const nameKey = (f, l) => `${String(f).trim().toLowerCase()}|${String(l).trim().toLowerCase()}`;
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const isInHouse = (client) => !client || squash(client).startsWith(COMPANY);

/** "Saint Johns, FL" | "1981 N Central Expressway, Richardson, TX 75080" | "San Diego" -> worksite fields */
function parseLocation(text, mode) {
  const out = { work_location: { REMOTE: 'Remote', CLIENT_SITE: 'Client site', HYBRID: 'Hybrid' }[mode] || null };
  const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/^,\s*/, '');
  if (!t) return out;
  let m = t.match(/^(.+),\s*([^,]+),\s*([A-Za-z]{2})\s*(\d{5})?$/);
  if (m) return { ...out, worksite_address: m[1], city: m[2], state: m[3].toUpperCase(), worksite_zip: m[4] || null };
  m = t.match(/^([^,]+),\s*([A-Za-z]{2})\s*(\d{5})?$/);
  if (m) return { ...out, city: m[1], state: m[2].toUpperCase(), worksite_zip: m[3] || null };
  return { ...out, city: t };
}

function emailFor(c, taken) {
  const base = `${c.first_name}.${c.last_name}`.toLowerCase().replace(/[^a-z0-9.]+/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
  let email = `${base}@${PLACEHOLDER_DOMAIN}`;
  for (let n = 2; taken.has(email); n += 1) email = `${base}${n}@${PLACEHOLDER_DOMAIN}`;
  taken.add(email);
  return email;
}

/** q = sync query function (querySync or a transaction's q) */
function planSync(q, capYear, caseId = null) {
  const cases = caseId
    ? q('SELECT * FROM h1b_cap_cases WHERE case_id = ?', [caseId])
    : q('SELECT * FROM h1b_cap_cases WHERE cap_year = ? ORDER BY case_id', [capYear]);
  const emps = q('SELECT employee_id, first_name, last_name, email FROM emp');
  const users = q('SELECT user_id, email, employee_id FROM users');
  const clients = q('SELECT client_id, client_name FROM clients');
  const vendors = q('SELECT vendor_id, vendor_name FROM vendors');
  const current = q(`SELECT w.*, c.client_name FROM work w LEFT JOIN clients c ON c.client_id = w.client_id
                     WHERE w.end_date IS NULL ORDER BY w.start_date DESC, w.work_id DESC`);

  const empById = new Map(emps.map((e) => [e.employee_id, e]));
  const empByName = new Map();
  emps.forEach((e) => { const k = nameKey(e.first_name, e.last_name); empByName.set(k, empByName.has(k) ? null : e); });
  const userByEmp = new Map(users.filter((u) => u.employee_id).map((u) => [u.employee_id, u]));
  const takenEmails = new Set([...emps.map((e) => e.email.toLowerCase()), ...users.map((u) => u.email.toLowerCase())]);
  const clientBySquash = new Map(clients.map((c) => [squash(c.client_name), c]));
  const vendorBySquash = new Map(vendors.map((v) => [squash(v.vendor_name), v]));
  let nextNo = Math.max(0, ...emps.map((e) => (/^EMP(\d+)$/.exec(e.employee_id) || [])[1]).filter(Boolean).map(Number)) + 1;

  return cases.map((c) => {
    const name = `${c.first_name} ${c.last_name}`;
    const notes = [];
    let emp = c.employee_id ? empById.get(c.employee_id) : empByName.get(nameKey(c.first_name, c.last_name));
    if (emp === null) {
      return { case_id: c.case_id, name, error: `More than one employee is named ${name}. Set the Employee ID on the cap case.` };
    }
    const employee = emp
      ? { action: 'UPDATE', employee_id: emp.employee_id }
      : { action: 'CREATE', employee_id: `EMP${String(nextNo++).padStart(3, '0')}`, email: emailFor(c, takenEmails), hire_date: today() };
    if (employee.action === 'CREATE') notes.push('Placeholder email and hire date: HR to update');
    const email = emp ? emp.email : employee.email;
    let user = userByEmp.has(employee.employee_id) ? { action: 'EXISTS' } : { action: 'CREATE', email };
    if (user.action === 'CREATE' && users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      user = { action: 'SKIP' };
      notes.push(`Login not created: ${email} is already used by another account`);
    }
    if (user.action === 'CREATE') notes.push('Login created switched off');

    if (c.employment_status === 'LEFT') {
      notes.push('Left the company: no assignment');
      return { case_id: c.case_id, name, employee, user, work: { action: 'NONE' }, notes };
    }

    const status = c.on_project ? 'PROJECT' : 'BENCH';
    const clientName = status === 'PROJECT' && !isInHouse(c.client_name) ? c.client_name : null;
    const vendorName = c.vendor_name || null;
    const fields = {
      status,
      job_title: c.job_title || undefined,
      lca_wage_cents: c.lca_wage_cents || undefined,
      lca_wage_unit: c.lca_wage_cents ? c.lca_wage_unit : undefined,
      ...parseLocation(c.lca_location, c.work_mode),
    };
    const cur = current.find((w) => w.employee_id === employee.employee_id);
    if (cur) {
      // Fill blanks only; never change status, client or dates of an assignment HR already keeps
      const blanks = Object.fromEntries(Object.entries(fields).filter(([k, v]) => k !== 'status' && v != null && (cur[k] == null || cur[k] === '')));
      if (blanks.lca_wage_cents && cur.lca_wage_unit) delete blanks.lca_wage_unit;
      if (!blanks.lca_wage_cents) delete blanks.lca_wage_unit;
      return { case_id: c.case_id, name, employee, user, work: { action: Object.keys(blanks).length ? 'FILL' : 'NONE', work_id: cur.work_id, fields: blanks }, notes };
    }
    notes.push(`${status === 'PROJECT' ? 'Project' : 'Bench'} start date set to today: HR to correct`);
    if (clientName && !clientBySquash.has(squash(clientName))) notes.push(`New client "${clientName}"`);
    if (vendorName && !vendorBySquash.has(squash(vendorName))) notes.push(`New vendor "${vendorName}"`);
    return { case_id: c.case_id, name, employee, user, work: { action: 'CREATE', fields, client_name: clientName, vendor_name: vendorName }, notes };
  });
}

function applySync(q, plan, employeeRoleId) {
  const ids = (table, idCol, nameCol) => {
    const cache = new Map(q(`SELECT ${idCol} AS id, ${nameCol} AS name FROM ${table}`).map((r) => [squash(r.name), r.id]));
    return (name) => {
      if (!name) return null;
      if (!cache.has(squash(name))) cache.set(squash(name), q(`INSERT INTO ${table} (${nameCol}) VALUES (?)`, [name]).insertId);
      return cache.get(squash(name));
    };
  };
  const clientId = ids('clients', 'client_id', 'client_name');
  const vendorId = ids('vendors', 'vendor_id', 'vendor_name');
  const set = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

  plan.filter((p) => !p.error).forEach((p) => {
    const { employee, user, work } = p;
    const c = q('SELECT first_name, last_name FROM h1b_cap_cases WHERE case_id = ?', [p.case_id])[0];
    if (employee.action === 'CREATE') {
      q('INSERT INTO emp (employee_id, first_name, last_name, hire_date, email) VALUES (?, ?, ?, ?, ?)',
        [employee.employee_id, c.first_name.trim(), c.last_name.trim(), employee.hire_date, employee.email]);
    }
    if (user.action === 'CREATE') {
      q(`INSERT INTO users (email, password_hash, full_name, role_id, employee_id, is_active) VALUES (?, 'CHANGE_ME', ?, ?, ?, 0)`,
        [user.email.toLowerCase(), `${c.first_name.trim()} ${c.last_name.trim()}`, employeeRoleId, employee.employee_id]);
    }
    q('UPDATE h1b_cap_cases SET employee_id = ? WHERE case_id = ?', [employee.employee_id, p.case_id]);
    if (work.action === 'NONE') return;

    if (work.action === 'FILL') {
      const data = set(work.fields);
      q(`UPDATE work SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')} WHERE work_id = ?`, [...Object.values(data), work.work_id]);
      return;
    }
    const data = set({ ...work.fields, client_id: work.client_name ? clientId(work.client_name) : undefined, vendor_id: work.vendor_name ? vendorId(work.vendor_name) : undefined });
    const row = { employee_id: employee.employee_id, start_date: today(), ...data };
    q(`INSERT INTO work (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`, Object.values(row));
  });
}

/** Plans and applies in one go (inside the caller's transaction). Returns the plan rows. */
function syncCases(q, { capYear, caseId } = {}) {
  const [role] = q("SELECT role_id FROM roles WHERE role_name = 'EMPLOYEE'");
  const plan = planSync(q, capYear, caseId);
  applySync(q, plan, role.role_id);
  return plan;
}

module.exports = { planSync, applySync, syncCases, parseLocation, PLACEHOLDER_DOMAIN };
