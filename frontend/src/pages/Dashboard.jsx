import { Link } from 'react-router-dom';
import { fmtDate } from '../api';
import { DaysLeft, Loading, Stat, StatusPill, Table, useApi } from '../components/ui';

// CEO / management: whole-company view
export default function Dashboard() {
  const summary = useApi('/reports/summary');
  const expiring = useApi('/reports/expiring?days=180');
  const agents = useApi('/reports/marketing');
  const s = summary.data;

  return (
    <>
      <h2>Company overview</h2>
      <Loading {...summary} />
      {s && (
        <div className="stats">
          <Stat label="Employees" value={s.total_employees} />
          <Stat label="On project" value={s.on_project} tone="good" />
          <Stat label="On bench" value={s.on_bench} tone="warn" />
          <Stat label="Visa/LCA expiring ≤ 180 days" value={s.expiring_180_days} tone="bad" />
          <Stat label="Unread alerts" value={s.unread_alerts} tone="bad" />
          <Stat label="Submissions (30 days)" value={s.submissions_30_days} />
          <Stat label="Placements" value={s.total_placements} tone="good" />
        </div>
      )}

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
