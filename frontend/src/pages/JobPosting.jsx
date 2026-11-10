import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { Loading, StatusPill, Table, useApi } from '../components/ui';
import { MatchBar, MatchPanel } from './JobComposer';

const MODE = { ONSITE: 'Onsite', HYBRID: 'Hybrid', REMOTE: 'Remote' };

/** Posting details shared by the agent and employee views */
export function PostingDetails({ p, showRate }) {
  const skills = String(p.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (
    <>
      <div className="details compact">
        {p.client_name && <div><span>Client</span>{p.client_name}</div>}
        {p.vendor_name && <div><span>Vendor</span>{p.vendor_name}</div>}
        {p.location && <div><span>Location</span>{p.location}</div>}
        {p.work_mode && <div><span>Work mode</span>{MODE[p.work_mode]}</div>}
        {p.duration && <div><span>Duration</span>{p.duration}</div>}
        {showRate && p.rate && <div><span>Rate (internal)</span>{p.rate}</div>}
        <div><span>Posted by</span>{p.agent_name} · {fmtDate(p.created_at)}</div>
      </div>
      {skills.length > 0 && <div className="skill-chips">{skills.map((s) => <span key={s} className="chip-skill">{s}</span>)}</div>}
      <h4>Job duties</h4>
      <p className="prewrap">{p.description}</p>
    </>
  );
}

// Agent / manager: one posting, who it went to, their replies, submit the interested ones, send to more
export default function JobPosting() {
  const { id } = useParams();
  const location = useLocation();
  const post = useApi(`/jobs/${id}`);
  const [message, setMessage] = useState(location.state?.message || '');
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState(new Set());

  if (!post.data) return <Loading {...post} />;
  const p = post.data;
  const act = async (fn, msg) => {
    setError('');
    try { await fn(); setMessage(msg); post.reload(); } catch (e) { setError(e.message); }
  };
  const submit = (r) => act(() => api(`/jobs/${p.posting_id}/recipients/${r.employee_id}/submit`, { method: 'POST' }),
    `${r.employee_name} submitted to ${p.vendor_name || 'the vendor'}. Track it on My Marketing.`);
  const sendMore = () => act(async () => {
    const r = await api(`/jobs/${p.posting_id}/recipients`, { method: 'POST', body: { employee_ids: [...selected] } });
    setSelected(new Set()); setMore(false);
    return r;
  }, `Sent to ${selected.size} more employee(s).`);
  const setStatus = (status) => act(() => api(`/jobs/${p.posting_id}/status`, { method: 'PATCH', body: { status } }),
    status === 'CLOSED' ? 'Posting closed. Employees can no longer reply.' : 'Posting reopened.');
  const counts = (k) => p.recipients.filter((r) => r.response === k).length;

  return (
    <>
      <div className="page-head">
        <h2>{p.title} <StatusPill value={p.status} /></h2>
        <div className="actions">
          <Link to="/jobs">All postings</Link>
          {p.status === 'OPEN'
            ? <button className="secondary" onClick={() => setStatus('CLOSED')}>Close posting</button>
            : <button className="secondary" onClick={() => setStatus('OPEN')}>Reopen</button>}
        </div>
      </div>
      {message && <p className="notice-box">{message}</p>}
      {error && <p className="error">{error}</p>}

      <section className="card"><PostingDetails p={p} showRate /></section>

      <section className="card">
        <div className="page-head">
          <h3>Sent to {p.recipients.length} <span className="muted">· {counts('INTERESTED')} interested · {counts('PENDING')} no reply · {counts('NOT_INTERESTED')} not interested</span></h3>
          {p.status === 'OPEN' && <button className="secondary" onClick={() => setMore(!more)}>{more ? 'Close' : 'Send to more employees'}</button>}
        </div>
        <Table rows={p.recipients} empty="Not sent to anyone yet." columns={[
          { key: 'employee_name', label: 'Employee', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> },
          { key: 'match_score', label: 'Match', render: (r) => (r.match_score != null ? <MatchBar value={r.match_score} /> : '—') },
          { key: 'visa_type', label: 'Visa', render: (r) => r.visa_type || '—' },
          { key: 'sent', label: 'Sent / seen', render: (r) => <>{fmtDate(r.sent_at)}<div className="muted small">{r.seen_at ? `Seen ${fmtDate(r.seen_at)}` : 'Not opened yet'}</div></> },
          { key: 'response', label: 'Reply', render: (r) => <>{<StatusPill value={r.response} />}{r.response_note ? <div className="small">“{r.response_note}”</div> : null}</> },
          { key: 'x', label: '', render: (r) => (r.submission_id
            ? <span className="pill ok">Submitted · {String(r.submission_status || '').replaceAll('_', ' ').toLowerCase()}</span>
            : r.response === 'INTERESTED' ? <button className="link" onClick={() => submit(r)}>Submit to vendor</button> : null) },
        ]} />
      </section>

      {more && (
        <section className="card">
          <MatchPanel posting={p} selected={selected} setSelected={setSelected} exclude={p.recipients.map((r) => r.employee_id)} />
          <div className="send-bar"><button disabled={!selected.size} onClick={sendMore}>Send to {selected.size} more</button></div>
        </section>
      )}
    </>
  );
}
