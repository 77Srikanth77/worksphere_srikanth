import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, fmtMoney } from '../api';
import { StatusPill } from './ui';

const wageText = (w) => (w.lca_wage_cents ? `${fmtMoney(w.lca_wage_cents)} / ${w.lca_wage_unit === 'HOUR' ? 'hour' : 'year'}` : null);

/** One work assignment: role, client location, client reporting manager, LCA, job duties. Legal & HR edit the details. */
const HOLD_TEXT = {
  OPEN: { tone: 'warn', title: 'Waiting for Legal review', text: 'This H-1B assignment changed. Legal is checking whether a new LCA or amendment is needed.' },
  AMENDMENT_REQUIRED: { tone: 'bad', title: 'LCA amendment required', text: 'Do not start or move the employee under these terms until Legal records the amended petition filing.' },
  POSTING_REQUIRED: { tone: 'info', title: 'LCA notice must be posted', text: 'Post the existing LCA notice at the new worksite for 10 business days.' },
};

export default function AssignmentCard({ w, isH1B, canEditDetails, canEnd, canDelete, showLca, onChanged, reviews = [] }) {
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null); // { impact, reason, error }
  const [error, setError] = useState('');
  const active = !w.end_date;
  const isProject = w.status === 'PROJECT';
  const lcaMissing = showLca && isH1B && active && w.status === 'PROJECT' && (!w.lca_case_number || !w.lca_wage_cents);

  const open = () => {
    setError('');
    setEdit({
      job_title: w.job_title || '', job_duties: w.job_duties || '',
      work_location: w.work_location || '', worksite_address: w.worksite_address || '', city: w.city || '', state: w.state || '', worksite_zip: w.worksite_zip || '',
      client_manager_name: w.client_manager_name || '', client_manager_title: w.client_manager_title || '',
      client_manager_email: w.client_manager_email || '', client_manager_phone: w.client_manager_phone || '',
      lca_case_number: w.lca_case_number || '', lca_wage: w.lca_wage_cents ? (w.lca_wage_cents / 100).toFixed(2) : '', lca_wage_unit: w.lca_wage_unit || 'YEAR',
    });
  };
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...edit };
      if (!showLca || !isProject) { delete body.lca_case_number; delete body.lca_wage; delete body.lca_wage_unit; }
      if (!isProject) {
        ['work_location', 'worksite_address', 'city', 'state', 'worksite_zip', 'client_manager_name', 'client_manager_title',
          'client_manager_email', 'client_manager_phone'].forEach((k) => delete body[k]);
      }
      await api(`/work/${w.work_id}/details`, { method: 'PATCH', body });
      setEdit(null);
      onChanged();
    } catch (err) { setError(err.message); }
  };
  const end = async () => {
    if (!window.confirm('End this assignment today?')) return;
    await api(`/work/${w.work_id}`, { method: 'PUT', body: { end_date: new Date().toLocaleDateString('en-CA') } });
    onChanged();
  };

  const askDelete = async () => {
    setEdit(null);
    try {
      setDel({ impact: await api(`/work/${w.work_id}/delete-check`), reason: '', error: '' });
    } catch (err) { setError(err.message); }
  };
  const confirmDelete = async (e) => {
    e.preventDefault();
    try {
      await api(`/work/${w.work_id}`, { method: 'DELETE', body: { reason: del.reason } });
      setDel(null);
      onChanged();
    } catch (err) { setDel({ ...del, error: err.message }); }
  };

  const place = [w.worksite_address, [w.city, w.state].filter(Boolean).join(', '), w.worksite_zip].filter(Boolean).join(' · ');
  return (
    <article className={`assignment ${active ? 'current' : ''}`}>
      <header className="assignment-head">
        <div>
          <StatusPill value={w.status} /> <strong>{w.client_name || (w.status === 'BENCH' ? 'Bench' : 'Internal')}</strong>
          {w.vendor_name && <span className="muted"> · via {w.vendor_name}</span>}
          <div className="assignment-title">{w.job_title ? <strong>{w.job_title}</strong> : <span className="pill critical">Job title missing</span>}</div>
          <div className="muted small">{[w.project_name, `${fmtDate(w.start_date)} – ${w.end_date ? fmtDate(w.end_date) : 'Present'}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="actions">
          {lcaMissing && <span className="pill critical">LCA details missing</span>}
          {canEditDetails && !edit && (
            <button className="secondary" onClick={open}>{isProject ? `Edit title, duties, location, manager${showLca ? ' & LCA' : ''}` : 'Edit title & duties'}</button>
          )}
          {canEnd && active && <button className="link" onClick={end}>End today</button>}
          {canDelete && !del && <button className="link danger" onClick={askDelete}>Delete</button>}
        </div>
      </header>

      {del && (
        <form className="delete-box" onSubmit={confirmDelete}>
          {!del.impact.can_delete ? (
            <>
              <p><strong>This assignment can&apos;t be deleted.</strong> It has:</p>
              <ul>{del.impact.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
              <p className="muted small">Deleting it would break billing and payroll history. Use “End today” (or set an end date) instead.</p>
              <div className="actions"><button type="button" className="secondary" onClick={() => setDel(null)}>OK</button></div>
            </>
          ) : (
            <>
              <p><strong>Delete this assignment permanently?</strong> {del.impact.work.client_name || del.impact.work.status} · {fmtDate(del.impact.work.start_date)} – {del.impact.work.end_date ? fmtDate(del.impact.work.end_date) : 'Present'}</p>
              {(del.impact.removes.draft_timesheets > 0 || del.impact.removes.bill_rates > 0) && (
                <p className="small">Also removed: {[
                  del.impact.removes.draft_timesheets ? `${del.impact.removes.draft_timesheets} unsubmitted timesheet week(s)` : null,
                  del.impact.removes.bill_rates ? `${del.impact.removes.bill_rates} bill rate(s)` : null,
                ].filter(Boolean).join(', ')}.</p>
              )}
              <label htmlFor={`del-${w.work_id}`}>Reason (kept in the audit log) *</label>
              <input id={`del-${w.work_id}`} value={del.reason} onChange={(e) => setDel({ ...del, reason: e.target.value })} required minLength={5}
                placeholder="e.g. Entered twice by mistake" autoFocus />
              {del.error && <p className="error small">{del.error}</p>}
              <div className="actions">
                <button type="submit" className="danger-btn" disabled={del.reason.trim().length < 5}>Delete permanently</button>
                <button type="button" className="secondary" onClick={() => setDel(null)}>Cancel</button>
              </div>
            </>
          )}
        </form>
      )}

      {reviews.map((r) => HOLD_TEXT[r.status] && (
        <div key={r.review_id} className={`hold-box ${HOLD_TEXT[r.status].tone}`} role="status">
          <strong>{HOLD_TEXT[r.status].title}</strong> {HOLD_TEXT[r.status].text}
          {r.changes?.length > 0 && <div className="small">{r.changes.map((c) => `${c.label}: ${c.from === '—' ? '' : `${c.from} → `}${c.to}`).join(' · ')}</div>}
          {showLca && <div className="small"><Link to="/immigration?tab=changes">Open LCA changes</Link></div>}
        </div>
      ))}

      {error && !edit && <p className="error small">{error}</p>}

      {w.status === 'PROJECT' && !edit && (
        <div className="assignment-grid">
          <div>
            <h5>Client location</h5>
            <p>{place || <span className="muted">Not recorded</span>}</p>
            {w.work_location && <p className="muted small">{w.work_location}</p>}
          </div>
          <div>
            <h5>Reporting manager at client</h5>
            {w.client_manager_name ? (
              <p>{w.client_manager_name}{w.client_manager_title ? <span className="muted"> · {w.client_manager_title}</span> : null}
                {w.client_manager_email && <><br /><a href={`mailto:${w.client_manager_email}`}>{w.client_manager_email}</a></>}
                {w.client_manager_phone && <><br /><span className="muted small">{w.client_manager_phone}</span></>}</p>
            ) : <p className="muted">Not recorded</p>}
          </div>
          {showLca && (
            <div>
              <h5>LCA</h5>
              {w.lca_case_number || w.lca_wage_cents ? (
                <p>{wageText(w) ? <strong>{wageText(w)}</strong> : <span className="muted">Wage not recorded</span>}
                  <br /><span className="muted small">{w.lca_case_number ? `Case ${w.lca_case_number}` : 'Case number not recorded'}</span></p>
              ) : <p className="muted">Not recorded</p>}
            </div>
          )}
        </div>
      )}

      {edit && (
        <form className="form-grid inset" onSubmit={save}>
          <div className="field wide"><label htmlFor={`a-title-${w.work_id}`}><h5>Job title *</h5></label>
            <input id={`a-title-${w.work_id}`} value={edit.job_title} onChange={set('job_title')} required placeholder="e.g. Data Engineer (as filed on the LCA)" /></div>
          <div className="field wide"><label htmlFor={`a-duties-${w.work_id}`}><h5>Job duties</h5></label>
            <textarea id={`a-duties-${w.work_id}`} rows={5} value={edit.job_duties} onChange={set('job_duties')}
              placeholder="Day-to-day duties at the client (should match what was filed with the petition / LCA)" /></div>
          {isProject && <>
          <div className="field wide"><h5>Client location</h5></div>
          <div className="field wide"><label htmlFor={`a-addr-${w.work_id}`}>Worksite address</label><input id={`a-addr-${w.work_id}`} value={edit.worksite_address} onChange={set('worksite_address')} placeholder="Street, floor / suite" /></div>
          <div className="field"><label htmlFor={`a-city-${w.work_id}`}>City</label><input id={`a-city-${w.work_id}`} value={edit.city} onChange={set('city')} /></div>
          <div className="field"><label htmlFor={`a-state-${w.work_id}`}>State</label><input id={`a-state-${w.work_id}`} value={edit.state} onChange={set('state')} maxLength={2} placeholder="TX" /></div>
          <div className="field"><label htmlFor={`a-zip-${w.work_id}`}>ZIP</label><input id={`a-zip-${w.work_id}`} value={edit.worksite_zip} onChange={set('worksite_zip')} /></div>
          <div className="field"><label htmlFor={`a-wl-${w.work_id}`}>Work arrangement</label><input id={`a-wl-${w.work_id}`} value={edit.work_location} onChange={set('work_location')} placeholder="Client site / Remote / Hybrid" /></div>

          <div className="field wide"><h5>Reporting manager at client</h5></div>
          <div className="field"><label htmlFor={`a-mn-${w.work_id}`}>Name</label><input id={`a-mn-${w.work_id}`} value={edit.client_manager_name} onChange={set('client_manager_name')} /></div>
          <div className="field"><label htmlFor={`a-mt-${w.work_id}`}>Title</label><input id={`a-mt-${w.work_id}`} value={edit.client_manager_title} onChange={set('client_manager_title')} /></div>
          <div className="field"><label htmlFor={`a-me-${w.work_id}`}>Email</label><input id={`a-me-${w.work_id}`} type="email" value={edit.client_manager_email} onChange={set('client_manager_email')} /></div>
          <div className="field"><label htmlFor={`a-mp-${w.work_id}`}>Phone</label><input id={`a-mp-${w.work_id}`} value={edit.client_manager_phone} onChange={set('client_manager_phone')} /></div>
          </>}

          {showLca && isProject && (
            <>
              <div className="field wide"><h5>LCA</h5></div>
              <div className="field"><label htmlFor={`a-lc-${w.work_id}`}>LCA case number</label><input id={`a-lc-${w.work_id}`} value={edit.lca_case_number} onChange={set('lca_case_number')} placeholder="I-200-XXXXX-XXXXXX" /></div>
              <div className="field"><label htmlFor={`a-lw-${w.work_id}`}>LCA wage ($)</label><input id={`a-lw-${w.work_id}`} type="number" min="0.01" step="0.01" value={edit.lca_wage} onChange={set('lca_wage')} /></div>
              <div className="field"><label htmlFor={`a-lu-${w.work_id}`}>Per</label>
                <select id={`a-lu-${w.work_id}`} value={edit.lca_wage_unit} onChange={set('lca_wage_unit')}><option value="YEAR">Year</option><option value="HOUR">Hour</option></select></div>
            </>
          )}
          {error && <p className="error wide">{error}</p>}
          <div className="actions wide"><button type="submit">Save</button><button type="button" className="secondary" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}

      {!edit && (
        <div className="assignment-duties">
          <h5>Job duties</h5>
          {w.job_duties ? <p className="prewrap">{w.job_duties}</p> : <p className="muted">Not recorded</p>}
        </div>
      )}
    </article>
  );
}
