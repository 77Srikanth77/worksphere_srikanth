import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, fmtMoney } from '../api';
import { Loading, Stat, Table, useApi } from './ui';

const STATUS = {
  REGISTERED: 'Registered', SELECTED: 'Selected in lottery', FILED: 'Petition filed', RFE: 'RFE received',
  APPROVED: 'Approved', DENIED: 'Denied', WITHDRAWN: 'Withdrawn',
};
const MODES = { REMOTE: 'Remote', CLIENT_SITE: 'Client site', HYBRID: 'Hybrid' };
const CLOSED = ['APPROVED', 'DENIED', 'WITHDRAWN'];
const PENDING_NOTE = /not received|pending|who (is|are) this|missing/i; // Legal's "we still need details" notes
const EMPTY = {
  first_name: '', last_name: '', job_title: '', on_project: '0', client_name: '', vendor_name: '',
  lca_wage: '', work_mode: 'REMOTE', lca_location: '', case_status: 'FILED', employment_status: 'ACTIVE', notes: '',
};

const left = (r) => r.employment_status === 'LEFT';
const attention = (r) => left(r) || r.case_status === 'RFE' || PENDING_NOTE.test(r.notes || '');
const FILTERS = {
  ALL: () => true,
  WAITING: (r) => !CLOSED.includes(r.case_status) && !left(r),
  APPROVED: (r) => r.case_status === 'APPROVED',
  ATTENTION: attention,
};

/** Default approval period for a cap season "2026-27": Oct 1, 2026 to Sep 30, 2029 */
const defaultPeriod = (season) => {
  const y = Number(String(season).slice(0, 4));
  return { from: `${y}-10-01`, to: `${y + 3}-09-30` };
};

