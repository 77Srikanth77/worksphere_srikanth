import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { fmtDate } from '../api';
import { Loading, StatusPill, Table, useApi } from '../components/ui';

export default function Employees() {
  const { user } = useAuth();
  const list = useApi('/employees');
  const [search, setSearch] = useState('');
  const canEdit = ['HR', 'ADMIN'].includes(user.role);

  const q = search.toLowerCase();
  const rows = (list.data || []).filter((e) =>
    [e.employee_id, e.first_name, e.last_name, e.email, e.client_name].some((v) => String(v || '').toLowerCase().includes(q)));

  return (
    <>
      <div className="page-head">
        <h2>Employees</h2>
        {canEdit && <Link className="button" to="/employees/new">Add employee</Link>}
      </div>
      <input id="emp-search" className="search" placeholder="Search by name, ID, email or client" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Loading {...list} />
      <section className="card">
        <Table
          rows={rows}
          empty="No employees match."
          columns={[
            { key: 'employee_id', label: 'ID', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.employee_id}</Link> },
            { key: 'name', label: 'Name', render: (r) => `${r.first_name} ${r.last_name}` },
            { key: 'email', label: 'Email' },
            { key: 'hire_date', label: 'Hire date', render: (r) => fmtDate(r.hire_date) },
            { key: 'current_status', label: 'Status', render: (r) => <StatusPill value={r.current_status || 'BENCH'} /> },
            { key: 'client_name', label: 'Client' },
            { key: 'work_location', label: 'Location' },
          ]}
        />
      </section>
    </>
  );
}
