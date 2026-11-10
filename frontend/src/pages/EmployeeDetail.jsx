import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, fmtDate } from '../api';
import { DaysLeft, Loading, StatusPill, Table, useApi } from '../components/ui';

const EMPTY_WORK = {
  status: 'PROJECT', client_id: '', vendor_id: '', project_name: '', job_title: '', job_duties: '',
  work_location: '', city: '', state: '', start_date: '', end_date: '',
};

/** Current marketing agent + history. HR / CEO / ADMIN can assign, change or end it. */
function MarketingAgentCard({ employeeId, assignments, onChange }) {
  const { user } = useAuth();
  const canAssign = ['HR', 'CEO', 'ADMIN'].includes(user.role);
  const agents = useApi(canAssign ? '/marketing/agents' : null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ agent_user_id: '', assigned_on: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const current = assignments.find((a) => a.is_active);

  const assign = async (ev) => {
    ev.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api('/marketing/assignments', {
        method: 'POST',
        body: { employee_id: employeeId, agent_user_id: Number(form.agent_user_id), assigned_on: form.assigned_on || undefined },
      });
      setForm({ agent_user_id: '', assigned_on: '' });
      setOpen(false);
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const end = async () => {
    if (!window.confirm(`End ${current.agent_name}'s marketing assignment?`)) return;
    setError('');
    try {
      await api(`/marketing/assignments/${current.assignment_id}/end`, { method: 'PATCH' });
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card">
      <div className="page-head">
        <h3>Marketing agent</h3>
        {canAssign && (
          <div className="actions">
            {current && <button className="secondary" onClick={end}>End assignment</button>}
            <button className="secondary" onClick={() => { setOpen(!open); setError(''); }}>
              {open ? 'Close' : current ? 'Change agent' : 'Assign agent'}
            </button>
          </div>
        )}
      </div>

      {open && (
        <form className="form-grid inset" onSubmit={assign} style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor="m-agent">Agent *</label>
            <select id="m-agent" value={form.agent_user_id} onChange={(ev) => setForm({ ...form, agent_user_id: ev.target.value })} required>
              <option value="">Select agent…</option>
              {agents.data?.filter((a) => a.user_id !== current?.agent_user_id)
                .map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name} · {a.email}</option>)}
            </select>
            {agents.data && !agents.data.length && <p className="hint">No marketing agents yet. An admin can create one on the Users page.</p>}
          </div>
          <div className="field"><label htmlFor="m-date">Assigned on</label>
            <input id="m-date" type="date" value={form.assigned_on} onChange={(ev) => setForm({ ...form, assigned_on: ev.target.value })} />
            <p className="hint">Defaults to today.</p></div>
          {current && <p className="hint wide">This replaces {current.agent_name} as the active agent.</p>}
          <div className="actions wide"><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
        </form>
      )}

      {error && <p className="error">{error}</p>}
      <p style={{ margin: '12px 0' }}>
        {current
          ? <>Currently with <strong>{current.agent_name}</strong> <span className="muted">({current.agent_email}) since {fmtDate(current.assigned_on)}</span></>
          : <span className="muted">Not assigned to a marketing agent.</span>}
      </p>
      {assignments.some((a) => !a.is_active) && (
        <Table
          rows={assignments.filter((a) => !a.is_active)}
          columns={[
            { key: 'agent_name', label: 'Past agent' },
            { key: 'assigned_on', label: 'Assigned on', render: (r) => fmtDate(r.assigned_on) },
          ]}
        />
      )}
    </section>
  );
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const emp = useApi(`/employees/${id}`);
  const canEdit = ['HR', 'ADMIN'].includes(user.role);
  const clients = useApi(canEdit ? '/clients' : null);
  const vendors = useApi(canEdit ? '/vendors' : null);
  const [work, setWork] = useState(EMPTY_WORK);
  const [showWork, setShowWork] = useState(false);
  const [error, setError] = useState('');

  const saveWork = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/work', { method: 'POST', body: { ...work, employee_id: id } });
      setWork(EMPTY_WORK);
      setShowWork(false);
      emp.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const endAssignment = async (workId) => {
    await api(`/work/${workId}`, { method: 'PUT', body: { end_date: new Date().toISOString().slice(0, 10) } });
    emp.reload();
  };

  if (!emp.data) return <Loading {...emp} />;
  const e = emp.data;
  const setW = (k) => (ev) => setWork({ ...work, [k]: ev.target.value });

  return (
    <>
      <div className="page-head">
        <h2>{e.first_name} {e.middle_name} {e.last_name} <span className="muted">· {e.employee_id}</span></h2>
        {canEdit && <Link className="button secondary" to={`/employees/${id}/edit`}>Edit details</Link>}
      </div>

      <section className="card details">
        <div><span>Email</span>{e.email}</div>
        <div><span>Phone</span>{e.phone_number || '—'}</div>
        <div><span>Hire date</span>{fmtDate(e.hire_date)}</div>
        <div><span>Date of birth</span>{fmtDate(e.date_of_birth)}</div>
        <div><span>Emergency contact</span>{e.emergency_contact_name || '—'} {e.emergency_contact_number}</div>
        <div className="wide"><span>Bio</span>{e.bio || '—'}</div>
      </section>

      <section className="card">
        <div className="page-head">
          <h3>Work history</h3>
          {canEdit && <button className="secondary" onClick={() => setShowWork(!showWork)}>{showWork ? 'Close' : 'Add assignment'}</button>}
        </div>
        {showWork && (
          <form className="form-grid inset" onSubmit={saveWork}>
            <div className="field"><label htmlFor="w-status">Status</label>
              <select id="w-status" value={work.status} onChange={setW('status')}><option>PROJECT</option><option>BENCH</option></select></div>
            <div className="field"><label htmlFor="w-client">Client</label>
              <select id="w-client" value={work.client_id} onChange={setW('client_id')}>
                <option value="">—</option>{clients.data?.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="w-vendor">Vendor</label>
              <select id="w-vendor" value={work.vendor_id} onChange={setW('vendor_id')}>
                <option value="">—</option>{vendors.data?.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="w-project">Project</label><input id="w-project" value={work.project_name} onChange={setW('project_name')} /></div>
            <div className="field"><label htmlFor="w-title">Job title</label><input id="w-title" value={work.job_title} onChange={setW('job_title')} /></div>
            <div className="field"><label htmlFor="w-loc">Work location</label><input id="w-loc" value={work.work_location} onChange={setW('work_location')} placeholder="Client site / Remote / Office" /></div>
            <div className="field"><label htmlFor="w-city">City</label><input id="w-city" value={work.city} onChange={setW('city')} /></div>
            <div className="field"><label htmlFor="w-state">State</label><input id="w-state" value={work.state} onChange={setW('state')} /></div>
            <div className="field"><label htmlFor="w-start">Start date *</label><input id="w-start" type="date" value={work.start_date} onChange={setW('start_date')} required /></div>
            <div className="field"><label htmlFor="w-end">End date</label><input id="w-end" type="date" value={work.end_date} onChange={setW('end_date')} /></div>
            <div className="field wide"><label htmlFor="w-duties">Job duties</label><textarea id="w-duties" rows={3} value={work.job_duties} onChange={setW('job_duties')} /></div>
            {error && <p className="error wide">{error}</p>}
            <div className="actions wide"><button type="submit">Save assignment</button></div>
          </form>
        )}
        <Table
          rows={e.work}
          columns={[
            { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
            { key: 'client_name', label: 'Client' },
            { key: 'vendor_name', label: 'Vendor' },
            { key: 'project_name', label: 'Project' },
            { key: 'job_title', label: 'Title' },
            { key: 'job_duties', label: 'Duties' },
            { key: 'loc', label: 'Location', render: (r) => [r.work_location, r.city, r.state].filter(Boolean).join(', ') || '—' },
            { key: 'dates', label: 'Dates', render: (r) => `${fmtDate(r.start_date)} – ${r.end_date ? fmtDate(r.end_date) : 'Present'}` },
            ...(canEdit ? [{ key: 'x', label: '', render: (r) => (!r.end_date ? <button className="link" onClick={() => endAssignment(r.work_id)}>End today</button> : null) }] : []),
          ]}
        />
      </section>

      <MarketingAgentCard employeeId={id} assignments={e.marketing_assignments || []} onChange={emp.reload} />

      <section className="card">
        <h3>Visa & LCA</h3>
        <Table
          rows={e.immigration}
          empty="No immigration records."
          columns={[
            { key: 'visa_type', label: 'Visa' },
            { key: 'receipt_number', label: 'Receipt #' },
            { key: 'expiry_date', label: 'Visa expiry', render: (r) => fmtDate(r.expiry_date) },
            { key: 'days_left', label: 'Visa days left', render: (r) => <DaysLeft days={r.days_left} /> },
            { key: 'lca_number', label: 'LCA #' },
            { key: 'lca_days_left', label: 'LCA days left', render: (r) => <DaysLeft days={r.lca_days_left} /> },
            { key: 'case_status', label: 'Case', render: (r) => <StatusPill value={r.case_status} /> },
          ]}
        />
      </section>

      <div className="grid-2">
        <section className="card">
          <h3>Trainings</h3>
          <Table rows={e.trainings} columns={[
            { key: 'training_name', label: 'Training' }, { key: 'provider', label: 'Provider' },
            { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
          ]} />
        </section>
        <section className="card">
          <h3>Interviews</h3>
          <Table rows={e.interviews} columns={[
            { key: 'interview_date', label: 'Date', render: (r) => fmtDate(r.interview_date) },
            { key: 'round_name', label: 'Round' },
            { key: 'result', label: 'Result', render: (r) => <StatusPill value={r.result} /> },
          ]} />
        </section>
      </div>
    </>
  );
}
