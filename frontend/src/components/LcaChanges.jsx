import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, fmtMoney } from '../api';
import { Loading, Stat, Table, useApi } from './ui';

export const SUGGESTION = {
  AMENDMENT_LIKELY: { label: 'Amendment likely', tone: 'critical' },
  CHECK: { label: 'Legal check needed', tone: 'warning' },
  POSTING: { label: 'Notice posting', tone: 'notice' },
};
export const REVIEW_STATUS = {
  OPEN: { label: 'Awaiting Legal decision', tone: 'warning' },
  AMENDMENT_REQUIRED: { label: 'Amendment to file', tone: 'critical' },
  AMENDMENT_FILED: { label: 'Amendment filed', tone: 'ok' },
  POSTING_REQUIRED: { label: 'Notice to post', tone: 'notice' },
  POSTING_DONE: { label: 'Notice posted', tone: 'ok' },
  NO_ACTION: { label: 'No action needed', tone: 'ok' },
};
const DECISIONS = [
  { value: 'AMENDMENT_REQUIRED', title: 'New LCA and amended petition', text: 'The employee must not start or move until the amendment is filed.' },
  { value: 'POSTING_REQUIRED', title: 'Post the existing LCA notice', text: 'Same metro area: post the notice at the new worksite for 10 business days.' },
  { value: 'NO_ACTION', title: 'No action needed', text: 'The current LCA and petition already cover this change.' },
];
const today = () => new Date().toLocaleDateString('en-CA');
const Pill = ({ map, value }) => <span className={`pill ${map[value]?.tone || ''}`}>{map[value]?.label || value}</span>;

/** Changes list: "Worksite: Austin, TX → Charlotte, NC" */
export function ChangeList({ changes }) {
  return (
    <ul className="change-list">
      {changes.map((c) => (
        <li key={c.field}><span className="muted">{c.label}:</span>{' '}
          {c.from !== '—' && <>{c.from} <span aria-hidden="true">→</span><span className="sr-only"> to </span>{' '}</>}
          <strong>{c.to}</strong></li>
      ))}
    </ul>
  );
}

/**
 * LCA changes: assignment changes of H-1B employees that Legal must review, and H-1B employees on bench.
 * Legal decides; Legal (filing) or Legal / HR (notice posting) record the follow-up.
 */
