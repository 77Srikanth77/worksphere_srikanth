import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDownload, fmtDate } from '../api';
import { DaysLeft, DrillPanel, Loading, Stat, Table, useApi, useDrill } from '../components/ui';
import { DocState } from '../components/DocumentVault';

const ICON = { VERIFIED: '✓', EXPIRING: '!', PENDING: '…', MISSING: '✗', REJECTED: '✗', EXPIRED: '✗' };

function csv(rows, types) {
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const head = ['Employee ID', 'Employee', 'Visa', 'On file', 'Required', ...types.map((t) => t.label)];
  const lines = rows.map((r) => [r.employee_id, r.employee_name, r.visa_type, r.summary.complete, r.summary.required,
    ...types.map((t) => r.items.find((i) => i.doc_type === t.key)?.state || 'n/a')]);
  return [head, ...lines].map((l) => l.map(esc).join(',')).join('\n');
}

// HR / Legal / CEO: is every employee's paperwork complete and current?
export default function DocumentsOverview() {
  const comp = useApi('/documents/compliance');
  const queue = useApi('/documents/queue');
  const drill = useDrill();
  const [search, setSearch] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(true);
  const [visa, setVisa] = useState('');

  const rows = comp.data || [];
  // Columns = every document type that is required for at least one employee
  const types = useMemo(() => {
    const seen = new Map();
    rows.forEach((r) => r.items.forEach((i) => seen.set(i.doc_type, i.label)));
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [rows]);
  if (!comp.data) return <Loading {...comp} />;

  const gaps = (r) => r.summary.missing + r.summary.rejected + r.summary.expired + r.summary.pending + r.summary.expiring > 0;
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => (!onlyGaps || gaps(r)) && (!visa || (r.visa_type || 'None') === visa)
    && (!q || `${r.employee_name} ${r.employee_id}`.toLowerCase().includes(q)));
  const visas = [...new Set(rows.map((r) => r.visa_type || 'None'))].sort();

  // One row per document problem, for the tile lists
  const problems = (states) => rows.flatMap((r) => r.items.filter((i) => states.includes(i.state)).map((i) => ({ ...i, employee_id: r.employee_id, employee_name: r.employee_name, visa_type: r.visa_type })));
  const PROBLEM_COLUMNS = [
    { key: 'employee_name', label: 'Employee', render: (p) => <Link to={`/employees/${p.employee_id}`}>{p.employee_name}</Link> },
    { key: 'visa_type', label: 'Visa', render: (p) => p.visa_type || '—' },
    { key: 'label', label: 'Document' },
    { key: 'state', label: 'Status', render: (p) => <DocState state={p.state} /> },
    { key: 'exp', label: 'Expires', render: (p) => (p.expiry_date ? <>{fmtDate(p.expiry_date)} <DaysLeft days={p.days_left} /></> : '—') },
  ];
  const q2 = queue.data || [];
  const QUEUE_COLUMNS = [
    { key: 'employee_name', label: 'Employee', render: (d) => <Link to={`/employees/${d.employee_id}`}>{d.employee_name}</Link> },
    { key: 'type_label', label: 'Document' },
    { key: 'uploaded', label: 'Uploaded', render: (d) => `${fmtDate(d.uploaded_at)} · ${d.uploaded_by_name || '—'}` },
    { key: 'file', label: 'File', render: (d) => <button className="link" onClick={() => apiDownload(`/documents/${d.document_id}/download`, d.file_name)}>📎 {d.file_name}</button> },
    { key: 'x', label: '', render: (d) => <Link to={`/employees/${d.employee_id}`}>Review on employee page</Link> },
  ];
  const DRILLS = {
    incomplete: { title: 'Missing or rejected documents', rows: problems(['MISSING', 'REJECTED']), columns: PROBLEM_COLUMNS },
    pending: { title: 'Uploaded by employees, waiting for review', rows: q2.filter((d) => d.status === 'PENDING'), columns: QUEUE_COLUMNS },
    expiring: { title: 'Expiring within 90 days', rows: problems(['EXPIRING']), columns: PROBLEM_COLUMNS },
    expired: { title: 'Expired', rows: problems(['EXPIRED']), columns: PROBLEM_COLUMNS },
  };
  const tile = (k) => ({ onClick: () => drill.toggle(k), active: drill.is(k) });
  const complete = rows.filter((r) => !gaps(r)).length;

  return (
    <>
      <div className="page-head">
        <h2>Employee documents</h2>
        <button className="secondary" onClick={() => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv(shown, types)], { type: 'text/csv' }));
          a.download = `document-compliance-${new Date().toLocaleDateString('en-CA')}.csv`;
          a.click();
        }}>Export CSV</button>
      </div>
      <p className="hint">Each employee&apos;s required documents depend on their visa / work-authorization status. Open an employee to upload, review or replace documents.</p>

      <div className="stats">
        <Stat label="Employees fully documented" value={`${complete} of ${rows.length}`} tone={complete === rows.length ? 'good' : ''} />
        <Stat label="Missing / rejected documents" value={DRILLS.incomplete.rows.length} tone={DRILLS.incomplete.rows.length ? 'bad' : 'good'} {...tile('incomplete')} />
        <Stat label="Waiting for review" value={DRILLS.pending.rows.length} tone={DRILLS.pending.rows.length ? 'warn' : ''} {...tile('pending')} />
        <Stat label="Expiring ≤ 90 days" value={DRILLS.expiring.rows.length} tone={DRILLS.expiring.rows.length ? 'warn' : ''} {...tile('expiring')} />
        <Stat label="Expired" value={DRILLS.expired.rows.length} tone={DRILLS.expired.rows.length ? 'bad' : 'good'} {...tile('expired')} />
      </div>
      {DRILLS[drill.open] && (
        <DrillPanel title={DRILLS[drill.open].title} rows={DRILLS[drill.open].rows} columns={DRILLS[drill.open].columns} empty="Nothing here." onClose={drill.close} />
      )}

      <section className="card">
        <div className="page-head">
          <h3>Checklist by employee <span className="muted">· {shown.length}</span></h3>
          <div className="filters">
            <input aria-label="Search employees" placeholder="Search name or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select aria-label="Visa" value={visa} onChange={(e) => setVisa(e.target.value)}>
              <option value="">All visa types</option>
              {visas.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Only employees with gaps</label>
          </div>
        </div>
        <p className="muted small">✓ verified · ! expiring · … waiting for review · ✗ missing, rejected or expired · blank = not required</p>
        <div className="table-wrap">
          <table className="doc-matrix">
            <thead>
              <tr>
                <th>Employee</th><th>Visa</th><th>On file</th>
                {types.map((t) => <th key={t.key} title={t.label}><span>{t.label.replace(/ \(.*\)/, '')}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.employee_id}>
                  <td><Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link><div className="muted small">{r.employee_id}</div></td>
                  <td>{r.visa_type || '—'}</td>
                  <td className="num">{r.summary.complete}/{r.summary.required}</td>
                  {types.map((t) => {
                    const i = r.items.find((x) => x.doc_type === t.key);
                    return <td key={t.key} className={i ? `cell-${i.state.toLowerCase()}` : 'cell-na'} title={i ? `${t.label}: ${i.state.toLowerCase()}${i.expiry_date ? `, expires ${i.expiry_date}` : ''}` : 'Not required'}>{i ? ICON[i.state] : ''}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <p className="muted">{onlyGaps ? 'Every employee is fully documented.' : 'No employees match.'}</p>}
        </div>
      </section>

      <section className="card">
        <h3>Waiting for review</h3>
        <Loading {...queue} />
        {queue.data && <Table rows={q2.filter((d) => d.status === 'PENDING')} empty="Nothing to review." columns={QUEUE_COLUMNS} />}
      </section>
    </>
  );
}
