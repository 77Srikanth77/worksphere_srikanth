import { useEffect, useRef, useState } from 'react';
import { api, fmtDate } from '../api';
import { Loading, StatusPill, useApi } from './ui';

// Pipeline stages, in order, plus the closed outcomes
export const STAGES = [
  'SUBMITTED', 'ACKNOWLEDGED', 'SCREENING_SCHEDULED', 'SCREENING_DONE', 'CLIENT_INTERVIEW', 'OFFER', 'PLACED',
  'REJECTED', 'POSITION_CLOSED', 'NO_RESPONSE',
];
export const CHANNELS = [
  ['CALL', 'Phone call'], ['EMAIL', 'Email'], ['PORTAL', 'Vendor portal'], ['LINKEDIN', 'LinkedIn'], ['OTHER', 'Other'],
];
const CHANNEL_LABEL = Object.fromEntries(CHANNELS);
export const label = (s) => String(s || '').toLowerCase().replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());

const fmtDateTime = (d) => (d ? new Date(String(d).replace(' ', 'T')).toLocaleString([], {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '—');

/** Follow-up state for a submission row: OVERDUE / DUE / OK / CLOSED */
export function FollowUpBadge({ row }) {
  if (row.follow_up_state === 'OVERDUE') {
    return <span className="pill critical">Overdue · {row.business_days_idle} business days idle</span>;
  }
  if (row.follow_up_state === 'DUE') return <span className="pill warning">Follow-up due</span>;
  if (row.follow_up_state === 'OK') return <span className="pill">Next {fmtDate(row.follow_up_due_on)}</span>;
  return <span className="muted">Closed</span>;
}

/** Standard columns for a list of submissions. onOpen(id) opens the timeline. */
export function submissionColumns(onOpen, { agent = false, employee = true } = {}) {
  return [
    { key: 'submitted_on', label: 'Submitted', render: (r) => fmtDate(r.submitted_on) },
    ...(employee ? [{ key: 'employee_name', label: 'Employee', render: (r) => (
      <>{r.employee_name}{r.open_update_request ? <div><span className="pill warning">Update requested</span></div> : null}</>) }] : []),
    ...(agent ? [{ key: 'agent_name', label: 'Agent' }] : []),
    { key: 'job_title', label: 'Role' },
    { key: 'vendor', label: 'Vendor / client', render: (r) => [r.vendor_name, r.client_name].filter(Boolean).join(' / ') || '—' },
    { key: 'status', label: 'Stage', render: (r) => <StatusPill value={r.status} /> },
    { key: 'fu', label: 'Follow-up', render: (r) => <FollowUpBadge row={r} /> },
    { key: 'x', label: '', render: (r) => <button className="link" onClick={() => onOpen(r.submission_id)}>Open</button> },
  ];
}

const TYPE_TEXT = {
  SUBMITTED: 'Profile submitted',
  FOLLOW_UP: 'Vendor follow-up',
  EMPLOYEE_FEEDBACK: 'Employee feedback',
  UPDATE_REQUEST: 'Update requested',
};

function Timeline({ activities }) {
  if (!activities.length) return <p className="muted">No activity yet.</p>;
  return (
    <ol className="timeline">
      {activities.map((a) => (
        <li key={a.activity_id} className={`tl-${a.activity_type.toLowerCase()}`}>
          <div className="tl-head">
            <strong>{TYPE_TEXT[a.activity_type]}</strong>
            {a.channel && <span className="muted"> · {CHANNEL_LABEL[a.channel]}</span>}
            {a.vendor_contact_name && <span className="muted"> · with {a.vendor_contact_name}</span>}
            <span className="tl-when">{fmtDateTime(a.created_at)} · {a.by_name || 'System'}</span>
          </div>
          {a.from_status && a.to_status && a.from_status !== a.to_status && (
            <div className="tl-stage"><StatusPill value={a.from_status} /> → <StatusPill value={a.to_status} /></div>
          )}
          {a.vendor_feedback && <p className="tl-text"><span className="tl-label">Vendor said</span>{a.vendor_feedback}</p>}
          {a.note && (
            <p className="tl-text">
              <span className="tl-label">{a.activity_type === 'FOLLOW_UP' || a.activity_type === 'SUBMITTED' ? 'Agent note' : 'Note'}</span>{a.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Agent / Marketing Manager: log a vendor follow-up, optionally moving the stage */
function FollowUpForm({ s, onSaved }) {
  const [f, setF] = useState({
    channel: '', vendor_contact_name: s.vendor_contact_name || '', vendor_feedback: '', note: '', status: s.status, next_follow_up_on: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const closing = ['PLACED', 'REJECTED', 'POSITION_CLOSED', 'NO_RESPONSE'].includes(f.status);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api(`/marketing/submissions/${s.submission_id}/follow-ups`, { method: 'POST', body: f });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form className="form-grid inset" onSubmit={submit}>
      <div className="field"><label htmlFor="fu-channel">How did you follow up? *</label>
        <select id="fu-channel" value={f.channel} onChange={set('channel')} required>
          <option value="">Choose…</option>
          {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></div>
      <div className="field"><label htmlFor="fu-contact">Vendor contact</label>
        <input id="fu-contact" value={f.vendor_contact_name} onChange={set('vendor_contact_name')} placeholder="Recruiter name" /></div>
      <div className="field"><label htmlFor="fu-stage">Stage</label>
        <select id="fu-stage" value={f.status} onChange={set('status')}>
          {STAGES.map((st) => <option key={st} value={st}>{label(st)}</option>)}
        </select></div>
      <div className="field"><label htmlFor="fu-next">Next follow-up</label>
        <input id="fu-next" type="date" value={f.next_follow_up_on} onChange={set('next_follow_up_on')} disabled={closing} />
        <p className="hint">{closing ? 'Closed: no more follow-ups.' : 'Leave empty for 3 business days from today.'}</p></div>
      <div className="field wide"><label htmlFor="fu-vendor">What did the vendor say?</label>
        <textarea id="fu-vendor" rows={2} value={f.vendor_feedback} onChange={set('vendor_feedback')} placeholder="Shown to the employee" /></div>
      <div className="field wide"><label htmlFor="fu-note">Your note</label>
        <textarea id="fu-note" rows={2} value={f.note} onChange={set('note')} placeholder="Shown to the employee" /></div>
      {error && <p className="error wide">{error}</p>}
      <div className="actions wide"><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Log follow-up'}</button></div>
    </form>
  );
}

/** Bench employee: request an update, or add their own feedback */
function EmployeeActions({ s, onSaved }) {
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const closed = s.follow_up_state === 'CLOSED';

  const send = async (path, body, reset) => {
    setError('');
    setBusy(true);
    try {
      await api(`/marketing/submissions/${s.submission_id}/${path}`, { method: 'POST', body });
      reset();
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-2 inset-block">
      <div>
        <h4>Ask for an update</h4>
        {closed ? <p className="muted">This submission is closed.</p>
          : s.open_update_request ? (
            <p className="notice-box">You asked for an update on {fmtDate(s.open_update_request.requested_on)}. Your agent has been notified{s.open_update_request.escalated_on ? ', and it was escalated to the Marketing Manager' : ''}.</p>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); send('update-request', { message: msg }, () => setMsg('')); }} className="stack">
              <label htmlFor="ur-msg">Message to your agent (optional)</label>
              <input id="ur-msg" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Any news from the vendor?" />
              <div><button type="submit" disabled={busy}>Request update</button></div>
              <p className="hint">If your agent doesn't respond within 2 business days, it goes to the Marketing Manager.</p>
            </form>
          )}
      </div>
      <div>
        <h4>Add my feedback</h4>
        <form onSubmit={(e) => { e.preventDefault(); send('feedback', { note }, () => setNote('')); }} className="stack">
          <label htmlFor="fb-note">e.g. confirm a screening call happened, or how an interview went</label>
          <textarea id="fb-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} required />
          <div><button type="submit" className="secondary" disabled={busy}>Save feedback</button></div>
        </form>
      </div>
      {error && <p className="error wide">{error}</p>}
    </div>
  );
}

/**
 * Full submission view: details, actions for the viewer's role, and the timeline.
 * mode: 'agent' (log follow-ups) | 'employee' (request update / feedback) | 'view'
 */
export function SubmissionDetail({ id, mode, onClose, onChanged }) {
  const sub = useApi(`/marketing/submissions/${id}`);
  const [showForm, setShowForm] = useState(mode === 'agent');
  const ref = useRef(null);
  const loaded = Boolean(sub.data);
  useEffect(() => {
    if (loaded) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loaded]);
  if (!sub.data) return <section className="card"><Loading {...sub} /></section>;
  const s = sub.data;
  const saved = () => { sub.reload(); onChanged?.(); if (mode === 'agent') setShowForm(false); };

  return (
    <section className="card submission-detail" ref={ref}>
      <div className="page-head">
        <h3>
          {s.job_title || 'Role'} <span className="muted">· {[s.vendor_name, s.client_name].filter(Boolean).join(' / ')}</span>
        </h3>
        <div className="actions">
          {mode === 'agent' && !showForm && <button className="secondary" onClick={() => setShowForm(true)}>Log follow-up</button>}
          <button className="link" onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="details compact">
        <div><span>Employee</span>{s.employee_name}</div>
        <div><span>Stage</span><StatusPill value={s.status} /></div>
        <div><span>Follow-up</span><FollowUpBadge row={s} /></div>
        <div><span>Submitted</span>{fmtDate(s.submitted_on)}</div>
        <div><span>Last activity</span>{fmtDate(s.last_activity_on)}</div>
        <div><span>Agent</span>{s.agent_name}</div>
        {s.position_ref && <div><span>Position ref</span>{s.position_ref}</div>}
        {s.vendor_contact_name && <div><span>Vendor contact</span>{s.vendor_contact_name}</div>}
        {s.rate && <div><span>Rate</span>{s.rate}</div>}
      </div>

      {mode !== 'employee' && s.open_update_request && (
        <p className="notice-box">
          {s.employee_name} asked for an update on {fmtDate(s.open_update_request.requested_on)}
          {s.open_update_request.message ? `: "${s.open_update_request.message}"` : '.'}
          {s.open_update_request.escalated_on ? ' Escalated to the Marketing Manager.' : ''} Logging a follow-up answers it.
        </p>
      )}

      {mode === 'agent' && showForm && <FollowUpForm s={s} onSaved={saved} />}
      {mode === 'employee' && <EmployeeActions s={s} onSaved={saved} />}

      <h4>Timeline</h4>
      <Timeline activities={s.activities} />
    </section>
  );
}
