import { useRef, useState } from 'react';
import { api, apiDownload, apiUpload, fmtSize } from '../api';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.csv';

/**
 * Client-approved timesheet copies for one week.
 *  files        attachments already on the timesheet
 *  canUpload    show the upload button
 *  canDelete(f) whether this viewer may remove a file
 *  ensureId()   returns the timesheet id, creating a draft first if the week has none yet
 *  compact      one-line list for tables
 */
export default function TimesheetFiles({ files = [], required, canUpload, canDelete = () => false, ensureId, onChange, compact }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (e) => {
    const chosen = [...e.target.files];
    e.target.value = '';
    if (!chosen.length) return;
    setError('');
    setBusy(true);
    try {
      const id = await ensureId();
      for (const f of chosen) {
        if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} is larger than 10 MB.`);
        await apiUpload(`/timesheets/${id}/attachments`, f);
      }
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (f) => {
    if (!window.confirm(`Remove ${f.file_name}?`)) return;
    setError('');
    try {
      await api(`/timesheets/attachments/${f.attachment_id}`, { method: 'DELETE' });
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };
  const download = (f) => apiDownload(`/timesheets/attachments/${f.attachment_id}/download`, f.file_name).catch((err) => setError(err.message));

  return (
    <div className={compact ? 'ts-files compact' : 'ts-files'}>
      {!compact && (
        <div className="ts-files-head">
          <strong>Client-approved timesheet</strong>
          {required ? <span className={`pill ${files.length ? 'ok' : 'critical'}`}>{files.length ? 'Attached' : 'Required'}</span>
            : <span className="muted small">optional</span>}
        </div>
      )}
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.attachment_id}>
              <button type="button" className="link" onClick={() => download(f)} title={`Uploaded by ${f.uploaded_by_name || '—'}`}>📎 {f.file_name}</button>
              {!compact && <span className="muted small"> {fmtSize(f.size_bytes)} · {f.uploaded_by_name}</span>}
              {canDelete(f) && <button type="button" className="link danger small" onClick={() => remove(f)} aria-label={`Remove ${f.file_name}`}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {compact && !files.length && (required ? <span className="pill critical">Copy missing</span> : <span className="muted">—</span>)}
      {canUpload && (
        <>
          <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={pick} />
          <button type="button" className={compact ? 'link small' : 'secondary'} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Uploading…' : compact ? '+ Attach' : 'Attach file'}
          </button>
          {!compact && <span className="muted small"> PDF, image, Word or Excel · max 10 MB</span>}
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
