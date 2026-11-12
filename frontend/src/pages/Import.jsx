import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiDownload, apiUpload, fmtDate } from '../api';
import { Loading, Stat, Table, useApi } from '../components/ui';

const ACTION = { CREATE: ['ok', 'New'], UPDATE: ['notice', 'Update'], ERROR: ['critical', 'Error'] };
const TYPE_LABEL = { EMPLOYEES: 'Employees', WORK: 'Work assignments', IMMIGRATION: 'Visa & LCA records', WORK_DETAILS: 'Assignment legal details', H1B_CAP: 'H-1B cap cases' };

// HR / Legal: fill the system from an Excel sheet (download template -> upload -> preview -> import)
export default function Import() {
  const types = useApi('/imports/types');
  const history = useApi('/imports/history');
  const [params, setParams] = useSearchParams();
  const [preview, setPreview] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [skip, setSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef(null);

  if (!types.data) return <Loading {...types} />;
  const type = types.data.find((t) => t.key === params.get('type')) || types.data[0];
  const choose = (key) => { setParams({ type: key }, { replace: true }); setPreview(null); setError(''); setDone(''); };

  const upload = async (file) => {
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) { setError('Choose an Excel (.xlsx) or CSV file. Old .xls files: open in Excel and "Save as" .xlsx.'); return; }
    setError(''); setDone(''); setPreview(null); setBusy(true); setFilter('ALL'); setSkip(false);
    try {
      setPreview(await apiUpload(`/imports/${type.key}/preview`, file));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const commit = async () => {
    const n = preview.summary.create + preview.summary.update;
    if (!window.confirm(`Import ${n} row(s) into WorkSphere? ${preview.summary.create} new, ${preview.summary.update} updated.`)) return;
    setBusy(true); setError('');
    try {
      const r = await api(`/imports/${type.key}/commit`, {
        method: 'POST',
        body: { file_name: preview.file_name, skip_errors: skip, rows: preview.rows.map(({ row, values }) => ({ row, values })) },
      });
      setDone(`Imported ${preview.file_name}: ${r.created} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ''}.`);
      setPreview(null);
      history.reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const s = preview?.summary;
  const shownCols = preview ? preview.columns.filter((c) => c.key !== 'employee_id').slice(0, 5) : [];
  const rows = preview ? preview.rows.filter((r) => filter === 'ALL' || r.action === filter) : [];
  const ready = s ? s.create + s.update : 0;

  return (
    <>
      <h2>Import from Excel</h2>
      <p className="hint">Fill WorkSphere from a spreadsheet. Each team imports the information it owns. You see a full preview, row by row, before anything is saved.</p>

      <div className="type-grid" role="radiogroup" aria-label="What are you importing?">
        {types.data.map((t) => (
          <button key={t.key} type="button" role="radio" aria-checked={t.key === type.key} className={`type-card ${t.key === type.key ? 'on' : ''}`} onClick={() => choose(t.key)}>
            <strong>{t.label}</strong>
            <span className="muted small">{t.description}</span>
            <span className="muted small">Who: {t.roles.map((r) => (r === 'LEGAL' ? 'Legal' : r)).join(', ')}</span>
          </button>
        ))}
      </div>

      <section className="card">
        <div className="page-head">
          <h3>1 · Get the template</h3>
          <button className="secondary" onClick={() => apiDownload(`/imports/${type.key}/template`, `worksphere-${type.key.toLowerCase()}-template.xlsx`).catch((e) => setError(e.message))}>
            Download {type.label} template (.xlsx)
          </button>
        </div>
        <p className="muted small">Your own sheet works too, as long as the first row has column names like these. Columns marked * are needed for new records; to update existing ones you only need {type.columns.filter((c) => type.keys.includes(c.key)).map((c) => c.label).join(' + ')}, and empty cells keep what is already saved.</p>
        <div className="col-chips">
          {type.columns.map((c) => <span key={c.key} className={`chip-skill ${c.required ? 'have' : ''}`} title={[c.help, c.example ? `e.g. ${c.example}` : ''].filter(Boolean).join(' · ')}>{c.label}{c.required ? ' *' : ''}</span>)}
        </div>
      </section>

      <section className="card">
        <h3>2 · Upload your file</h3>
        <div className={`dropzone ${drag ? 'drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}>
          <p><strong>Drop the Excel file here</strong> or</p>
          <input ref={input} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}>{busy && !preview ? 'Checking…' : 'Choose file'}</button>
          <p className="muted small">.xlsx or .csv · up to 5 MB · up to 2,000 rows</p>
        </div>
        {error && <p className="error-box" style={{ marginTop: 12 }}>{error}</p>}
        {done && <p className="notice-box" style={{ marginTop: 12 }}>✓ {done}</p>}
      </section>

      {preview && (
        <section className="card">
          <div className="page-head">
            <h3>3 · Check and import <span className="muted">· {preview.file_name}</span></h3>
            <button className="link" onClick={() => setPreview(null)}>Cancel</button>
          </div>
          <p className="muted small">
            Columns recognised: {preview.columns.map((c) => c.header).join(', ')}
            {preview.ignored_columns.length > 0 && <> · <span className="error">ignored (not recognised): {preview.ignored_columns.join(', ')}</span></>}
          </p>
          <div className="stats">
            <Stat label="Rows" value={s.total} onClick={() => setFilter('ALL')} active={filter === 'ALL'} />
            <Stat label="New records" value={s.create} tone="good" onClick={() => setFilter('CREATE')} active={filter === 'CREATE'} />
            <Stat label="Updates" value={s.update} onClick={() => setFilter('UPDATE')} active={filter === 'UPDATE'} />
            <Stat label="Rows with errors" value={s.errors} tone={s.errors ? 'bad' : 'good'} onClick={() => setFilter('ERROR')} active={filter === 'ERROR'} />
          </div>
          <Table rows={rows} empty="No rows here." columns={[
            { key: 'row', label: 'Row', render: (r) => <span className="num muted">{r.row}</span> },
            { key: 'action', label: 'Result', render: (r) => <span className={`pill ${ACTION[r.action][0]}`}>{ACTION[r.action][1]}</span> },
            { key: 'key', label: 'Record', render: (r) => <strong>{r.key}</strong> },
            ...shownCols.map((c) => ({ key: c.key, label: c.label, render: (r) => <span className="cell-clip">{(c.key === 'on_project' ? { 1: 'Yes', 0: 'No' }[r.values[c.key]] : r.values[c.key]) || <span className="muted">—</span>}</span> })),
            { key: 'msg', label: 'Notes', render: (r) => (
              <>{r.errors.map((e) => <div key={e} className="error small">✗ {e}</div>)}
                {r.warnings.map((w) => <div key={w} className="small warn-text">! {w}</div>)}
                {!r.errors.length && !r.warnings.length ? <span className="muted">OK</span> : null}</>) },
          ]} />
          <div className="send-bar">
            {s.errors > 0 && (
              <label className="check"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Skip the {s.errors} row(s) with errors and import the rest</label>
            )}
            <button onClick={commit} disabled={busy || !ready || (s.errors > 0 && !skip)}>{busy ? 'Importing…' : `Import ${ready} row${ready === 1 ? '' : 's'}`}</button>
            {s.errors > 0 && !skip && <span className="muted small">Fix the errors in Excel and upload again, or tick “skip”.</span>}
          </div>
        </section>
      )}

      <section className="card">
        <h3>Recent imports</h3>
        <Loading {...history} />
        {history.data && <Table rows={history.data} empty="No imports yet." columns={[
          { key: 'imported_at', label: 'When', render: (h) => fmtDate(h.imported_at) },
          { key: 'import_type', label: 'Type', render: (h) => TYPE_LABEL[h.import_type] || h.import_type },
          { key: 'file_name', label: 'File' },
          { key: 'counts', label: 'Result', render: (h) => `${h.created} added · ${h.updated} updated${h.skipped ? ` · ${h.skipped} skipped` : ''}` },
          { key: 'imported_by_name', label: 'By' },
        ]} />}
      </section>
    </>
  );
}
