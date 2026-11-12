import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { fmtDate, fmtMoney, fmtRate } from '../api';
import { DaysLeft, Loading, StatusPill, Table, useApi } from '../components/ui';

const FINANCE = ['HR', 'CEO', 'ADMIN'];
const uniq = (rows, key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort();
const name = (e) => `${e.first_name} ${e.last_name}`;

// Every filter lives in the URL (?status=BENCH&client=...), so a filtered list can be bookmarked or shared.
const FILTERS = ['q', 'status', 'client', 'vendor', 'visa', 'state', 'expiring', 'agent'];

function matches(e, f) {
  const q = (f.q || '').trim().toLowerCase();
  if (q && ![e.employee_id, e.first_name, e.last_name, name(e), e.email, e.phone_number, e.job_title, e.bio,
    e.client_name, e.vendor_name, e.project_name, e.city].some((v) => String(v || '').toLowerCase().includes(q))) return false;
  if (f.status && (e.current_status || 'BENCH') !== f.status) return false;
  if (f.client && (f.client === '__none' ? e.client_name : e.client_name !== f.client)) return false;
  if (f.vendor && (f.vendor === '__none' ? e.vendor_name : e.vendor_name !== f.vendor)) return false;
  if (f.visa && (f.visa === '__none' ? e.visa_type : e.visa_type !== f.visa)) return false;
  if (f.state && e.state !== f.state) return false;
  if (f.expiring && !(e.visa_days_left != null && e.visa_days_left <= Number(f.expiring))) return false;
  if (f.agent && (f.agent === '__none' ? e.marketing_agent : e.marketing_agent !== f.agent)) return false;
  return true;
}

function toCsv(rows, finance) {
  const cols = [
    ['Employee ID', (e) => e.employee_id], ['Name', name], ['Email', (e) => e.email], ['Phone', (e) => e.phone_number],
    ['Status', (e) => e.current_status || 'BENCH'], ['Title', (e) => e.job_title], ['Client', (e) => e.client_name],
    ['Vendor', (e) => e.vendor_name], ['Project', (e) => e.project_name], ['City', (e) => e.city], ['State', (e) => e.state],
    ['Visa', (e) => e.visa_type], ['Visa expiry', (e) => e.visa_expiry], ['LCA expiry', (e) => e.lca_expiry_date],
    ['Marketing agent', (e) => e.marketing_agent], ['Hire date', (e) => e.hire_date],
    ...(finance ? [['Bill rate', (e) => (e.bill_rate_cents ? (e.bill_rate_cents / 100).toFixed(2) : '')], ['Rate unit', (e) => e.rate_unit],
      ['Balance owed', (e) => (e.balance_cents ? (e.balance_cents / 100).toFixed(2) : '')]] : []),
  ];
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [cols.map(([h]) => esc(h)).join(','), ...rows.map((r) => cols.map(([, fn]) => esc(fn(r))).join(','))].join('\n');
}

export default function Employees() {
  const { user } = useAuth();
  const list = useApi('/employees');
  const [params, setParams] = useSearchParams();
  const canEdit = ['HR', 'ADMIN'].includes(user.role);
  const finance = FINANCE.includes(user.role);

  const f = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) || '']));
  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const all = list.data || [];
  const rows = useMemo(() => all.filter((e) => matches(e, f)), [all, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = FILTERS.filter((k) => f[k]);

  const download = () => {
    const blob = new Blob([toCsv(rows, finance)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `employees-${new Date().toLocaleDateString('en-CA')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Quick status chips with live counts (ignoring the status filter itself)
  const base = all.filter((e) => matches(e, { ...f, status: '' }));
  const chip = (value, label) => (
    <button type="button" className={`chip ${f.status === value ? 'on' : ''}`} onClick={() => setFilter('status', value)} aria-pressed={f.status === value}>
      {label} <span className="chip-count">{value ? base.filter((e) => (e.current_status || 'BENCH') === value).length : base.length}</span>
    </button>
  );
  const select = (key, label, options, extra = []) => (
    <div className="field">
      <label htmlFor={`f-${key}`}>{label}</label>
      <select id={`f-${key}`} value={f[key]} onChange={(e) => setFilter(key, e.target.value)}>
        <option value="">All</option>
        {extra.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <h2>Employees</h2>
        <div className="actions">
          <button className="secondary" onClick={download} disabled={!rows.length}>Export CSV</button>
          {canEdit && <Link className="button secondary" to="/import?type=EMPLOYEES">Import from Excel</Link>}
          {canEdit && <Link className="button" to="/employees/new">Add employee</Link>}
        </div>
      </div>

      <section className="card filter-card">
        <input id="emp-search" className="search wide-search" type="search" placeholder="Search name, ID, email, phone, skill, client, vendor, project, city…"
          value={f.q} onChange={(e) => setFilter('q', e.target.value)} aria-label="Search employees" />
        <div className="chips">
          {chip('', 'All')}
          {chip('PROJECT', 'On project')}
          {chip('BENCH', 'On bench')}
        </div>
        <div className="filter-grid">
          {select('client', 'Client', uniq(all, 'client_name'), [['__none', '— No client —']])}
          {select('vendor', 'Vendor', uniq(all, 'vendor_name'), [['__none', '— Direct / none —']])}
          {select('visa', 'Visa type', uniq(all, 'visa_type'), [['__none', '— No visa record —']])}
          {select('state', 'Work state', uniq(all, 'state'))}
          <div className="field">
            <label htmlFor="f-expiring">Visa / LCA expiring</label>
            <select id="f-expiring" value={f.expiring} onChange={(e) => setFilter('expiring', e.target.value)}>
              <option value="">Any time</option>
              <option value="30">Within 30 days</option>
              <option value="90">Within 90 days</option>
              <option value="180">Within 180 days</option>
            </select>
          </div>
          {select('agent', 'Marketing agent', uniq(all, 'marketing_agent'), [['__none', '— Not assigned —']])}
        </div>
        <div className="filter-foot">
          <span className="muted">Showing <strong>{rows.length}</strong> of {all.length} employees</span>
          {active.length > 0 && <button className="link" onClick={() => setParams({}, { replace: true })}>Clear {active.length} filter{active.length > 1 ? 's' : ''}</button>}
        </div>
      </section>

      <Loading {...list} />
      <section className="card">
        <Table
          rows={rows}
          empty="No employees match these filters."
          columns={[
            { key: 'employee_id', label: 'Employee', render: (r) => (
              <><Link to={`/employees/${r.employee_id}`}><strong>{name(r)}</strong></Link>
                <div className="muted small">{r.employee_id}{r.job_title ? ` · ${r.job_title}` : ''}</div></>) },
            { key: 'current_status', label: 'Status', render: (r) => <StatusPill value={r.current_status || 'BENCH'} /> },
            { key: 'client_name', label: 'Client', render: (r) => (r.client_name
              ? <>{r.client_name}{r.project_name ? <div className="muted small">{r.project_name}</div> : null}</> : <span className="muted">—</span>) },
            { key: 'vendor_name', label: 'Vendor', render: (r) => r.vendor_name || <span className="muted">{r.client_name ? 'Direct' : '—'}</span> },
            { key: 'loc', label: 'Location', render: (r) => [r.city, r.state].filter(Boolean).join(', ') || '—' },
            { key: 'visa', label: 'Visa', render: (r) => (r.visa_type
              ? <>{r.visa_type} <DaysLeft days={r.visa_days_left} /></> : <span className="muted">—</span>) },
            { key: 'marketing_agent', label: 'Marketing agent', render: (r) => r.marketing_agent || <span className="muted">—</span> },
            ...(finance ? [
              { key: 'bill_rate_cents', label: 'Bill rate', render: (r) => (r.bill_rate_cents ? <span className="num">{fmtRate(r.bill_rate_cents, r.rate_unit)}</span> : <span className="muted">—</span>) },
              { key: 'balance_cents', label: 'Balance owed', render: (r) => (r.balance_cents ? <span className="num strong">{fmtMoney(r.balance_cents)}</span> : <span className="muted">—</span>) },
            ] : []),
            { key: 'hire_date', label: 'Hired', render: (r) => fmtDate(r.hire_date) },
          ]}
        />
      </section>
    </>
  );
}
