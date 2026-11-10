import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, fmtDate } from '../api';
import { DrillPanel, Loading, Stat, StatusPill, Table, useApi, useDrill } from '../components/ui';
import TimesheetFiles from '../components/TimesheetFiles';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const short = (d) => new Date(`${d}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
const weekLabel = (m) => `${short(m)} – ${short(addDays(m, 6))}`;
const today = () => new Date().toLocaleDateString('en-CA');
const monthStart = () => `${today().slice(0, 7)}-01`;
const monthEnd = () => { const x = new Date(); return new Date(x.getFullYear(), x.getMonth() + 1, 0).toLocaleDateString('en-CA'); };

/** Mon..Sun hours inline */
function DayHours({ t }) {
  return (
    <span className="day-hours">
      {DOW.map((d, i) => {
        const h = t.entries?.[addDays(t.week_start, i)];
        return <span key={d} className={i > 4 ? 'weekend' : ''} title={`${d} ${short(addDays(t.week_start, i))}`}>{d[0]}<b>{h ?? '·'}</b></span>;
      })}
    </span>
  );
}

function csv(rows, cols) {
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [cols.map(([h]) => esc(h)).join(','), ...rows.map((r) => cols.map(([, f]) => esc(f(r))).join(','))].join('\n');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// HR / CEO: approve timesheets, chase missing weeks, and pull approved hours for payroll and billing
export default function Timesheets() {
  const { user } = useAuth();
  const canApprove = ['HR', 'ADMIN'].includes(user.role);
  const summary = useApi('/timesheets/summary');
  const all = useApi('/timesheets');
  const missing = useApi('/timesheets/missing');
  const drill = useDrill();
  const [message, setMessage] = useState('');
  const [sendBack, setSendBack] = useState(null); // { t, note }
  const [statusFilter, setStatusFilter] = useState('');
  const [empFilter, setEmpFilter] = useState('');
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const report = useApi(`/timesheets/hours?from=${range.from}&to=${range.to}`);

  const reload = (msg) => {
    if (msg) setMessage(msg);
    summary.reload(); all.reload(); missing.reload(); report.reload();
  };
  const approve = async (t) => {
    try {
      await api(`/timesheets/${t.timesheet_id}/approve`, { method: 'POST' });
      reload(`Approved ${t.employee_name}'s week of ${short(t.week_start)} (${t.total_hours} h).`);
    } catch (e) { setMessage(e.message); }
  };
  const sendReminders = async () => {
    if (!window.confirm('Email every employee who has missing timesheets now? (This also runs automatically every Friday afternoon.)')) return;
    try {
      const r = await api('/reports/timesheet-reminders/run', { method: 'POST' });
      setMessage(`Reminders sent to ${r.emailed} employee(s): ${r.weeks_missing} week(s) not submitted, ${r.weeks_missing_client_copy} missing the client copy.`
        + (r.without_login.length ? ` No login (not reminded): ${r.without_login.join(', ')}.` : ''));
    } catch (e) { setMessage(e.message); }
  };
  const copyMissing = (t) => Boolean(t.client_timesheet_required) && !t.attachments?.length;
  const approveAll = async (rows) => {
    const ready = rows.filter((t) => !copyMissing(t));
    const skipped = rows.length - ready.length;
    if (!window.confirm(`Approve ${ready.length} submitted timesheet(s)?${skipped ? ` ${skipped} will be skipped because the client-approved copy is missing.` : ''}`)) return;
    for (const t of ready) {
      try { await api(`/timesheets/${t.timesheet_id}/approve`, { method: 'POST' }); } catch { /* keep going */ }
    }
    reload(`Approved ${ready.length} timesheet(s).${skipped ? ` Skipped ${skipped} without the client copy.` : ''}`);
  };
  const submitSendBack = async (e) => {
    e.preventDefault();
    try {
      await api(`/timesheets/${sendBack.t.timesheet_id}/reject`, { method: 'POST', body: { note: sendBack.note } });
      setSendBack(null);
      reload(`Sent ${sendBack.t.employee_name}'s week of ${short(sendBack.t.week_start)} back with your note.`);
    } catch (err) { setSendBack({ ...sendBack, error: err.message }); }
  };

  const rows = all.data || [];
  const employees = useMemo(() => [...new Map(rows.map((t) => [t.employee_id, t.employee_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  if (!summary.data) return <Loading {...summary} />;
  const s = summary.data;
  const pending = rows.filter((t) => t.status === 'SUBMITTED');
  const filtered = rows.filter((t) => (!statusFilter || t.status === statusFilter) && (!empFilter || t.employee_id === empFilter));

  const TS_COLUMNS = [
    { key: 'employee_name', label: 'Employee', render: (t) => <Link to={`/employees/${t.employee_id}`}>{t.employee_name}</Link> },
    { key: 'client', label: 'Client / vendor', render: (t) => <>{t.client_name || '—'}{t.vendor_name ? <div className="muted small">via {t.vendor_name}</div> : null}</> },
    { key: 'week_start', label: 'Week', render: (t) => weekLabel(t.week_start) },
    { key: 'days', label: 'Daily hours', render: (t) => <DayHours t={t} /> },
    { key: 'total_hours', label: 'Total', render: (t) => <span className="num strong">{t.total_hours}</span> },
    { key: 'note', label: 'Notes', render: (t) => <>{t.employee_note ? <div>“{t.employee_note}”</div> : null}{t.review_note ? <div className="error small">HR: {t.review_note}</div> : null}{!t.employee_note && !t.review_note ? '—' : null}</> },
    { key: 'files', label: 'Client copy', render: (t) => (
      <TimesheetFiles compact files={t.attachments} required={Boolean(t.client_timesheet_required)}
        canUpload={canApprove} canDelete={() => canApprove} ensureId={async () => t.timesheet_id} onChange={() => reload()} />) },
    { key: 'status', label: 'Status', render: (t) => <StatusPill value={t.status} /> },
    ...(canApprove ? [{ key: 'x', label: '', render: (t) => (
      <div className="row-actions">
        {t.status === 'SUBMITTED' && (copyMissing(t)
          ? <span className="muted small" title="Attach the client-approved timesheet first">Needs client copy</span>
          : <button className="link" onClick={() => approve(t)}>Approve</button>)}
        {['SUBMITTED', 'APPROVED'].includes(t.status) && <button className="link danger" onClick={() => setSendBack({ t, note: '' })}>Send back</button>}
      </div>) }] : []),
  ];
  const MISSING_COLUMNS = [
    { key: 'employee_name', label: 'Employee', render: (m) => <Link to={`/employees/${m.employee_id}`}>{m.employee_name}</Link> },
    { key: 'client_name', label: 'Client', render: (m) => m.client_name || '—' },
    { key: 'week_start', label: 'Week', render: (m) => weekLabel(m.week_start) },
    { key: 'status', label: 'State', render: (m) => <StatusPill value={m.status} /> },
  ];
  const DRILLS = {
    pending: { title: 'Waiting for your approval', rows: pending, columns: TS_COLUMNS },
    missing: { title: `Weeks not submitted (last 8 weeks)`, rows: missing.data, columns: MISSING_COLUMNS },
    rejected: { title: 'Sent back, waiting for the employee', rows: rows.filter((t) => t.status === 'REJECTED'), columns: TS_COLUMNS },
    approved: {
      title: `Approved timesheets with hours this month`,
      rows: rows.filter((t) => t.status === 'APPROVED' && addDays(t.week_start, 6) >= s.month_start), columns: TS_COLUMNS,
    },
  };
  const tile = (key) => ({ onClick: () => drill.toggle(key), active: drill.is(key) });
  const rep = report.data || [];
  const sum = (k) => rep.reduce((t, r) => t + r[k], 0);

  return (
    <>
      <div className="page-head">
        <h2>Timesheets</h2>
        {canApprove && <button className="secondary" onClick={sendReminders}>Send reminders now</button>}
      </div>
      <p className="hint">Employees with missing timesheets get a reminder email every Friday afternoon.</p>
      {message && <p className="notice-box">{message}</p>}
      <div className="stats">
        <Stat label="Waiting for approval" value={s.pending} tone={s.pending ? 'warn' : 'good'} {...tile('pending')} />
        <Stat label="Weeks not submitted" value={s.missing} tone={s.missing ? 'bad' : 'good'} {...tile('missing')} />
        <Stat label="Sent back to employee" value={s.rejected} tone={s.rejected ? 'warn' : ''} {...tile('rejected')} />
        <Stat label="Approved hours this month" value={s.approved_hours_month} tone="good" {...tile('approved')} />
      </div>
      {DRILLS[drill.open] && (
        <DrillPanel title={DRILLS[drill.open].title} rows={DRILLS[drill.open].rows} columns={DRILLS[drill.open].columns}
          empty="Nothing here." onClose={drill.close} />
      )}

      {sendBack && (
        <section className="card drill">
          <div className="page-head">
            <h3>Send back · {sendBack.t.employee_name} · {weekLabel(sendBack.t.week_start)} ({sendBack.t.total_hours} h)</h3>
            <button className="link" onClick={() => setSendBack(null)}>Cancel</button>
          </div>
          <form onSubmit={submitSendBack} className="stack">
            <label htmlFor="sb-note">What should the employee fix? *</label>
            <input id="sb-note" value={sendBack.note} onChange={(e) => setSendBack({ ...sendBack, note: e.target.value })} required autoFocus
              placeholder="e.g. Thursday should be 6 hours per the client portal" />
            {sendBack.error && <p className="error">{sendBack.error}</p>}
            <div><button type="submit">Send back</button></div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="page-head">
          <h3>Waiting for approval <span className="muted">· {pending.length}</span></h3>
          {canApprove && pending.length > 1 && <button className="secondary" onClick={() => approveAll(pending)}>Approve all {pending.length}</button>}
        </div>
        <Loading {...all} />
        {all.data && <Table rows={pending} empty="Nothing waiting. All submitted timesheets are reviewed." columns={TS_COLUMNS} />}
      </section>

      <section className="card">
        <div className="page-head">
          <h3>Hours report <span className="muted">· approved hours for payroll and billing</span></h3>
          <div className="filters">
            <input type="date" aria-label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <input type="date" aria-label="To" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            <button className="secondary" disabled={!rep.length} onClick={() => download(`hours-${range.from}-to-${range.to}.csv`, csv(rep, [
              ['Employee ID', (r) => r.employee_id], ['Employee', (r) => r.employee_name], ['Client', (r) => r.client_name],
              ['Vendor', (r) => r.vendor_name], ['Project', (r) => r.project_name], ['Approved hours', (r) => r.approved_hours],
              ['Days worked', (r) => r.approved_days], ['Pending approval', (r) => r.pending_hours], ['Not submitted', (r) => r.unsubmitted_hours],
              ['Weeks missing client copy', (r) => (r.client_timesheet_required ? r.weeks_missing_client_copy : 'n/a')],
            ]))}>Export CSV</button>
          </div>
        </div>
        <p className="hint">Hours are counted per day, so a range like a calendar month includes the right days of weeks that cross the month boundary. Only approved hours should be paid or billed.</p>
        <Loading {...report} />
        {report.data && (
          <Table rows={rep} empty="No hours recorded in this range." columns={[
            { key: 'employee_name', label: 'Employee', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> },
            { key: 'client_name', label: 'Client / vendor', render: (r) => <>{r.client_name || '—'}{r.vendor_name ? <div className="muted small">via {r.vendor_name}</div> : null}</> },
            { key: 'approved_hours', label: 'Approved hours', render: (r) => <span className="num strong">{r.approved_hours}</span> },
            { key: 'approved_days', label: 'Days worked', render: (r) => <span className="num">{r.approved_days}</span> },
            { key: 'pending_hours', label: 'Pending approval', render: (r) => (r.pending_hours ? <span className="pill warning">{r.pending_hours} h</span> : '—') },
            { key: 'unsubmitted_hours', label: 'Not submitted', render: (r) => (r.unsubmitted_hours ? <span className="pill critical">{r.unsubmitted_hours} h</span> : '—') },
            { key: 'weeks_missing_client_copy', label: 'Client copy', render: (r) => (!r.client_timesheet_required ? <span className="muted">Not required</span>
              : r.weeks_missing_client_copy ? <span className="pill critical">{r.weeks_missing_client_copy} week(s) missing</span> : <span className="pill ok">All attached</span>) },
          ]} />
        )}
        {rep.length > 0 && <p className="muted">Total approved: <strong>{sum('approved_hours')} h</strong>{sum('pending_hours') ? ` · ${sum('pending_hours')} h still pending approval` : ''}</p>}
      </section>

      <section className="card">
        <div className="page-head">
          <h3>Weeks not submitted <span className="muted">· last 8 weeks</span></h3>
        </div>
        <Loading {...missing} />
        {missing.data && <Table rows={missing.data} empty="Everyone on a project has submitted." columns={MISSING_COLUMNS} />}
      </section>

      <section className="card">
        <div className="page-head">
          <h3>All timesheets <span className="muted">· {filtered.length}</span></h3>
          <div className="filters">
            <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="SUBMITTED">Waiting for approval</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Sent back</option>
              <option value="DRAFT">Draft</option>
            </select>
            <select aria-label="Employee" value={empFilter} onChange={(e) => setEmpFilter(e.target.value)}>
              <option value="">All employees</option>
              {employees.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </div>
        </div>
        {all.data && <Table rows={filtered} empty="No timesheets match." columns={TS_COLUMNS} />}
      </section>
    </>
  );
}
