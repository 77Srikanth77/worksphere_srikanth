import { useState } from 'react';
import { api, fmtDate } from '../api';
import { Loading, Stat, StatusPill, Table, useApi } from '../components/ui';

const SUB_STATUSES = ['SUBMITTED', 'SHORTLISTED', 'REJECTED', 'PLACED'];
const today = () => new Date().toISOString().slice(0, 10);
const mondayOf = (d = new Date()) => {
  const m = new Date(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m.toISOString().slice(0, 10);
};

// Marketing agent: assigned employees, submissions, vendors, placements, weekly status
export default function Marketing() {
  const dash = useApi('/marketing/dashboard');
  const vendors = useApi('/vendors');
  const [sub, setSub] = useState({ employee_id: '', vendor_id: '', client_name: '', job_title: '', rate: '', submitted_on: today() });
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

  const changeStatus = async (id, status) => {
    await api(`/marketing/submissions/${id}`, { method: 'PATCH', body: { status } });
    dash.reload();
  };

  if (!dash.data) return <Loading {...dash} />;
  const d = dash.data;

  return (
    <>
      <h2>My marketing</h2>
      <div className="stats">
        <Stat label="Employees assigned" value={d.summary.employees_assigned} />
        <Stat label="Profiles submitted" value={d.summary.profiles_submitted} />
        <Stat label="Vendors contacted" value={d.summary.vendors_contacted} />
        <Stat label="Employees placed" value={d.summary.employees_placed} tone="good" />
      </div>
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
        <h3>Submit a profile</h3>
        <form className="form-grid inset" onSubmit={(e) => { e.preventDefault(); post('/marketing/submissions', sub, () => setSub({ ...sub, client_name: '', job_title: '', rate: '' })); }}>
          <div className="field"><label htmlFor="s-emp">Employee *</label>
            <select id="s-emp" value={sub.employee_id} onChange={(e) => setSub({ ...sub, employee_id: e.target.value })} required>
              <option value="">Choose…</option>{d.employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.employee_name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="s-vendor">Vendor</label>
            <select id="s-vendor" value={sub.vendor_id} onChange={(e) => setSub({ ...sub, vendor_id: e.target.value })}>
              <option value="">—</option>{vendors.data?.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="s-client">End client</label><input id="s-client" value={sub.client_name} onChange={(e) => setSub({ ...sub, client_name: e.target.value })} /></div>
          <div className="field"><label htmlFor="s-title">Job title</label><input id="s-title" value={sub.job_title} onChange={(e) => setSub({ ...sub, job_title: e.target.value })} /></div>
          <div className="field"><label htmlFor="s-rate">Rate</label><input id="s-rate" value={sub.rate} onChange={(e) => setSub({ ...sub, rate: e.target.value })} placeholder="$70/hr" /></div>
          <div className="field"><label htmlFor="s-date">Submitted on</label><input id="s-date" type="date" value={sub.submitted_on} onChange={(e) => setSub({ ...sub, submitted_on: e.target.value })} /></div>
          <div className="actions wide"><button type="submit">Save submission</button></div>
        </form>
        <Table
          rows={d.submissions}
          columns={[
            { key: 'submitted_on', label: 'Date', render: (r) => fmtDate(r.submitted_on) },
            { key: 'employee_name', label: 'Employee' },
            { key: 'vendor_name', label: 'Vendor' },
            { key: 'client_name', label: 'Client' },
            { key: 'job_title', label: 'Role' },
            { key: 'rate', label: 'Rate' },
            { key: 'status', label: 'Status', render: (r) => (
              <select aria-label="Submission status" value={r.status} onChange={(e) => changeStatus(r.submission_id, e.target.value)}>
                {SUB_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>) },
          ]}
        />
      </section>

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
