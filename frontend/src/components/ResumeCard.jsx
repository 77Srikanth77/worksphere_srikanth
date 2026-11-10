import { useState } from 'react';
import { apiDownload, apiUpload, fmtDate } from '../api';
import { Loading, Table, useApi } from './ui';

/** Marketing: an employee's résumés (the only documents marketing can see) */
export default function ResumeCard({ employeeId }) {
  const list = useApi(`/documents?employee_id=${employeeId}`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      await apiUpload('/documents', file, { employee_id: employeeId, doc_type: 'RESUME' });
      list.reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <section className="card">
      <div className="page-head">
        <h3>Résumés</h3>
        <label className="button secondary">{busy ? 'Uploading…' : 'Upload résumé'}<input type="file" accept=".pdf,.doc,.docx" hidden onChange={add} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <Loading {...list} />
      {list.data && <Table rows={list.data} empty="No résumé on file." columns={[
        { key: 'file_name', label: 'File', render: (d) => <button className="link" onClick={() => apiDownload(`/documents/${d.document_id}/download`, d.file_name).catch((x) => setError(x.message))}>📎 {d.file_name}</button> },
        { key: 'uploaded_at', label: 'Uploaded', render: (d) => `${fmtDate(d.uploaded_at)} · ${d.uploaded_by_name || '—'}` },
      ]} />}
    </section>
  );
}
