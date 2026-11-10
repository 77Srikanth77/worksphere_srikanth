import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, fmtDate } from '../api';
import { DaysLeft, Loading, StatusPill, Table, useApi } from '../components/ui';
import { DocState } from '../components/DocumentVault';

const CASE_STATUSES = ['ACTIVE', 'IN_PROGRESS', 'FILED', 'RENEWED', 'EXPIRED'];
const EMPTY = {
  employee_id: '', visa_type: 'H1B', receipt_number: '', start_date: '', expiry_date: '',
  lca_number: '', lca_start_date: '', lca_expiry_date: '', case_status: 'ACTIVE', notes: '',
};

// Legal / HR: every visa and LCA sorted by the next expiry, plus the alert inbox
export default function Immigration() {
  const { user } = useAuth();
  const canEdit = ['LEGAL', 'HR', 'ADMIN'].includes(user.role);
  const canRun = ['LEGAL', 'ADMIN'].includes(user.role);
  const [within, setWithin] = useState('');
  const visas = useApi(`/immigration${within ? `?within=${within}` : ''}`);
  const alerts = useApi('/alerts?unread=true');
  // Immigration documents on file for each employee (passport, visa stamp, I-94, I-797, LCA, EAD, I-20 ...)
  const docs = useApi('/documents/compliance');
  const immDocs = Object.fromEntries((docs.data || []).map((c) => {
    const items = c.items.filter((i) => i.category === 'Immigration');
    const worst = ['EXPIRED', 'MISSING', 'REJECTED', 'PENDING', 'EXPIRING'].find((st) => items.some((i) => i.state === st)) || 'VERIFIED';
    return [c.employee_id, { items, worst, ok: items.filter((i) => ['VERIFIED', 'EXPIRING'].includes(i.state)).length }];
  }));
  const employees = useApi(canEdit ? '/employees' : null);
  const [form, setForm] = useState(null); // null = closed; { ...fields, visa_id? } = open
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const runCheck = async () => {
    setMessage('');
    try {
      const r = await api('/reports/alerts/run', { method: 'POST' });
      setMessage(`Checked ${r.scanned} records: ${r.new_alerts} new alert(s)${r.new_alerts ? ', email sent' : ''}.`);
      alerts.reload();
    } catch (e) {
      setMessage(e.message);
    }
  };

  const markRead = async (alertId) => {
    await api(`/alerts/${alertId}/read`, { method: 'PATCH' });
    alerts.reload();
  };

  const changeStatus = async (visaId, case_status) => {
    await api(`/immigration/${visaId}`, { method: 'PUT', body: { case_status } });
    visas.reload();
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    const { visa_id, ...body } = form;
    try {
      if (visa_id) await api(`/immigration/${visa_id}`, { method: 'PUT', body });
      else await api('/immigration', { method: 'POST', body });
      setForm(null);
      visas.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const edit = (r) => setForm(Object.fromEntries(['visa_id', ...Object.keys(EMPTY)].map((k) => [k, r[k] ? String(r[k]).slice(0, k.includes('date') ? 10 : undefined) : ''])));
  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <div className="page-head">
        <h2>Immigration & compliance</h2>
        <div className="actions">
          {canRun && <button className="secondary" onClick={runCheck}>Run alert check now</button>}
          {canEdit && <button onClick={() => setForm({ ...EMPTY })}>Add visa record</button>}
        </div>
      </div>
      {message && <p className="notice-box">{message}</p>}

      <section className="card alert-card">
        <h3>Unread alerts {alerts.data?.length ? <span className="pill critical">{alerts.data.length}</span> : null}</h3>
        <Loading {...alerts} />
        <Table
          rows={alerts.data}
          empty="No unread alerts."
          columns={[
            { key: 'message', label: 'Alert' },
            { key: 'alert_type', label: 'Type' },
            { key: 'threshold_days', label: 'Window', render: (r) => (r.threshold_days ? `${r.threshold_days}-day` : 'Expired') },
            { key: 'days_left', label: 'Days left', render: (r) => <DaysLeft days={r.days_left} /> },
            { key: 'x', label: '', render: (r) => <button className="link" onClick={() => markRead(r.alert_id)}>Mark read</button> },
          ]}
        />
      </section>

      {form && (
        <form className="card form-grid" onSubmit={save}>
          <h3 className="wide">{form.visa_id ? 'Edit visa record' : 'New visa record'}</h3>
          <div className="field"><label htmlFor="v-emp">Employee *</label>
            <select id="v-emp" value={form.employee_id} onChange={setF('employee_id')} required disabled={Boolean(form.visa_id)}>
              <option value="">Choose…</option>
              {employees.data?.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.employee_id} · {e.first_name} {e.last_name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="v-type">Visa type *</label><input id="v-type" value={form.visa_type} onChange={setF('visa_type')} required /></div>
          <div className="field"><label htmlFor="v-rcpt">Receipt number</label><input id="v-rcpt" value={form.receipt_number} onChange={setF('receipt_number')} /></div>
          <div className="field"><label htmlFor="v-start">Visa start</label><input id="v-start" type="date" value={form.start_date} onChange={setF('start_date')} /></div>
          <div className="field"><label htmlFor="v-exp">Visa expiry *</label><input id="v-exp" type="date" value={form.expiry_date} onChange={setF('expiry_date')} required /></div>
          <div className="field"><label htmlFor="v-lca">LCA number</label><input id="v-lca" value={form.lca_number} onChange={setF('lca_number')} /></div>
          <div className="field"><label htmlFor="v-lstart">LCA start</label><input id="v-lstart" type="date" value={form.lca_start_date} onChange={setF('lca_start_date')} /></div>
          <div className="field"><label htmlFor="v-lexp">LCA expiry</label><input id="v-lexp" type="date" value={form.lca_expiry_date} onChange={setF('lca_expiry_date')} /></div>
          <div className="field"><label htmlFor="v-case">Case status</label>
            <select id="v-case" value={form.case_status} onChange={setF('case_status')}>{CASE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="field wide"><label htmlFor="v-notes">Notes</label><textarea id="v-notes" rows={2} value={form.notes} onChange={setF('notes')} /></div>
          {error && <p className="error wide">{error}</p>}
          <div className="actions wide">
            <button type="submit">Save</button>
            <button type="button" className="secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <section className="card">
        <div className="page-head">
          <h3>Visa & LCA register</h3>
          <select id="within" value={within} onChange={(e) => setWithin(e.target.value)}>
            <option value="">All records</option>
            <option value="30">Expiring in 30 days</option>
            <option value="90">Expiring in 90 days</option>
            <option value="180">Expiring in 180 days</option>
          </select>
        </div>
        <Loading {...visas} />
        <Table
          rows={visas.data}
          columns={[
            { key: 'employee_name', label: 'Employee', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> },
            { key: 'visa_type', label: 'Visa' },
            { key: 'receipt_number', label: 'Receipt #' },
            { key: 'expiry_date', label: 'Visa expiry', render: (r) => fmtDate(r.expiry_date) },
            { key: 'days_left', label: 'Visa', render: (r) => <DaysLeft days={r.days_left} /> },
            { key: 'lca_expiry_date', label: 'LCA expiry', render: (r) => fmtDate(r.lca_expiry_date) },
            { key: 'lca_days_left', label: 'LCA', render: (r) => <DaysLeft days={r.lca_days_left} /> },
            { key: 'docs', label: 'Documents', render: (r) => {
              const d = immDocs[r.employee_id];
              if (!d) return <span className="muted">…</span>;
              const gaps = d.items.filter((i) => !['VERIFIED'].includes(i.state));
              return (
                <Link to={`/employees/${r.employee_id}`} className="doc-cell" title={d.items.map((i) => `${i.label}: ${i.state.toLowerCase()}`).join('\n')}>
                  <span className="num">{d.ok}/{d.items.length}</span> <DocState state={d.worst} />
                  {gaps.length > 0 && <div className="muted small">{gaps.slice(0, 3).map((i) => i.label.replace(/ \(.*\)/, '')).join(', ')}{gaps.length > 3 ? '…' : ''}</div>}
                </Link>
              );
            } },
            {
              key: 'case_status', label: 'Case',
              render: (r) => (canEdit
                ? <select aria-label="Case status" value={r.case_status} onChange={(e) => changeStatus(r.visa_id, e.target.value)}>{CASE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                : <StatusPill value={r.case_status} />),
            },
            ...(canEdit ? [{ key: 'x', label: '', render: (r) => <button className="link" onClick={() => edit(r)}>Edit</button> }] : []),
          ]}
        />
      </section>
    </>
  );
}
