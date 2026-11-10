import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { api, apiDownload, apiUpload, fmtDate, fmtSize } from '../api';
import { DaysLeft, Loading, StatusPill, Table, useApi } from './ui';

const STATE_TEXT = {
  MISSING: 'Missing', PENDING: 'Waiting for HR review', REJECTED: 'Rejected, upload again', VERIFIED: 'Verified',
  EXPIRING: 'Expiring soon', EXPIRED: 'Expired',
};
const STATE_TONE = { MISSING: 'critical', REJECTED: 'critical', EXPIRED: 'critical', PENDING: 'notice', EXPIRING: 'warning', VERIFIED: 'ok' };
export const DocState = ({ state }) => <span className={`pill ${STATE_TONE[state] || ''}`}>{STATE_TEXT[state] || state}</span>;

/** Upload form: type, file, number, dates, notes */
function UploadForm({ types, presetType, employeeId, mine, onDone, onCancel }) {
  const [f, setF] = useState({ doc_type: presetType || '', doc_number: '', issue_date: '', expiry_date: '', notes: '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, []);
  const t = types.find((x) => x.key === f.doc_type);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { setError('Choose the file to upload.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('File is larger than 10 MB.'); return; }
    setError('');
    setBusy(true);
    try {
      await apiUpload(mine ? '/documents/mine' : '/documents', file, { ...f, employee_id: mine ? undefined : employeeId });
      onDone(mine ? `${t?.label || 'Document'} uploaded. HR will review it.` : `${t?.label || 'Document'} uploaded and marked verified.`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const groups = [...new Set(types.map((x) => x.category))];
  return (
    <form className="form-grid inset" onSubmit={submit} ref={ref}>
      <div className="field"><label htmlFor="d-type">Document *</label>
        <select id="d-type" value={f.doc_type} onChange={set('doc_type')} required>
          <option value="">Choose…</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {types.filter((x) => x.category === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </optgroup>
          ))}
        </select></div>
      <div className="field"><label htmlFor="d-file">File * <span className="muted small">PDF, photo or Word · max 10 MB</span></label>
        <input id="d-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx" onChange={(e) => setFile(e.target.files[0] || null)} required /></div>
      {t?.numberLabel && (
        <div className="field"><label htmlFor="d-num">{t.numberLabel}</label>
          <input id="d-num" value={f.doc_number} onChange={set('doc_number')} maxLength={f.doc_type === 'SSN_CARD' ? 4 : 40} /></div>
      )}
      <div className="field"><label htmlFor="d-issue">Issue date</label><input id="d-issue" type="date" value={f.issue_date} onChange={set('issue_date')} /></div>
      {(t?.expires || !t) && (
        <div className="field"><label htmlFor="d-exp">{f.doc_type === 'I94' ? 'Admit until date' : 'Expiry date'}{t?.expires ? ' *' : ''}</label>
          <input id="d-exp" type="date" value={f.expiry_date} onChange={set('expiry_date')} required={Boolean(t?.expires)} /></div>
      )}
      <div className="field wide"><label htmlFor="d-notes">Notes</label><input id="d-notes" value={f.notes} onChange={set('notes')} /></div>
      {error && <p className="error wide">{error}</p>}
      <div className="actions wide">
        <button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** HR / Legal: check details, then verify or reject an employee's upload */
function ReviewForm({ doc, onDone, onCancel }) {
  const [f, setF] = useState({ doc_number: doc.doc_number || '', issue_date: doc.issue_date || '', expiry_date: doc.expiry_date || '', note: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const decide = async (status) => {
    setError('');
    try {
      await api(`/documents/${doc.document_id}`, { method: 'PATCH', body: { doc_number: f.doc_number, issue_date: f.issue_date, expiry_date: f.expiry_date } });
      await api(`/documents/${doc.document_id}/review`, { method: 'PATCH', body: { status, note: f.note } });
      onDone(status === 'VERIFIED' ? `${doc.type_label} verified.` : `${doc.type_label} rejected; the employee will see your reason.`);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="form-grid inset">
      <div className="wide">
        <strong>Review {doc.type_label}</strong> <span className="muted">· {doc.file_name} · uploaded by {doc.uploaded_by_name} on {fmtDate(doc.uploaded_at)}</span>{' '}
        <button type="button" className="link" onClick={() => apiDownload(`/documents/${doc.document_id}/download`, doc.file_name).catch((e) => setError(e.message))}>Open file</button>
      </div>
      <div className="field"><label htmlFor="r-num">Number</label><input id="r-num" value={f.doc_number} onChange={set('doc_number')} /></div>
      <div className="field"><label htmlFor="r-issue">Issue date</label><input id="r-issue" type="date" value={f.issue_date} onChange={set('issue_date')} /></div>
      <div className="field"><label htmlFor="r-exp">Expiry date</label><input id="r-exp" type="date" value={f.expiry_date} onChange={set('expiry_date')} /></div>
      <div className="field wide"><label htmlFor="r-note">Reason (required to reject)</label>
        <input id="r-note" value={f.note} onChange={set('note')} placeholder="e.g. Photo is blurry, please upload a clear scan of the bio page" /></div>
      {error && <p className="error wide">{error}</p>}
      <div className="actions wide">
        <button type="button" onClick={() => decide('VERIFIED')}>Verify</button>
        <button type="button" className="secondary" onClick={() => decide('REJECTED')}>Reject</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Required-document checklist + all documents on file.
 *  employeeId  HR / Legal / CEO view of an employee
 *  mine        the signed-in employee's own documents
 */
export default function DocumentVault({ employeeId, mine }) {
  const { user } = useAuth();
  const data = useApi(mine ? '/documents/mine' : `/documents/checklist/${employeeId}`);
  const types = useApi('/documents/types');
  const [upload, setUpload] = useState(null); // { type }
  const [review, setReview] = useState(null); // doc
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canManage = !mine && ['HR', 'LEGAL', 'ADMIN'].includes(user.role);
  const canUpload = mine || canManage;
  const canDelete = (d) => (mine ? d.status === 'PENDING' && d.uploaded_by === user.user_id : ['HR', 'ADMIN'].includes(user.role));

  const done = (msg) => { setUpload(null); setReview(null); setMessage(msg); data.reload(); };
  const download = (d) => apiDownload(`/documents/${d.document_id}/download`, d.file_name).catch((e) => setError(e.message));
  const remove = async (d) => {
    if (!window.confirm(`Delete ${d.type_label} (${d.file_name})? This cannot be undone.`)) return;
    try {
      await api(`/documents/${d.document_id}`, { method: 'DELETE' });
      done(`${d.type_label} deleted.`);
    } catch (e) { setError(e.message); }
  };

  if (!data.data || !types.data) return <section className="card"><h3>{mine ? 'My documents' : 'Documents'}</h3><Loading {...data} /></section>;
  const c = data.data;
  const s = c.summary;
  const required = new Set(c.items.map((i) => i.doc_type));
  const others = c.documents.filter((d) => !required.has(d.doc_type));

  return (
    <section className="card">
      <div className="page-head">
        <h3>{mine ? 'My documents' : 'Documents'} <span className="muted">· {c.visa_type ? `${c.visa_type} checklist` : 'no visa on file'}</span></h3>
        {canUpload && !upload && <button className="secondary" onClick={() => { setUpload({ type: '' }); setMessage(''); }}>Upload document</button>}
      </div>
      <div className="progress-line">
        <div className="progress"><span style={{ width: `${s.required ? (s.complete / s.required) * 100 : 100}%` }} /></div>
        <span><strong>{s.complete} of {s.required}</strong> required documents on file
          {s.missing ? <> · <span className="error">{s.missing} missing</span></> : null}
          {s.pending ? ` · ${s.pending} waiting for review` : ''}
          {s.expired ? <> · <span className="error">{s.expired} expired</span></> : null}
          {s.expiring ? ` · ${s.expiring} expiring soon` : ''}</span>
      </div>
      {mine && <p className="hint">Upload clear scans or photos. HR verifies each document. You can remove an upload while it is still waiting for review.</p>}
      {message && <p className="notice-box">{message}</p>}
      {error && <p className="error">{error}</p>}

      {upload && <UploadForm key={upload.type} types={types.data} presetType={upload.type} employeeId={employeeId} mine={mine} onDone={done} onCancel={() => setUpload(null)} />}
      {review && <ReviewForm key={review.document_id} doc={review} onDone={done} onCancel={() => setReview(null)} />}

      <Table
        rows={c.items}
        columns={[
          { key: 'label', label: 'Required document', render: (i) => <>{i.label}<div className="muted small">{i.category}</div></> },
          { key: 'state', label: 'Status', render: (i) => <>{<DocState state={i.state} />}{i.state === 'REJECTED' && i.current?.review_note ? <div className="error small">{i.current.review_note}</div> : null}</> },
          { key: 'num', label: 'Number', render: (i) => i.current?.doc_number || '—' },
          { key: 'exp', label: 'Expires', render: (i) => (i.current?.expiry_date ? <>{fmtDate(i.current.expiry_date)} <DaysLeft days={i.current.days_left} /></> : (i.expires && i.current ? <span className="error small">No date</span> : '—')) },
          { key: 'file', label: 'File', render: (i) => (i.current ? <button className="link" onClick={() => download(i.current)}>📎 {i.current.file_name}</button> : '—') },
          { key: 'x', label: '', render: (i) => (
            <div className="row-actions">
              {canManage && i.current?.status === 'PENDING' && <button className="link" onClick={() => { setReview(i.current); setUpload(null); }}>Review</button>}
              {canUpload && <button className="link" onClick={() => { setUpload({ type: i.doc_type }); setReview(null); setMessage(''); }}>{i.current ? 'Upload new' : 'Upload'}</button>}
            </div>) },
        ]}
      />

      {others.length > 0 && (
        <>
          <h4>Other documents</h4>
          <Table rows={others} columns={[
            { key: 'type_label', label: 'Document' },
            { key: 'status', label: 'Status', render: (d) => <StatusPill value={d.status} /> },
            { key: 'doc_number', label: 'Number', render: (d) => d.doc_number || '—' },
            { key: 'exp', label: 'Expires', render: (d) => (d.expiry_date ? <>{fmtDate(d.expiry_date)} <DaysLeft days={d.days_left} /></> : '—') },
            { key: 'file', label: 'File', render: (d) => <button className="link" onClick={() => download(d)}>📎 {d.file_name}</button> },
            { key: 'x', label: '', render: (d) => (
              <div className="row-actions">
                {canManage && d.status === 'PENDING' && <button className="link" onClick={() => setReview(d)}>Review</button>}
                {canDelete(d) && <button className="link danger" onClick={() => remove(d)}>Delete</button>}
              </div>) },
          ]} />
        </>
      )}

      {c.documents.length > 0 && (
        <details className="history">
          <summary>All uploads, including older versions ({c.documents.length})</summary>
          <Table rows={c.documents} columns={[
            { key: 'type_label', label: 'Document' },
            { key: 'file_name', label: 'File', render: (d) => <button className="link" onClick={() => download(d)}>{d.file_name}</button> },
            { key: 'size', label: 'Size', render: (d) => fmtSize(d.size_bytes) },
            { key: 'uploaded', label: 'Uploaded', render: (d) => `${fmtDate(d.uploaded_at)} · ${d.uploaded_by_name || '—'}` },
            { key: 'status', label: 'Status', render: (d) => <>{<StatusPill value={d.status} />}{d.reviewed_by_name && d.status !== 'PENDING' ? <div className="muted small">by {d.reviewed_by_name}</div> : null}</> },
            { key: 'x', label: '', render: (d) => (canDelete(d) ? <button className="link danger" onClick={() => remove(d)}>Delete</button> : null) },
          ]} />
        </details>
      )}
    </section>
  );
}
