import { useState } from 'react';
import { api, fmtDate } from '../api';
import { DrillPanel, Loading, Stat, StatusPill, Table, useApi, useDrill } from '../components/ui';
import { CHANNELS, FollowUpBadge, SubmissionDetail, submissionColumns } from '../components/submissions';

// Local date (not UTC) as YYYY-MM-DD
const today = () => new Date().toLocaleDateString('en-CA');
const mondayOf = (d = new Date()) => {
  const m = new Date(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m.toISOString().slice(0, 10);
};

// Marketing agent: assigned employees, submissions, vendors, placements, weekly status
export default function Marketing() {
  const dash = useApi('/marketing/dashboard');
  const vendors = useApi('/vendors');
  const EMPTY_SUB = { employee_id: '', vendor_id: '', client_name: '', job_title: '', rate: '', position_ref: '', vendor_contact_name: '', channel: 'EMAIL', submitted_on: today() };
  const [sub, setSub] = useState(EMPTY_SUB);
  const [showSubmit, setShowSubmit] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [filter, setFilter] = useState('OPEN');
  const drill = useDrill();
  const [contact, setContact] = useState({ vendor_id: '', contacted_on: today(), notes: '' });
  const [weekly, setWeekly] = useState({ week_start: mondayOf(), summary: '' });
  const [error, setError] = useState('');

  const post = async (path, body, reset) => {
    setError('');
    try {
      await api(path, { method: 'POST', body });
      reset();
      dash.reload();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!dash.data) return <Loading {...dash} />;
  const d = dash.data;
  const subCols = submissionColumns(setOpenId);
  const DRILLS = {
    employees: { title: 'Employees assigned to me', rows: d.employees, columns: [
      { key: 'employee_name', label: 'Employee' },
      { key: 'job_title', label: 'Skill / title' },
      { key: 'current_status', label: 'Status', render: (r) => <StatusPill value={r.current_status || 'BENCH'} /> },
      { key: 'profiles_submitted', label: 'Profiles submitted' },
      { key: 'assigned_on', label: 'Assigned', render: (r) => fmtDate(r.assigned_on) },
    ] },
    submitted: { title: 'All my submissions', rows: d.submissions, columns: subCols },
    vendors: { title: 'Vendor contacts', rows: d.vendors_contacted, columns: [
      { key: 'contacted_on', label: 'Date', render: (r) => fmtDate(r.contacted_on) },
      { key: 'vendor_name', label: 'Vendor' },
      { key: 'contact_name', label: 'Contact' },
      { key: 'notes', label: 'Notes' },
    ] },
    placed: { title: 'Placements', rows: d.placed, columns: subCols },
    overdue: { title: 'Overdue follow-ups', rows: d.submissions.filter((r) => r.follow_up_state === 'OVERDUE'), columns: subCols },
    due: { title: 'Follow-ups due', rows: d.submissions.filter((r) => r.follow_up_state === 'DUE'), columns: subCols },
    requests: { title: 'Employee update requests', rows: d.submissions.filter((r) => r.open_update_request), columns: subCols },
  };
  const dr = drill.open && DRILLS[drill.open];
  const tile = (key) => ({ onClick: () => drill.toggle(key), active: drill.is(key) });

  return (
    <>
      <h2>My marketing</h2>
      <div className="stats">
        <Stat label="Employees assigned" value={d.summary.employees_assigned} {...tile('employees')} />
        <Stat label="Profiles submitted" value={d.summary.profiles_submitted} {...tile('submitted')} />
        <Stat label="Vendors contacted" value={d.summary.vendors_contacted} {...tile('vendors')} />
        <Stat label="Employees placed" value={d.summary.employees_placed} tone="good" {...tile('placed')} />
        <Stat label="Follow-ups overdue" value={d.summary.follow_ups_overdue} tone={d.summary.follow_ups_overdue ? 'bad' : ''} {...tile('overdue')} />
        <Stat label="Follow-ups due" value={d.summary.follow_ups_due} tone={d.summary.follow_ups_due ? 'warn' : ''} {...tile('due')} />
        <Stat label="Update requests" value={d.summary.open_update_requests} tone={d.summary.open_update_requests ? 'warn' : ''} {...tile('requests')} />
      </div>
      {dr && <DrillPanel title={dr.title} rows={dr.rows} columns={dr.columns} empty="Nothing here right now." onClose={drill.close} />}
      <p className="hint">Follow up with the vendor every {d.rules.due_days} business days. A submission with no activity for {d.rules.overdue_days} business days is overdue and is reported to the Marketing Manager.</p>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h3>Employees assigned to me</h3>
        <Table
          rows={d.employees}
          empty="No employees assigned yet. Ask HR to assign bench consultants."
          columns={[
            { key: 'employee_name', label: 'Employee' },
            { key: 'job_title', label: 'Skill / title' },
            { key: 'current_status', label: 'Status', render: (r) => <StatusPill value={r.current_status || 'BENCH'} /> },
            { key: 'profiles_submitted', label: 'Profiles submitted' },
            { key: 'interviews_pipeline', label: 'Interviews in pipeline' },
            { key: 'interviews_awaiting', label: 'Awaiting result' },
            { key: 'assigned_on', label: 'Assigned', render: (r) => fmtDate(r.assigned_on) },
          ]}
        />
      </section>

      <section className="card">
        <div className="page-head">
          <h3>Submissions &amp; follow-ups</h3>
          <div className="actions">
            <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="OPEN">Open</option>
              <option value="ATTENTION">Needs attention</option>
              <option value="ALL">All</option>
            </select>
            <button onClick={() => setShowSubmit(!showSubmit)}>{showSubmit ? 'Close' : 'Submit a profile'}</button>
          </div>
        </div>
        {showSubmit && (
          <form className="form-grid inset" onSubmit={(e) => { e.preventDefault(); post('/marketing/submissions', sub, () => { setSub(EMPTY_SUB); setShowSubmit(false); }); }}>
            <div className="field"><label htmlFor="s-emp">Employee *</label>
              <select id="s-emp" value={sub.employee_id} onChange={(e) => setSub({ ...sub, employee_id: e.target.value })} required>
                <option value="">Choose…</option>{d.employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.employee_name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="s-vendor">Vendor</label>
              <select id="s-vendor" value={sub.vendor_id} onChange={(e) => setSub({ ...sub, vendor_id: e.target.value })}>
                <option value="">—</option>{vendors.data?.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="s-contact">Vendor contact</label><input id="s-contact" value={sub.vendor_contact_name} onChange={(e) => setSub({ ...sub, vendor_contact_name: e.target.value })} placeholder="Recruiter name" /></div>
            <div className="field"><label htmlFor="s-channel">Submitted via</label>
              <select id="s-channel" value={sub.channel} onChange={(e) => setSub({ ...sub, channel: e.target.value })}>
                {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div className="field"><label htmlFor="s-client">End client</label><input id="s-client" value={sub.client_name} onChange={(e) => setSub({ ...sub, client_name: e.target.value })} /></div>
            <div className="field"><label htmlFor="s-title">Job title</label><input id="s-title" value={sub.job_title} onChange={(e) => setSub({ ...sub, job_title: e.target.value })} /></div>
            <div className="field"><label htmlFor="s-ref">Position / req ID</label><input id="s-ref" value={sub.position_ref} onChange={(e) => setSub({ ...sub, position_ref: e.target.value })} /></div>
            <div className="field"><label htmlFor="s-rate">Rate (internal)</label><input id="s-rate" value={sub.rate} onChange={(e) => setSub({ ...sub, rate: e.target.value })} placeholder="$70/hr" /></div>
            <div className="field"><label htmlFor="s-date">Submitted on</label><input id="s-date" type="date" value={sub.submitted_on} onChange={(e) => setSub({ ...sub, submitted_on: e.target.value })} /></div>
            <div className="actions wide"><button type="submit">Save submission</button></div>
          </form>
        )}
        <Table
          rows={d.submissions.filter((r) => filter === 'ALL'
            || (filter === 'OPEN' && r.follow_up_state !== 'CLOSED')
            || (filter === 'ATTENTION' && (['OVERDUE', 'DUE'].includes(r.follow_up_state) || r.open_update_request)))}
          empty={filter === 'ATTENTION' ? 'Nothing needs attention. All follow-ups are on schedule.' : 'No submissions.'}
          columns={[
            { key: 'employee_name', label: 'Employee', render: (r) => (
              <>{r.employee_name}{r.open_update_request ? <div><span className="pill warning">Update requested</span></div> : null}</>) },
            { key: 'job_title', label: 'Role' },
            { key: 'vendor', label: 'Vendor / client', render: (r) => [r.vendor_name, r.client_name].filter(Boolean).join(' / ') || '—' },
            { key: 'status', label: 'Stage', render: (r) => <StatusPill value={r.status} /> },
            { key: 'last_activity_on', label: 'Last activity', render: (r) => fmtDate(r.last_activity_on) },
            { key: 'fu', label: 'Follow-up', render: (r) => <FollowUpBadge row={r} /> },
            { key: 'x', label: '', render: (r) => <button className="link" onClick={() => setOpenId(r.submission_id)}>{openId === r.submission_id ? 'Open ↓' : 'Open'}</button> },
          ]}
        />
      </section>

      {openId && <SubmissionDetail key={openId} id={openId} mode="agent" onClose={() => setOpenId(null)} onChanged={dash.reload} />}

      <div className="grid-2">
        <section className="card">
          <h3>Vendors contacted</h3>
          <form className="form-grid inset" onSubmit={(e) => { e.preventDefault(); post('/marketing/vendor-contacts', contact, () => setContact({ ...contact, notes: '' })); }}>
            <div className="field"><label htmlFor="c-vendor">Vendor *</label>
              <select id="c-vendor" value={contact.vendor_id} onChange={(e) => setContact({ ...contact, vendor_id: e.target.value })} required>
                <option value="">Choose…</option>{vendors.data?.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="c-date">Date</label><input id="c-date" type="date" value={contact.contacted_on} onChange={(e) => setContact({ ...contact, contacted_on: e.target.value })} /></div>
            <div className="field wide"><label htmlFor="c-notes">Notes</label><input id="c-notes" value={contact.notes} onChange={(e) => setContact({ ...contact, notes: e.target.value })} /></div>
            <div className="actions wide"><button type="submit">Log contact</button></div>
          </form>
          <Table rows={d.vendors_contacted} columns={[
            { key: 'contacted_on', label: 'Date', render: (r) => fmtDate(r.contacted_on) },
            { key: 'vendor_name', label: 'Vendor' },
            { key: 'contact_name', label: 'Contact' },
            { key: 'notes', label: 'Notes' },
          ]} />
        </section>

        <section className="card">
          <h3>Weekly status</h3>
          <form className="form-grid inset" onSubmit={(e) => { e.preventDefault(); post('/marketing/weekly-status', weekly, () => setWeekly({ ...weekly, summary: '' })); }}>
            <div className="field"><label htmlFor="w-week">Week starting</label><input id="w-week" type="date" value={weekly.week_start} onChange={(e) => setWeekly({ ...weekly, week_start: e.target.value })} /></div>
            <div className="field wide"><label htmlFor="w-sum">Summary *</label><textarea id="w-sum" rows={3} value={weekly.summary} onChange={(e) => setWeekly({ ...weekly, summary: e.target.value })} required /></div>
            <div className="actions wide"><button type="submit">Save weekly status</button></div>
          </form>
          <Table rows={d.weekly_status} columns={[
            { key: 'week_start', label: 'Week of', render: (r) => fmtDate(r.week_start) },
            { key: 'summary', label: 'Summary' },
          ]} />
          <h3>Placed by me</h3>
          <Table rows={d.placed} empty="No placements yet." columns={[
            { key: 'employee_name', label: 'Employee' }, { key: 'client_name', label: 'Client' }, { key: 'submitted_on', label: 'Submitted', render: (r) => fmtDate(r.submitted_on) },
          ]} />
        </section>
      </div>
    </>
  );
}
