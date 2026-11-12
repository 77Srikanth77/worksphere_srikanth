import { useState } from 'react';
import { fmtDate } from '../api';
import { DaysLeft, DrillPanel, Loading, Stat, StatusPill, Table, useApi, useDrill } from '../components/ui';
import { FollowUpBadge, SubmissionDetail, submissionColumns } from '../components/submissions';
import DocumentVault from '../components/DocumentVault';

// Employee self-service: project employees and bench employees see different sections
export default function MyProfile() {
  const p = useApi('/me/profile');
  const [openId, setOpenId] = useState(null);
  const drill = useDrill();
  if (!p.data) return <Loading {...p} />;
  const { employee: e, status, current_assignment: cur, past_assignments: past, interviews } = p.data;
  const onBench = status === 'BENCH';
  const INTERVIEW_COLUMNS = [
    { key: 'interview_date', label: 'Date', render: (r) => fmtDate(r.interview_date) },
    { key: 'round_name', label: 'Round' },
    { key: 'mode', label: 'Mode' },
    { key: 'result', label: 'Result', render: (r) => <StatusPill value={r.result} /> },
    { key: 'feedback', label: 'Feedback' },
  ];
  const byResult = (...results) => interviews.list.filter((i) => results.includes(i.result));
  const DRILLS = {
    attended: { title: 'Interviews attended', rows: byResult('ATTENDED', 'SELECTED', 'REJECTED'), columns: INTERVIEW_COLUMNS },
    pipeline: { title: 'Interviews in pipeline', rows: byResult('PIPELINE'), columns: INTERVIEW_COLUMNS },
    awaiting: { title: 'Interviews awaiting result', rows: byResult('AWAITING_RESULT'), columns: INTERVIEW_COLUMNS },
    trainings: { title: 'Trainings', rows: p.data.trainings, columns: [
      { key: 'training_name', label: 'Training' }, { key: 'provider', label: 'Provider' },
      { key: 'dates', label: 'Dates', render: (r) => `${fmtDate(r.start_date)} – ${r.end_date ? fmtDate(r.end_date) : 'ongoing'}` },
      { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
    ] },
    submitted: { title: 'Where my profile was submitted', rows: p.data.submissions, columns: submissionColumns(setOpenId, { employee: false }) },
  };
  const tile = (key) => ({ onClick: () => drill.toggle(key), active: drill.is(key) });

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
        <Stat label="Interviews attended" value={interviews.attended} {...tile('attended')} />
        <Stat label="Trainings" value={p.data.trainings.length} {...tile('trainings')} />
        {onBench && <Stat label="In pipeline" value={interviews.pipeline} tone="warn" {...tile('pipeline')} />}
        {onBench && <Stat label="Awaiting result" value={interviews.awaiting_result} tone="warn" {...tile('awaiting')} />}
        {onBench && <Stat label="Profiles submitted" value={p.data.profiles_submitted} {...tile('submitted')} />}
      </div>
      {DRILLS[drill.open] && (
        <DrillPanel title={DRILLS[drill.open].title} rows={DRILLS[drill.open].rows} columns={DRILLS[drill.open].columns}
          empty="Nothing here yet." onClose={drill.close} />
      )}

      {!onBench && cur && (
        <section className="card details">
          <h3 className="wide">Current client</h3>
          <div><span>Client</span>{cur.client_name || '—'}</div>
          <div><span>Vendor</span>{cur.vendor_name || '—'}</div>
          <div><span>Project</span>{cur.project_name || '—'}</div>
          <div><span>Job title</span>{cur.job_title || '—'}</div>
          <div><span>Location</span>{[cur.work_location, cur.city, cur.state].filter(Boolean).join(', ')}</div>
          <div><span>Since</span>{fmtDate(cur.start_date)}</div>
          {cur.client_manager_name && <div><span>Reporting manager</span>{cur.client_manager_name}{cur.client_manager_title ? ` · ${cur.client_manager_title}` : ''}</div>}
          {cur.worksite_address && <div><span>Worksite</span>{[cur.worksite_address, cur.worksite_zip].filter(Boolean).join(' ')}</div>}
          <div className="wide"><span>Present job duties</span>{cur.job_duties || '—'}</div>
        </section>
      )}

      {onBench && (
        <section className="card details">
          <h3 className="wide">My marketing</h3>
          <div><span>Marketing agent</span>{p.data.marketing_agent?.full_name || 'Not assigned yet'}</div>
          <div><span>Agent email</span>{p.data.marketing_agent?.email || '—'}</div>
          <div><span>Job title</span>{cur?.job_title || '—'}</div>
          <div className="wide"><span>Current activity</span>{cur?.job_duties || '—'}</div>
        </section>
      )}

      {onBench && (
        <section className="card">
          <h3>Where my profile was submitted</h3>
          <p className="hint">Your agent follows up with each vendor at least every 3 business days. Open a submission to see the vendor&apos;s feedback, ask for an update, or add your own notes.</p>
          <Table rows={p.data.submissions} empty="No profiles submitted yet." columns={[
            { key: 'submitted_on', label: 'Submitted', render: (r) => fmtDate(r.submitted_on) },
            { key: 'job_title', label: 'Role' },
            { key: 'vendor', label: 'Vendor / client', render: (r) => [r.vendor_name, r.client_name].filter(Boolean).join(' / ') || '—' },
            { key: 'status', label: 'Stage', render: (r) => <StatusPill value={r.status} /> },
            { key: 'latest_vendor_feedback', label: 'Latest vendor feedback', render: (r) => r.latest_vendor_feedback || <span className="muted">No feedback yet</span> },
            { key: 'last_activity_on', label: 'Last follow-up', render: (r) => (
              <>{fmtDate(r.last_activity_on)}{r.follow_up_state === 'OVERDUE' ? <div><span className="pill critical">No follow-up for {r.business_days_idle} business days</span></div> : null}</>) },
            { key: 'fu', label: 'Next follow-up', render: (r) => (r.open_update_request ? <span className="pill warning">Update requested</span> : <FollowUpBadge row={r} />) },
            { key: 'x', label: '', render: (r) => <button className="link" onClick={() => setOpenId(r.submission_id)}>View</button> },
          ]} />
        </section>
      )}

      <DocumentVault mine />

      {onBench && openId && (
        <SubmissionDetail key={openId} id={openId} mode="employee" onClose={() => setOpenId(null)} onChanged={p.reload} />
      )}

      <section className="card">
        <h3>Past job duties</h3>
        <Table rows={past} empty="No past assignments." columns={[
          { key: 'dates', label: 'Dates', render: (r) => `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` },
          { key: 'client_name', label: 'Client' },
          { key: 'job_title', label: 'Job title' },
          { key: 'project_name', label: 'Project' },
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
