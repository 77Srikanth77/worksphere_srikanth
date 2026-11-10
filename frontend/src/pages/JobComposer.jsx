import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../components/ui';

const EMPTY = { title: '', client_name: '', vendor_id: '', location: '', work_mode: '', duration: '', rate: '', skills: '', description: '' };

/** Value that only updates after the user stops typing for `ms` */
function useDebounced(value, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function MatchBar({ value }) {
  const tone = value >= 70 ? 'ok' : value >= 40 ? 'notice' : 'low';
  return (
    <span className={`match match-${tone}`} title={`${value}% match`}>
      <span className="match-bar"><span style={{ width: `${value}%` }} /></span>
      <strong>{value}%</strong>
    </span>
  );
}

/**
 * Ranked employees for the posting text, re-checked as the agent types.
 * selected / setSelected: Set of employee_ids; exclude: ids already on the posting
 */
export function MatchPanel({ posting, selected, setSelected, exclude = [] }) {
  const [scope, setScope] = useState('BENCH');
  const [state, setState] = useState({ rows: [], loading: false, error: '' });
  const key = useDebounced(JSON.stringify({ title: posting.title, skills: posting.skills, description: posting.description, scope }));

  useEffect(() => {
    const body = JSON.parse(key);
    if (!`${body.title}${body.skills}${body.description}`.trim()) { setState({ rows: [], loading: false, error: '' }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api('/jobs/match', { method: 'POST', body })
      .then((rows) => live && setState({ rows, loading: false, error: '' }))
      .catch((e) => live && setState({ rows: [], loading: false, error: e.message }));
    return () => { live = false; };
  }, [key]);

  const rows = state.rows.filter((r) => !exclude.includes(r.employee_id));
  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const sendable = rows.filter((r) => r.can_send);
  const top = sendable.filter((r) => r.score >= 40).map((r) => r.employee_id);

  return (
    <div className="match-panel">
      <div className="page-head">
        <h3>Matching employees {state.loading && <span className="muted small">· updating…</span>}</h3>
        <select aria-label="Who to match" value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: 'auto' }}>
          <option value="BENCH">On bench</option>
          <option value="ALL">Everyone (incl. on project)</option>
        </select>
      </div>
      {!rows.length && !state.loading && (
        <p className="muted">{posting.title || posting.skills || posting.description ? 'No employees found.' : 'Start typing the title, skills or duties. Matching employees appear here as you type.'}</p>
      )}
      {rows.length > 0 && (
        <div className="actions small-actions">
          <button type="button" className="link" disabled={!top.length} onClick={() => setSelected(new Set([...selected, ...top]))}>Select all ≥ 40% that I can send</button>
          {selected.size > 0 && <button type="button" className="link" onClick={() => setSelected(new Set())}>Clear selection</button>}
        </div>
      )}
      <ul className="match-list">
        {rows.map((r) => (
          <li key={r.employee_id} className={selected.has(r.employee_id) ? 'on' : ''}>
            <label className={`match-row ${r.can_send ? '' : 'disabled'}`}>
              <input type="checkbox" disabled={!r.can_send} checked={selected.has(r.employee_id)} onChange={() => toggle(r.employee_id)} />
              <span className="match-main">
                <span className="match-top">
                  <strong>{r.employee_name}</strong>
                  <MatchBar value={r.score} />
                </span>
                <span className="muted small">
                  {r.current_title || '—'} · {r.current_status === 'BENCH' ? 'On bench' : 'On project'}{r.visa_type ? ` · ${r.visa_type}` : ''}
                  {r.city || r.state ? ` · ${[r.city, r.state].filter(Boolean).join(', ')}` : ''}
                </span>
                {(r.matched_skills.length > 0 || r.missing_skills.length > 0) && (
                  <span className="skill-chips">
                    {r.matched_skills.map((s) => <span key={s} className="chip-skill have">✓ {s}</span>)}
                    {r.missing_skills.map((s) => <span key={s} className="chip-skill miss">✗ {s}</span>)}
                  </span>
                )}
                {r.matched_keywords.length > 0 && <span className="muted small">Also matches: {r.matched_keywords.join(', ')}</span>}
                {!r.can_send && <span className="muted small">{r.agent_name ? `Assigned to ${r.agent_name}` : 'Not assigned to a marketing agent'}. Only their agent can send.</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {state.error && <p className="error">{state.error}</p>}
    </div>
  );
}

// Marketing agent: describe a role, see matching employees live, send it to the chosen ones
export default function JobComposer() {
  const vendors = useApi('/vendors');
  const navigate = useNavigate();
  const [f, setF] = useState(EMPTY);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const skills = useMemo(() => f.skills.split(',').map((s) => s.trim()).filter(Boolean), [f.skills]);

  const send = async () => {
    setError('');
    if (!f.title.trim() || !f.description.trim()) { setError('Enter the job title and duties.'); return; }
    if (!selected.size) { setError('Select at least one employee to send it to.'); return; }
    setBusy(true);
    try {
      const r = await api('/jobs', { method: 'POST', body: { ...f, vendor_id: f.vendor_id || null, employee_ids: [...selected] } });
      navigate(`/jobs/${r.posting_id}`, { state: { message: `Posting sent to ${r.sent} employee(s). They've been notified.` } });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h2>New job posting</h2>
        <Link to="/jobs">Back to postings</Link>
      </div>
      <div className="composer">
        <section className="card">
          <h3>The role</h3>
          <div className="form-grid">
            <div className="field wide"><label htmlFor="j-title">Job title *</label><input id="j-title" value={f.title} onChange={set('title')} placeholder="e.g. Senior React Developer" /></div>
            <div className="field"><label htmlFor="j-client">End client</label><input id="j-client" value={f.client_name} onChange={set('client_name')} /></div>
            <div className="field"><label htmlFor="j-vendor">Vendor</label>
              <select id="j-vendor" value={f.vendor_id} onChange={set('vendor_id')}>
                <option value="">—</option>{vendors.data?.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="j-loc">Location</label><input id="j-loc" value={f.location} onChange={set('location')} placeholder="Dallas, TX" /></div>
            <div className="field"><label htmlFor="j-mode">Work mode</label>
              <select id="j-mode" value={f.work_mode} onChange={set('work_mode')}>
                <option value="">—</option><option value="ONSITE">Onsite</option><option value="HYBRID">Hybrid</option><option value="REMOTE">Remote</option>
              </select></div>
            <div className="field"><label htmlFor="j-dur">Duration</label><input id="j-dur" value={f.duration} onChange={set('duration')} placeholder="12 months+" /></div>
            <div className="field"><label htmlFor="j-rate">Rate (internal)</label><input id="j-rate" value={f.rate} onChange={set('rate')} placeholder="Not shown to employees" /></div>
            <div className="field wide"><label htmlFor="j-skills">Required skills <span className="muted small">comma-separated; these weigh most in the match</span></label>
              <input id="j-skills" value={f.skills} onChange={set('skills')} placeholder="React, Node.js, AWS, TypeScript" />
              {skills.length > 0 && <span className="skill-chips">{skills.map((s) => <span key={s} className="chip-skill">{s}</span>)}</span>}
            </div>
            <div className="field wide"><label htmlFor="j-desc">Job duties *</label>
              <textarea id="j-desc" rows={8} value={f.description} onChange={set('description')}
                placeholder="Paste the vendor's job description: responsibilities, tech stack, must-haves…" /></div>
          </div>
        </section>

        <section className="card match-card">
          <MatchPanel posting={f} selected={selected} setSelected={setSelected} />
          <div className="send-bar">
            {error && <p className="error">{error}</p>}
            <button type="button" onClick={send} disabled={busy || !selected.size}>
              {busy ? 'Sending…' : `Send to ${selected.size || ''} employee${selected.size === 1 ? '' : 's'}`}
            </button>
            <span className="muted small">Each one gets a notification and can reply interested or not.</span>
          </div>
        </section>
      </div>
    </>
  );
}