/** H-1B cap cases for one season. Approving a case puts the H-1B and LCA on the employee's record. */
export default function H1BCapCases({ canEdit }) {
  const years = useApi('/h1b-cap/years');
  const [year, setYear] = useState('');
  const season = year || years.data?.years[0]?.cap_year || years.data?.current;
  const cases = useApi(season ? `/h1b-cap?cap_year=${season}` : null);
  const [filter, setFilter] = useState('ALL');
  const [form, setForm] = useState(null);       // add / edit a person
  const [approve, setApprove] = useState(null); // approval details for one case
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // { id, text }: confirmation under that row (id null = at the top)

  const rows = cases.data || [];
  const shown = rows.filter(FILTERS[filter]);
  const seasons = [...new Set([years.data?.current, ...(years.data?.years || []).map((y) => y.cap_year)].filter(Boolean))].sort().reverse();
  const tile = (k, label, tone) => (
    <Stat label={label} value={cases.data ? rows.filter(FILTERS[k]).length : null} tone={tone}
      active={filter === k} onClick={() => setFilter(filter === k ? 'ALL' : k)} />
  );
  const close = () => { setForm(null); setApprove(null); setError(''); };
  // Bring a just-opened form into view (once, when it appears)
  const scrollIn = useCallback((el) => { if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, []);

  // ---- add / edit
  const openForm = (r) => {
    setApprove(null); setError(''); setDone(null);
    setForm(r ? {
      ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, r[k] == null ? '' : String(r[k])])),
      case_id: r.case_id, lca_wage: r.lca_wage_cents ? String(r.lca_wage_cents / 100) : '',
    } : { ...EMPTY });
  };
  const saveForm = async (e) => {
    e.preventDefault();
    setError('');
    const { case_id: id, lca_wage: wage, ...rest } = form;
    const body = { ...rest, on_project: Number(rest.on_project), lca_wage_cents: wage ? Math.round(Number(wage) * 100) : null };
    try {
      if (id) await api(`/h1b-cap/${id}`, { method: 'PUT', body });
      else await api('/h1b-cap', { method: 'POST', body: { ...body, cap_year: season } });
      setDone({ id: id || null, text: id ? 'Changes saved.' : `${form.first_name} ${form.last_name} added. Their employee record was created or linked automatically.` });
      close(); cases.reload(); years.reload();
    } catch (err) { setError(err.message); }
  };

  // ---- approve
  const openApprove = (r) => {
    setForm(null); setError(''); setDone(null);
    const p = defaultPeriod(r.cap_year);
    setApprove({
      row: r,
      receipt_number: r.receipt_number || '',
      start_date: r.visa_start_date || p.from, expiry_date: r.visa_expiry_date || p.to,
      lca_number: r.lca_number || '', lca_start_date: r.lca_start_date || p.from, lca_expiry_date: r.lca_expiry_date || p.to,
    });
  };
  const saveApprove = async (e) => {
    e.preventDefault();
    setError('');
    const { row, ...body } = approve;
    try {
      const r = await api(`/h1b-cap/${row.case_id}/approve`, { method: 'POST', body });
      setDone({ id: row.case_id, text: `Approved. The H-1B and LCA are now on ${row.first_name}'s employee record (${r.employee_id})${r.assignment_updated ? ' and current assignment' : ''}, and expiry alerts are on.` });
      close(); cases.reload();
    } catch (err) { setError(err.message); }
  };

  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setA = (k) => (e) => setApprove({ ...approve, [k]: e.target.value });
  const input = (state, setter, k, label, props = {}) => (
    <div className="field"><label htmlFor={`cap-${k}`}>{label}</label><input id={`cap-${k}`} value={state[k]} onChange={setter(k)} {...props} /></div>
  );

  // Forms open right where the user clicked: under that row (or under the header when adding someone)
  const approveForm = approve && (
      <form className="form-grid inline-form approve-form" onSubmit={saveApprove} ref={scrollIn}>
        <div className="wide">
          <h3>Approve H-1B · {approve.row.first_name} {approve.row.last_name}</h3>
          <p className="muted small">
            {approve.row.job_title} · {fmtMoney(approve.row.lca_wage_cents)} / year · {[MODES[approve.row.work_mode], approve.row.lca_location].filter(Boolean).join(', ')}
            {' '}(from the case — use Edit to change)
          </p>
        </div>
        <h4 className="wide">H-1B approval notice (I-797)</h4>
        {input(approve, setA, 'receipt_number', 'Receipt number *', { required: true, autoFocus: true, placeholder: 'WAC2690012345', pattern: '[A-Za-z]{3}\\s*[0-9]{10}', title: '3 letters and 10 digits' })}
        {input(approve, setA, 'start_date', 'Valid from *', { type: 'date', required: true })}
        {input(approve, setA, 'expiry_date', 'Valid until *', { type: 'date', required: true })}
        <h4 className="wide">LCA (certified labor condition application)</h4>
        {input(approve, setA, 'lca_number', 'LCA case number *', { required: true, placeholder: 'I-200-26100-123456' })}
        {input(approve, setA, 'lca_start_date', 'Valid from *', { type: 'date', required: true })}
        {input(approve, setA, 'lca_expiry_date', 'Valid until *', { type: 'date', required: true })}
        {error && <p className="error wide">{error}</p>}
        <div className="actions wide">
          <button type="submit">{approve.row.case_status === 'APPROVED' ? 'Save changes' : 'Approve and update employee record'}</button>
          <button type="button" className="secondary" onClick={close}>Cancel</button>
        </div>
      </form>
  );
  const editForm = form && (
      <form className={`form-grid ${form.case_id ? 'inline-form' : 'card'}`} onSubmit={saveForm} ref={scrollIn}>
        <h3 className="wide">{form.case_id ? `Edit · ${form.first_name} ${form.last_name}` : `Add person · season ${season}`}</h3>
        {input(form, setF, 'first_name', 'First name *', { required: true, autoFocus: true })}
        {input(form, setF, 'last_name', 'Last name *', { required: true })}
        {input(form, setF, 'job_title', 'Job title *', { required: true, placeholder: 'As filed on the LCA' })}
        <div className="field"><label htmlFor="cap-proj">On a project?</label>
          <select id="cap-proj" value={form.on_project} onChange={setF('on_project')}><option value="1">Yes</option><option value="0">No</option></select></div>
        {input(form, setF, 'client_name', 'Client')}
        {input(form, setF, 'vendor_name', 'Vendor')}
        {input(form, setF, 'lca_wage', 'LCA amount ($ per year)', { type: 'number', min: 1, step: 'any' })}
        <div className="field"><label htmlFor="cap-mode">Work mode</label>
          <select id="cap-mode" value={form.work_mode} onChange={setF('work_mode')}>
            <option value="">—</option>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        {input(form, setF, 'lca_location', 'LCA location', { placeholder: 'City, ST or worksite address' })}
        {form.case_status !== 'APPROVED' && (
          <div className="field"><label htmlFor="cap-status">Case status</label>
            <select id="cap-status" value={form.case_status} onChange={setF('case_status')}>
              {Object.entries(STATUS).filter(([k]) => k !== 'APPROVED').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
        )}
        <div className="field"><label htmlFor="cap-emp">Still with the company?</label>
          <select id="cap-emp" value={form.employment_status} onChange={setF('employment_status')}><option value="ACTIVE">Yes</option><option value="LEFT">No, left</option></select></div>
        <div className="field wide"><label htmlFor="cap-notes">Notes</label><textarea id="cap-notes" rows={2} value={form.notes} onChange={setF('notes')} /></div>
        {!form.case_id && <p className="muted small wide">An employee record is created automatically if this person doesn&apos;t have one yet.</p>}
        {error && <p className="error wide">{error}</p>}
        <div className="actions wide">
          <button type="submit">Save</button>
          <button type="button" className="secondary" onClick={close}>Cancel</button>
        </div>
      </form>
  );

  return (
    <section className="card">
      <div className="page-head">
        <h3>H-1B cap cases</h3>
        <select aria-label="Cap season" value={season || ''} onChange={(e) => { setYear(e.target.value); setFilter('ALL'); close(); }}>
          {seasons.map((y) => <option key={y} value={y}>Season {y}</option>)}
        </select>
        {canEdit && (
          <div className="actions">
            <Link className="button secondary" to="/import?type=H1B_CAP">Import from Excel</Link>
            <button onClick={() => openForm(null)}>Add person</button>
          </div>
        )}
      </div>
      <p className="hint">
        When a petition is approved, click <strong>Approve</strong> and enter the receipt and LCA details.
        WorkSphere adds them to the employee&apos;s record and alerts Legal 6 months before they expire.
      </p>
      {done && !done.id && <p className="notice-box">{done.text}</p>}

      <div className="stats">
        {tile('ALL', 'All cases')}
        {tile('WAITING', 'Waiting for decision', 'info')}
        {tile('APPROVED', 'Approved', 'good')}
        {tile('ATTENTION', 'Needs attention', 'bad')}
      </div>

      {form && !form.case_id && editForm}

      <Loading {...years} />
      <Loading {...cases} />
      {cases.data && (
        <Table
          rows={shown}
          renderBelow={(r) => {
            if (approve?.row.case_id === r.case_id) return approveForm;
            if (form?.case_id === r.case_id) return editForm;
            if (done?.id === r.case_id) {
              return <p className="done-note" ref={scrollIn}>✓ {done.text} <button className="link" onClick={() => setDone(null)}>Dismiss</button></p>;
            }
            return null;
          }}
          empty={rows.length ? 'No cases match this filter.' : `No cases for season ${season} yet. Use "Import from Excel" to load Legal's sheet.`}
          columns={[
            {
              key: 'name', label: 'Employee',
              render: (r) => (
                <>
                  {r.employee_id ? <Link to={`/employees/${r.employee_id}`}>{r.first_name} {r.last_name}</Link> : `${r.first_name} ${r.last_name}`}
                  {left(r) && <> <span className="pill critical">Left company</span></>}
                  {r.notes && <div className={`small ${PENDING_NOTE.test(r.notes) ? 'warn-text' : 'muted'}`}>{r.notes}</div>}
                </>
              ),
            },
            { key: 'job_title', label: 'Job title' },
            {
              key: 'client', label: 'Client',
              render: (r) => (
                <>{r.on_project ? (r.client_name || '—') : <span className="muted">No project yet</span>}
                  {r.vendor_name && <div className="muted small">via {r.vendor_name}</div>}</>
              ),
            },
            {
              key: 'lca', label: 'LCA',
              render: (r) => (
                <><span className="num">{fmtMoney(r.lca_wage_cents)}</span>
                  <div className="muted small">{[MODES[r.work_mode], r.lca_location].filter(Boolean).join(' · ')}</div></>
              ),
            },
            {
              key: 'status', label: 'Status',
              render: (r) => (
                <><span className={`pill tag-${r.case_status.toLowerCase()}`}>{STATUS[r.case_status]}</span>
                  {r.case_status === 'APPROVED' && r.visa_expiry_date && <div className="muted small">Valid until {fmtDate(r.visa_expiry_date)}</div>}</>
              ),
            },
            ...(canEdit ? [{
              key: 'x', label: '',
              render: (r) => (
                <div className="row-actions">
                  {r.case_status === 'APPROVED'
                    ? <button className="link" onClick={() => openApprove(r)}>Approval details</button>
                    : !left(r) && !['DENIED', 'WITHDRAWN'].includes(r.case_status) && <button className="small-btn" onClick={() => openApprove(r)}>Approve</button>}
                  <button className="link" onClick={() => openForm(r)}>Edit</button>
                </div>
              ),
            }] : []),
          ]}
        />
      )}
    </section>
  );
}
