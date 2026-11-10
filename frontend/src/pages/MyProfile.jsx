import { fmtDate } from '../api';
import { DaysLeft, Loading, Stat, StatusPill, Table, useApi } from '../components/ui';

// Employee self-service: project employees and bench employees see different sections
export default function MyProfile() {
  const p = useApi('/me/profile');
  if (!p.data) return <Loading {...p} />;
  const { employee: e, status, current_assignment: cur, past_assignments: past, interviews } = p.data;
  const onBench = status === 'BENCH';

  return (
    <>
      <div className="page-head">
        <h2>{e.first_name} {e.last_name} <span className="muted">· {e.employee_id}</span></h2>
        <StatusPill value={onBench ? 'BENCH' : 'PROJECT'} />
      </div>

      <section className="card details">
        <div><span>Joined the company</span>{fmtDate(e.hire_date)}</div>
        <div><span>Email</span>{e.email}</div>
        <div><span>Phone</span>{e.phone_number || '—'}</div>
        {p.data.immigration.map((v) => (
          <div key={v.visa_type}><span>{v.visa_type} expires</span>{fmtDate(v.expiry_date)} <DaysLeft days={v.days_left} /></div>
        ))}
        <div className="wide"><span>Bio</span>{e.bio || '—'}</div>
      </section>

      <div className="stats">
        <Stat label="Interviews attended" value={interviews.attended} />
        <Stat label="Trainings" value={p.data.trainings.length} />
        {onBench && <Stat label="In pipeline" value={interviews.pipeline} tone="warn" />}
        {onBench && <Stat label="Awaiting result" value={interviews.awaiting_result} tone="warn" />}
        {onBench && <Stat label="Profiles submitted" value={p.data.profiles_submitted} />}
      </div>

      {!onBench && cur && (
        <section className="card details">
          <h3 className="wide">Current client</h3>
          <div><span>Client</span>{cur.client_name || '—'}</div>
          <div><span>Vendor</span>{cur.vendor_name || '—'}</div>
          <div><span>Project</span>{cur.project_name || '—'}</div>
          <div><span>Role</span>{cur.job_title || '—'}</div>
          <div><span>Location</span>{[cur.work_location, cur.city, cur.state].filter(Boolean).join(', ')}</div>
          <div><span>Since</span>{fmtDate(cur.start_date)}</div>
          <div className="wide"><span>Present job duties</span>{cur.job_duties || '—'}</div>
        </section>
      )}

      {onBench && (
        <section className="card details">
          <h3 className="wide">My marketing</h3>
          <div><span>Marketing agent</span>{p.data.marketing_agent?.full_name || 'Not assigned yet'}</div>
          <div><span>Agent email</span>{p.data.marketing_agent?.email || '—'}</div>
          <div className="wide"><span>Current activity</span>{cur?.job_duties || '—'}</div>
          <div className="wide">
            <Table rows={p.data.submissions} empty="No profiles submitted yet." columns={[
              { key: 'submitted_on', label: 'Submitted', render: (r) => fmtDate(r.submitted_on) },
              { key: 'client_name', label: 'Client' },
              { key: 'vendor_name', label: 'Vendor' },
              { key: 'job_title', label: 'Role' },
              { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
            ]} />
          </div>
        </section>
      )}

      <section className="card">
        <h3>Past job duties</h3>
        <Table rows={past} empty="No past assignments." columns={[
          { key: 'dates', label: 'Dates', render: (r) => `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` },
          { key: 'client_name', label: 'Client' },
          { key: 'project_name', label: 'Project' },
          { key: 'job_title', label: 'Role' },
          { key: 'job_duties', label: 'Duties' },
        ]} />
      </section>

      <div className="grid-2">
        <section className="card">
          <h3>Interviews</h3>
          <Table rows={interviews.list} columns={[
            { key: 'interview_date', label: 'Date', render: (r) => fmtDate(r.interview_date) },
            { key: 'round_name', label: 'Round' },
            { key: 'mode', label: 'Mode' },
            { key: 'result', label: 'Result', render: (r) => <StatusPill value={r.result} /> },
          ]} />
        </section>
        <section className="card">
          <h3>Trainings attended</h3>
          <Table rows={p.data.trainings} columns={[
            { key: 'training_name', label: 'Training' },
            { key: 'provider', label: 'Provider' },
            { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
          ]} />
        </section>
      </div>
    </>
  );
}
