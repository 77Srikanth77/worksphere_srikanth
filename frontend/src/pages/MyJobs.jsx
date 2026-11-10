import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { Loading, StatusPill, useApi } from '../components/ui';
import { PostingDetails } from './JobPosting';

const REPLY = { PENDING: 'Waiting for your reply', INTERESTED: 'You are interested', NOT_INTERESTED: 'You passed on this one' };

/** One posting with Interested / Not interested */
function Opening({ id, onReplied }) {
  const post = useApi(`/jobs/${id}`);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { setNote(post.data?.my_response?.response_note || ''); }, [post.data?.my_response?.response_note]);
  // Opening a posting marks it seen; refresh the list so the "New" badge clears
  useEffect(() => { if (post.data?.posting_id) onReplied(); }, [post.data?.posting_id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!post.data) return <section className="card"><Loading {...post} /></section>;
  const p = post.data;
  const r = p.my_response;
  const reply = async (response) => {
    setError('');
    try {
      await api(`/jobs/${p.posting_id}/respond`, { method: 'POST', body: { response, note } });
      setMsg(response === 'INTERESTED' ? `Thanks! ${p.agent_name} has been told you're interested.` : `Got it. ${p.agent_name} has been told.`);
      post.reload(); onReplied();
    } catch (e) { setError(e.message); }
  };
  return (
    <section className="card">
      <div className="page-head">
        <h3>{p.title}</h3>
        <StatusPill value={r.submission_id ? 'SUBMITTED' : r.response} />
      </div>
      <PostingDetails p={p} />
      <div className="reply-box">
        {r.submission_id ? (
          <p className="notice-box">Your profile has been submitted to the vendor. Follow the vendor&apos;s feedback on <Link to="/profile">My Profile</Link>.</p>
        ) : p.status !== 'OPEN' ? (
          <p className="muted">This posting is closed.</p>
        ) : (
          <>
            <p><strong>{REPLY[r.response]}</strong>{r.responded_at ? <span className="muted"> · {fmtDate(r.responded_at)}</span> : null}</p>
            <label htmlFor="reply-note">Note to {p.agent_name} (optional)</label>
            <input id="reply-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Available from Monday; prefer remote" />
            <div className="actions" style={{ marginTop: 10 }}>
              <button onClick={() => reply('INTERESTED')}>I&apos;m interested</button>
              <button className="secondary" onClick={() => reply('NOT_INTERESTED')}>Not interested</button>
            </div>
          </>
        )}
        {msg && <p className="notice-box">{msg}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}

// Employee: job openings marketing agents have sent me
export default function MyJobs() {
  const { id } = useParams();
  const navigate = useNavigate();
  const list = useApi('/jobs/mine');
  const rows = list.data || [];
  const current = id || rows.find((r) => r.response === 'PENDING')?.posting_id || rows[0]?.posting_id;

  return (
    <>
      <h2>Job openings for me</h2>
      <p className="hint">Your marketing agent sends you roles that match your profile. Tell them if you&apos;re interested; they&apos;ll submit your profile to the vendor.</p>
      <Loading {...list} />
      {list.data && rows.length === 0 && <section className="card"><p className="muted">No job openings yet. When your agent sends you one, you&apos;ll get a notification.</p></section>}
      {rows.length > 0 && (
        <div className="jobs-layout">
          <ul className="job-list">
            {rows.map((r) => (
              <li key={r.posting_id}>
                <button type="button" className={`job-item ${String(r.posting_id) === String(current) ? 'on' : ''}`} onClick={() => navigate(`/my-jobs/${r.posting_id}`)}>
                  <strong>{r.title}</strong>
                  <span className="muted small">{[r.client_name, r.location].filter(Boolean).join(' · ')}</span>
                  <span className="job-meta">
                    {!r.seen_at && <span className="pill notice">New</span>}
                    <StatusPill value={r.submission_id ? 'SUBMITTED' : r.response} />
                    <span className="muted small">{fmtDate(r.sent_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {current && <Opening key={current} id={current} onReplied={list.reload} />}
        </div>
      )}
    </>
  );
}