export default function LcaChanges({ role }) {
  const canDecide = ['LEGAL', 'ADMIN'].includes(role);
  const canPost = ['LEGAL', 'HR', 'ADMIN'].includes(role);
  const [showAll, setShowAll] = useState(false);
  const reviews = useApi(`/lca-reviews${showAll ? '?show=all' : ''}`);
  const summary = useApi('/lca-reviews/summary');
  const bench = useApi('/lca-reviews/bench');
  const [open, setOpen] = useState(null); // { id, kind: 'decide' | 'filing' | 'posting', ...fields }
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const scrollIn = useCallback((el) => { if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, []);

  const start = (r, kind) => {
    setError(''); setDone(null);
    const preset = { AMENDMENT_LIKELY: 'AMENDMENT_REQUIRED', POSTING: 'POSTING_REQUIRED' }[r.suggestion] || '';
    setOpen({
      id: r.review_id, kind, row: r,
      decision: preset, note: '',
      receipt_number: '', filed_on: today(), new_lca_number: '',
      posted_on: today(), posting_location: '',
    });
  };
  const set = (k) => (e) => setOpen({ ...open, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const { id, kind } = open;
    try {
      if (kind === 'decide') await api(`/lca-reviews/${id}/decide`, { method: 'POST', body: { decision: open.decision, note: open.note } });
      if (kind === 'filing') await api(`/lca-reviews/${id}/amendment-filed`, { method: 'POST', body: { receipt_number: open.receipt_number, filed_on: open.filed_on, new_lca_number: open.new_lca_number } });
      if (kind === 'posting') await api(`/lca-reviews/${id}/posting-done`, { method: 'POST', body: { posted_on: open.posted_on, posting_location: open.posting_location } });
      const text = {
        decide: { AMENDMENT_REQUIRED: 'Decision saved. HR has been told the employee must not start or move until the amendment is filed.', POSTING_REQUIRED: 'Decision saved. Record the posting once the notice is up.', NO_ACTION: 'Decision saved. No further action.' }[open.decision],
        filing: 'Filing recorded. The new LCA is on the assignment and HR has been told the employee may start.',
        posting: 'Notice posting recorded.',
      }[kind];
      setDone({ id, text });
      setOpen(null);
      reviews.reload(); summary.reload();
    } catch (err) { setError(err.message); }
  };

  const field = (k, label, props = {}) => (
    <div className="field"><label htmlFor={`lr-${k}`}>{label}</label><input id={`lr-${k}`} value={open[k]} onChange={set(k)} {...props} /></div>
  );
  const form = open && (
    <form className="form-grid inline-form" onSubmit={submit} ref={scrollIn}>
      {open.kind === 'decide' && <>
        <div className="wide">
          <h3>Decide · {open.row.employee_name}</h3>
          <ul className="reason-list">{open.row.reasons.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <fieldset className="wide choice-list">
          <legend>Your decision *</legend>
          {DECISIONS.map((d) => (
            <label key={d.value} className={`choice ${open.decision === d.value ? 'on' : ''}`}>
              <input type="radio" name="decision" value={d.value} checked={open.decision === d.value} onChange={set('decision')} required />
              <span><strong>{d.title}</strong><span className="muted small">{d.text}</span></span>
            </label>
          ))}
        </fieldset>
        <div className="field wide"><label htmlFor="lr-note">Reason (kept for audits) *</label>
          <textarea id="lr-note" rows={2} value={open.note} onChange={set('note')} required minLength={5}
            placeholder="e.g. Charlotte, NC is outside the Austin-Round Rock MSA covered by LCA I-200-…" /></div>
      </>}
      {open.kind === 'filing' && <>
        <h3 className="wide">Record amendment filing · {open.row.employee_name}</h3>
        {field('receipt_number', 'Receipt number *', { required: true, autoFocus: true, placeholder: 'WAC2690012345' })}
        {field('filed_on', 'Filed on *', { type: 'date', required: true, max: today() })}
        {field('new_lca_number', 'New LCA case number *', { required: true, placeholder: 'I-200-26100-123456' })}
        <p className="muted small wide">Saving puts the new LCA number on the assignment and tells HR the employee may start.</p>
      </>}
      {open.kind === 'posting' && <>
        <h3 className="wide">Record notice posting · {open.row.employee_name}</h3>
        {field('posted_on', 'Posted on *', { type: 'date', required: true, autoFocus: true })}
        {field('posting_location', 'Where it was posted *', { required: true, placeholder: 'Two break rooms at the client site / electronic notice link' })}
        <p className="muted small wide">The notice must stay up for 10 business days.</p>
      </>}
      {error && <p className="error wide">{error}</p>}
      <div className="actions wide">
        <button type="submit">Save</button>
        <button type="button" className="secondary" onClick={() => setOpen(null)}>Cancel</button>
      </div>
    </form>
  );

  const s = summary.data;
  return (
    <>
      <section className="card">
        <div className="page-head">
          <h3>LCA changes</h3>
          <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); setOpen(null); }} /> Show completed</label>
        </div>
        <p className="hint">
          When an H-1B employee&apos;s client, worksite, work arrangement or job title changes, or they start a new project, it appears here
          with a suggested outcome. Legal makes the final decision.
        </p>
        <div className="stats">
          <Stat label="Awaiting Legal decision" value={s?.awaiting_decision} tone={s?.awaiting_decision ? 'warn' : undefined} />
          <Stat label="Amendments to file" value={s?.amendment_to_file} tone={s?.amendment_to_file ? 'bad' : undefined} />
          <Stat label="Notices to post" value={s?.posting_to_do} tone={s?.posting_to_do ? 'info' : undefined} />
          <Stat label="H-1B on bench" value={s?.h1b_on_bench} tone={s?.h1b_on_bench ? 'warn' : undefined} />
        </div>
        <Loading {...reviews} />
        {reviews.data && (
          <Table
            rows={reviews.data}
            empty={showAll ? 'No LCA changes recorded yet.' : 'Nothing to review. Changes to H-1B assignments will appear here.'}
            renderBelow={(r) => {
              if (open?.id === r.review_id) return form;
              if (done?.id === r.review_id) return <p className="done-note" ref={scrollIn}>✓ {done.text} <button className="link" onClick={() => setDone(null)}>Dismiss</button></p>;
              return null;
            }}
            columns={[
              {
                key: 'emp', label: 'Employee',
                render: (r) => (<><Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link>
                  <div className="muted small">{r.change_kind === 'NEW_ASSIGNMENT' ? 'New project' : 'Assignment changed'} · {fmtDate(r.created_at)}{r.raised_by_name ? ` · by ${r.raised_by_name}` : ''}</div></>),
              },
              { key: 'changes', label: 'What changed', render: (r) => (r.changes.length ? <ChangeList changes={r.changes} /> : <span className="muted">{r.client_name || 'New project'}</span>) },
              {
                key: 'suggestion', label: 'Suggested',
                render: (r) => (<><Pill map={SUGGESTION} value={r.suggestion} />
                  <details className="why"><summary>Why?</summary><ul className="reason-list">{r.reasons.map((t) => <li key={t}>{t}</li>)}</ul></details></>),
              },
              {
                key: 'status', label: 'Status',
                render: (r) => (
                  <><Pill map={REVIEW_STATUS} value={r.status} />
                    {r.decision_note && <div className="muted small">“{r.decision_note}”{r.decided_by_name ? ` · ${r.decided_by_name}` : ''}</div>}
                    {r.amendment_receipt && <div className="muted small">Receipt {r.amendment_receipt} · filed {fmtDate(r.amendment_filed_on)} · LCA {r.new_lca_number}</div>}
                    {r.posted_on && <div className="muted small">Posted {fmtDate(r.posted_on)} · {r.posting_location}</div>}</>
                ),
              },
              {
                key: 'x', label: '',
                render: (r) => (
                  <div className="row-actions">
                    {r.status === 'OPEN' && canDecide && <button className="small-btn" onClick={() => start(r, 'decide')}>Decide</button>}
                    {r.status === 'AMENDMENT_REQUIRED' && canDecide && <button className="small-btn" onClick={() => start(r, 'filing')}>Record filing</button>}
                    {r.status === 'POSTING_REQUIRED' && canPost && <button className="small-btn" onClick={() => start(r, 'posting')}>Record posting</button>}
                  </div>
                ),
              },
            ]}
          />
        )}
      </section>

      <section className="card">
        <h3>H-1B employees on bench</h3>
        <p className="hint">H-1B employees must keep receiving the LCA wage while on bench. Unpaid bench time violates the LCA.</p>
        <Loading {...bench} />
        {bench.data && (
          <Table
            rows={bench.data}
            empty="No H-1B employees on bench."
            columns={[
              { key: 'employee_name', label: 'Employee', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> },
              { key: 'bench_since', label: 'On bench since', render: (r) => <>{fmtDate(r.bench_since)} <span className="muted small">· {r.days_on_bench} days</span></> },
              { key: 'wage', label: 'LCA wage to keep paying', render: (r) => (r.lca_wage_cents ? <strong className="num">{fmtMoney(r.lca_wage_cents)} / {r.lca_wage_unit === 'HOUR' ? 'hour' : 'year'}</strong> : <span className="pill warning">LCA wage not recorded</span>) },
              { key: 'visa_expiry_date', label: 'H-1B valid until', render: (r) => fmtDate(r.visa_expiry_date) },
            ]}
          />
        )}
      </section>
    </>
  );
}
