import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { fmtDate } from '../api';
import { Loading, StatusPill, Table, useApi } from '../components/ui';

// Marketing agent (own) / Marketing Manager (all): postings sent to employees and their responses
export default function JobPostings() {
  const { user } = useAuth();
  const list = useApi('/jobs');
  const [show, setShow] = useState('OPEN');
  const rows = (list.data || []).filter((p) => show === 'ALL' || p.status === show);
  return (
    <>
      <div className="page-head">
        <h2>Job postings</h2>
        <div className="actions">
          <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value)} style={{ width: 'auto' }}>
            <option value="OPEN">Open</option><option value="CLOSED">Closed</option><option value="ALL">All</option>
          </select>
          <Link className="button" to="/jobs/new">New posting</Link>
        </div>
      </div>
      <p className="hint">Describe a role, WorkSphere ranks matching employees as you type, and you send it to the ones you choose. Their replies come back here and to your notifications.</p>
      <Loading {...list} />
      <section className="card">
        {list.data && (
          <Table rows={rows} empty={show === 'OPEN' ? 'No open postings. Create one with "New posting".' : 'Nothing here.'} columns={[
            { key: 'title', label: 'Role', render: (p) => <><Link to={`/jobs/${p.posting_id}`}><strong>{p.title}</strong></Link>
              <div className="muted small">{[p.client_name, p.vendor_name, p.location].filter(Boolean).join(' · ')}</div></> },
            ...(user.role !== 'MARKETING' ? [{ key: 'agent_name', label: 'Agent' }] : []),
            { key: 'created_at', label: 'Posted', render: (p) => fmtDate(p.created_at) },
            { key: 'sent', label: 'Sent to', render: (p) => <span className="num">{p.sent}</span> },
            { key: 'interested', label: 'Interested', render: (p) => (p.interested ? <span className="pill ok">{p.interested}</span> : '0') },
            { key: 'pending', label: 'No reply yet', render: (p) => <span className="num">{p.pending || 0}</span> },
            { key: 'submitted', label: 'Submitted', render: (p) => <span className="num">{p.submitted || 0}</span> },
            { key: 'status', label: 'Status', render: (p) => <StatusPill value={p.status} /> },
          ]} />
        )}
      </section>
    </>
  );
}
