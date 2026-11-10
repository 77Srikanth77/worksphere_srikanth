import { useState } from 'react';
import { useAuth } from '../auth';
import { api, fmtDate } from '../api';
import { DrillPanel, Loading, Stat, StatusPill, Table, useApi, useDrill } from '../components/ui';
import { FollowUpBadge, SubmissionDetail, submissionColumns } from '../components/submissions';

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');

// Marketing Manager / CEO: are agents marketing bench employees well and following up with vendors?
export default function MarketingTeam() {
  const { user } = useAuth();
  const team = useApi('/marketing/team');
  const [openId, setOpenId] = useState(null);
  const [message, setMessage] = useState('');
  const drill = useDrill();
  const subs = useApi(['open', 'onschedule', 'overdue', 'placed'].includes(drill.open) ? '/marketing/submissions' : null);
  // CEO watches; the Marketing Manager (and Admin) can also log follow-ups
  const mode = ['MARKETING_MANAGER', 'ADMIN'].includes(user.role) ? 'agent' : 'view';

  const REQUEST_COLUMNS = [
    { key: 'employee_name', label: 'Employee' },
    { key: 'agent_name', label: 'Agent' },
    { key: 'requested_on', label: 'Asked on', render: (r) => fmtDate(r.requested_on) },
    { key: 'message', label: 'Message', render: (r) => r.message || '—' },
    { key: 'esc', label: '', render: (r) => (r.escalated_on ? <span className="pill critical">Escalated</span> : <span className="pill">Waiting</span>) },
    { key: 'x', label: '', render: (r) => <button className="link" onClick={() => setOpenId(r.submission_id)}>Open</button> },
  ];
  const subCols = submissionColumns(setOpenId, { agent: true });
  const isOpen = (r) => r.follow_up_state !== 'CLOSED';
  const DRILLS = {
    open: { title: 'Open submissions', filter: isOpen },
    overdue: { title: 'Overdue follow-ups', filter: (r) => r.follow_up_state === 'OVERDUE' },
    onschedule: { title: 'Open submissions on schedule', filter: (r) => isOpen(r) && r.follow_up_state !== 'OVERDUE' },
    placed: { title: 'Placements', filter: (r) => r.status === 'PLACED' },
  };
  const tile = (key) => ({ onClick: () => drill.toggle(key), active: drill.is(key) });

  const runCheck = async () => {
    setMessage('');
    try {
      const r = await api('/reports/followups/run', { method: 'POST' });
      setMessage(`Checked ${r.open_submissions} open submissions: ${r.overdue} overdue, ${r.due} due. Reminders sent to ${r.agents_notified} agent(s); ${r.escalated_requests} update request(s) escalated.`);
      team.reload();
    } catch (e) {
      setMessage(e.message);
    }
  };

  if (!team.data) return <Loading {...team} />;
  const t = team.data;
  const total = (k) => t.scorecard.reduce((n, a) => n + (a[k] || 0), 0);
  const open = total('open_submissions');
  const overdue = total('overdue');

  return (
    <>
      <div className="page-head">
        <h2>Marketing team</h2>
        <button className="secondary" onClick={runCheck}>Run follow-up check now</button>
      </div>
      {message && <p className="notice-box">{message}</p>}
      <p className="hint">
        Rule: agents follow up with the vendor every {t.rules.due_days} business days. No activity for {t.rules.overdue_days} business days = overdue.
        Reminders and escalations are emailed every weekday morning.
      </p>

      <div className="stats">
        <Stat label="Open submissions" value={open} {...tile('open')} />
        <Stat label="Follow-ups overdue" value={overdue} tone={overdue ? 'bad' : 'good'} {...tile('overdue')} />
        <Stat label="On schedule" value={pct(open - overdue, open)} tone={overdue ? 'warn' : 'good'} {...tile('onschedule')} />
        <Stat label="Open update requests" value={t.open_update_requests.length} tone={t.open_update_requests.length ? 'warn' : ''} {...tile('requests')} />
        <Stat label="Placements" value={total('placed')} tone="good" {...tile('placed')} />
      </div>
      {drill.is('requests') && (
        <DrillPanel title="Open employee update requests" rows={t.open_update_requests} columns={REQUEST_COLUMNS} empty="No open requests." onClose={drill.close} />
      )}
      {DRILLS[drill.open] && (
        <DrillPanel title={DRILLS[drill.open].title} rows={subs.data?.filter(DRILLS[drill.open].filter)} columns={subCols}
          loading={subs.loading} error={subs.error} empty="Nothing here right now." onClose={drill.close} />
      )}

      <section className="card">
        <h3>Agent scorecard</h3>
        <Table
          rows={t.scorecard}
          empty="No active marketing agents."
          columns={[
            { key: 'full_name', label: 'Agent' },
            { key: 'employees_assigned', label: 'Bench assigned' },
            { key: 'submissions_30d', label: 'Submissions (30d)' },
            { key: 'follow_ups_30d', label: 'Follow-ups (30d)' },
            { key: 'open_submissions', label: 'Open' },
            { key: 'overdue', label: 'Overdue', render: (a) => (a.overdue ? <span className="pill critical">{a.overdue}</span> : '0') },
            { key: 'on_schedule_pct', label: 'On schedule', render: (a) => (a.on_schedule_pct == null ? '—' : `${a.on_schedule_pct}%`) },
            { key: 'avg_idle_days', label: 'Avg days idle', render: (a) => a.avg_idle_days ?? '—' },
            { key: 'funnel', label: 'Submitted → screening → interview → placed', render: (a) => (
              <span title={`Screening ${pct(a.reached_screening, a.total_submissions)}, interview ${pct(a.reached_interview, a.total_submissions)}, placed ${pct(a.placed, a.total_submissions)}`}>
                {a.total_submissions} → {a.reached_screening} → {a.reached_interview} → {a.placed}
              </span>) },
            { key: 'open_update_requests', label: 'Requests open', render: (a) => (a.open_update_requests ? <span className="pill warning">{a.open_update_requests}</span> : '0') },
          ]}
        />
      </section>

      <div className="grid-2">
        <section className="card">
          <h3>Follow-ups needing attention</h3>
          <Table
            rows={t.attention}
            empty="All follow-ups are on schedule."
            columns={[
              { key: 'agent_name', label: 'Agent' },
              { key: 'employee_name', label: 'Employee' },
              { key: 'vendor', label: 'Vendor / role', render: (r) => [r.vendor_name, r.job_title].filter(Boolean).join(' · ') },
              { key: 'status', label: 'Stage', render: (r) => <StatusPill value={r.status} /> },
              { key: 'fu', label: 'Follow-up', render: (r) => <FollowUpBadge row={r} /> },
              { key: 'x', label: '', render: (r) => <button className="link" onClick={() => setOpenId(r.submission_id)}>Open</button> },
            ]}
          />
        </section>

        <section className="card">
          <h3>Employee update requests</h3>
          <Table rows={t.open_update_requests} empty="No open requests." columns={REQUEST_COLUMNS} />
        </section>
      </div>

      {openId && <SubmissionDetail key={openId} id={openId} mode={mode} onClose={() => setOpenId(null)} onChanged={team.reload} />}
    </>
  );
}
