import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate } from '../api';
import { DaysLeft, DrillPanel, Loading, Stat, StatusPill, Table, useApi, useDrill } from '../components/ui';
import { SubmissionDetail, submissionColumns } from '../components/submissions';

const EMPLOYEE_COLUMNS = [
  { key: 'employee_name', label: 'Employee', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.first_name} {r.last_name}</Link> },
  { key: 'current_status', label: 'Status', render: (r) => <StatusPill value={r.current_status || 'BENCH'} /> },
  { key: 'job_title', label: 'Title' },
  { key: 'client_name', label: 'Client' },
  { key: 'project_name', label: 'Project' },
  { key: 'work_location', label: 'Work location' },
];
const EXPIRY_COLUMNS = [
  { key: 'employee_name', label: 'Employee', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> },
  { key: 'visa_type', label: 'Visa' },
  { key: 'expiry_date', label: 'Visa expiry', render: (r) => fmtDate(r.expiry_date) },
  { key: 'lca_expiry_date', label: 'LCA expiry', render: (r) => fmtDate(r.lca_expiry_date) },
  { key: 'days_left', label: 'Days left', render: (r) => <DaysLeft days={r.days_left} /> },
  { key: 'case_status', label: 'Case', render: (r) => <StatusPill value={r.case_status} /> },
];
const ALERT_COLUMNS = [
  { key: 'created_at', label: 'Raised', render: (r) => fmtDate(r.created_at) },
  { key: 'employee_name', label: 'Employee', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> },
  { key: 'alert_type', label: 'Type' },
  { key: 'message', label: 'Alert' },
];
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA');

// CEO / management: whole-company view
export default function Dashboard() {
  const summary = useApi('/reports/summary');
  const expiring = useApi('/reports/expiring?days=180');
  const agents = useApi('/reports/marketing');
  const drill = useDrill();
  const [openSub, setOpenSub] = useState(null);
  // Lists load only when their tile is clicked
  const wantEmployees = ['employees', 'project', 'bench'].includes(drill.open);
  const employees = useApi(wantEmployees ? '/employees' : null);
  const alerts = useApi(drill.is('alerts') ? '/alerts?unread=true' : null);
  const subs = useApi(['subs30', 'placed'].includes(drill.open) ? '/marketing/submissions' : null);
  const s = summary.data;

  const emp = (filter) => employees.data?.filter(filter);
  const DRILLS = {
    employees: { title: 'All employees', rows: emp(() => true), columns: EMPLOYEE_COLUMNS, src: employees },
    project: { title: 'Employees on a project', rows: emp((e) => e.current_status === 'PROJECT'), columns: EMPLOYEE_COLUMNS, src: employees },
    bench: { title: 'Employees on the bench', rows: emp((e) => e.current_status === 'BENCH'), columns: EMPLOYEE_COLUMNS, src: employees },
    expiring: {
      title: 'Visa / LCA expiring within 180 days (open cases)',
      rows: expiring.data?.filter((r) => !['FILED', 'RENEWED', 'EXPIRED'].includes(r.case_status)),
      columns: EXPIRY_COLUMNS, src: expiring,
    },
    alerts: { title: 'Unread alerts', rows: alerts.data, columns: ALERT_COLUMNS, src: alerts },
    subs30: {
      title: 'Submissions in the last 30 days', rows: subs.data?.filter((r) => r.submitted_on >= daysAgo(30)),
      columns: submissionColumns(setOpenSub, { agent: true }), src: subs,
    },
    placed: { title: 'Placements', rows: subs.data?.filter((r) => r.status === 'PLACED'), columns: submissionColumns(setOpenSub, { agent: true }), src: subs },
  };
  const d = drill.open && DRILLS[drill.open];
  const tile = (key) => ({ onClick: () => { drill.toggle(key); setOpenSub(null); }, active: drill.is(key) });

  return (
    <>
      <h2>Company overview</h2>
      <Loading {...summary} />
      {s && (
        <div className="stats">
          <Stat label="Employees" value={s.total_employees} {...tile('employees')} />
          <Stat label="On project" value={s.on_project} tone="good" {...tile('project')} />
          <Stat label="On bench" value={s.on_bench} tone="warn" {...tile('bench')} />
          <Stat label="Visa/LCA expiring ≤ 180 days" value={s.expiring_180_days} tone="bad" {...tile('expiring')} />
          <Stat label="Unread alerts" value={s.unread_alerts} tone="bad" {...tile('alerts')} />
          <Stat label="Submissions (30 days)" value={s.submissions_30_days} {...tile('subs30')} />
          <Stat label="Placements" value={s.total_placements} tone="good" {...tile('placed')} />
        </div>
      )}
      {d && (
        <DrillPanel title={d.title} rows={d.rows} columns={d.columns} loading={d.src.loading} error={d.src.error}
          empty="Nothing to show." onClose={drill.close} />
      )}
      {openSub && <SubmissionDetail key={openSub} id={openSub} mode="view" onClose={() => setOpenSub(null)} />}

      <section className="card">
        <h3>Upcoming visa / LCA expiries</h3>
        <Loading {...expiring} />
        <Table
          rows={expiring.data}
          empty="No visa or LCA expires in the next 180 days."
          columns={[
            { key: 'employee_name', label: 'Employee', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> },
            { key: 'visa_type', label: 'Visa' },
            { key: 'expiry_date', label: 'Visa expiry', render: (r) => fmtDate(r.expiry_date) },
            { key: 'lca_expiry_date', label: 'LCA expiry', render: (r) => fmtDate(r.lca_expiry_date) },
            { key: 'days_left', label: 'Days left', render: (r) => <DaysLeft days={r.days_left} /> },
            { key: 'case_status', label: 'Case', render: (r) => <StatusPill value={r.case_status} /> },
          ]}
        />
      </section>

      <div className="grid-2">
        <section className="card">
          <h3>Marketing agents</h3>
          <Loading {...agents} />
          <Table
            rows={agents.data}
            columns={[
              { key: 'agent', label: 'Agent' },
              { key: 'employees_assigned', label: 'Assigned' },
              { key: 'profiles_submitted', label: 'Submitted' },
              { key: 'vendors_contacted', label: 'Vendors' },
              { key: 'placements', label: 'Placed' },
            ]}
          />
        </section>
        <section className="card">
          <h3>Consultants by client</h3>
          <Table rows={s?.by_client} columns={[{ key: 'client_name', label: 'Client' }, { key: 'consultants', label: 'Consultants' }]} />
          <h3>By location</h3>
          <Table rows={s?.by_location} columns={[{ key: 'location', label: 'Location' }, { key: 'employees', label: 'Employees' }]} />
        </section>
      </div>
    </>
  );
}
