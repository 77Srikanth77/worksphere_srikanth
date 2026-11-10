import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { api, fmtDate } from '../api';
import { Loading, StatusPill, Table, useApi } from '../components/ui';
import TimesheetFiles from '../components/TimesheetFiles';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const short = (d) => new Date(`${d}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
const STATUS_TEXT = { DRAFT: 'Draft (not submitted)', SUBMITTED: 'Submitted, waiting for HR', APPROVED: 'Approved', REJECTED: 'Sent back by HR', NOT_STARTED: 'Not started' };

/** One assignment's week: 7 day inputs, note, save / submit / recall */
function WeekCard({ a, ts, days, today, onSaved }) {
  const { user } = useAuth();
  const locked = ts && ['SUBMITTED', 'APPROVED'].includes(ts.status);
  const initial = () => Object.fromEntries(days.map((d) => [d, ts?.entries?.[d] != null ? String(ts.entries[d]) : '']));
  const [hours, setHours] = useState(initial);
  const [note, setNote] = useState(ts?.employee_note || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setHours(initial()); setNote(ts?.employee_note || ''); setError(''); }, [ts?.timesheet_id, ts?.status, days[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  const outside = (d) => d < a.start_date || (a.end_date && d > a.end_date);
  const disabled = (d) => locked || d > today || outside(d);
  const total = days.reduce((t, d) => t + (Number(hours[d]) || 0), 0);

  const save = async (submit) => {
    if (submit && !window.confirm(`Submit ${total} hours for the week of ${short(days[0])}? You can't edit it after HR approves.`)) return;
    setError('');
    setBusy(true);
    try {
      await api('/timesheets/mine', { method: 'PUT', body: { work_id: a.work_id, week_start: days[0], entries: hours, employee_note: note, submit } });
      onSaved(submit ? 'Week submitted to HR for approval.' : 'Draft saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const needsCopy = Boolean(a.client_timesheet_required) && !(ts?.attachments?.length);
  // Attaching a file needs a timesheet row: save the week as a draft first if it has none yet
  const ensureId = async () => {
    if (ts?.timesheet_id) return ts.timesheet_id;
    const saved = await api('/timesheets/mine', { method: 'PUT', body: { work_id: a.work_id, week_start: days[0], entries: hours, employee_note: note } });
    return saved.timesheet_id;
  };

  const recall = async () => {
    setError('');
    try {
      await api(`/timesheets/${ts.timesheet_id}/recall`, { method: 'POST' });
      onSaved('Recalled. You can edit and submit again.');
    } catch (err) {
      setError(err.message);
    }
  };
  const fillWorkweek = () => setHours(Object.fromEntries(days.map((d, i) => [d, i < 5 && !disabled(d) ? '8' : hours[d]])));

  return (
    <section className="card">
      <div className="page-head">
        <h3>{a.client_name || 'Project'} <span className="muted">· {a.project_name || a.job_title || ''}{a.vendor_name ? ` · via ${a.vendor_name}` : ''}</span></h3>
        <StatusPill value={ts?.status || 'NOT_STARTED'} />
      </div>
      {ts?.status === 'REJECTED' && ts.review_note && (
        <p className="error-box"><strong>HR sent this back:</strong> {ts.review_note}</p>
      )}
      {ts?.status === 'APPROVED' && <p className="muted">Approved by {ts.reviewed_by_name} on {fmtDate(ts.reviewed_at)}.</p>}
      {ts?.status === 'SUBMITTED' && <p className="muted">Submitted {fmtDate(ts.submitted_at)}. HR will review it.</p>}

      <div className="table-wrap">
        <table className="week-grid">
          <thead>
            <tr>{days.map((d, i) => <th key={d} className={i > 4 ? 'weekend' : ''}>{DOW[i]}<div className="muted small">{short(d)}</div></th>)}<th>Total</th></tr>
          </thead>
          <tbody>
            <tr>
              {days.map((d, i) => (
                <td key={d} className={i > 4 ? 'weekend' : ''}>
                  <input type="number" min="0" max="24" step="0.25" inputMode="decimal" aria-label={`Hours on ${DOW[i]} ${short(d)}`}
                    value={hours[d]} disabled={disabled(d)} placeholder={outside(d) ? '—' : d > today ? '' : '0'}
                    onChange={(e) => setHours({ ...hours, [d]: e.target.value })} />
                </td>
              ))}
              <td className="num strong week-total">{total}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <TimesheetFiles
        files={ts?.attachments || []}
        required={Boolean(a.client_timesheet_required)}
        canUpload={ts?.status !== 'APPROVED'}
        canDelete={(f) => ts?.status !== 'APPROVED' && f.uploaded_by === user.user_id}
        ensureId={ensureId}
        onChange={() => onSaved('Client timesheet files updated.')}
      />

      {!locked && (
        <>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor={`note-${a.work_id}`}>Note for HR (optional; required for a zero-hour week)</label>
            <input id={`note-${a.work_id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Friday was a public holiday" />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="actions" style={{ marginTop: 12 }}>
            <button type="button" className="secondary" onClick={fillWorkweek}>Fill 8h Mon–Fri</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
            <button type="button" disabled={busy || needsCopy} onClick={() => save(true)}>Submit week</button>
          </div>
          {needsCopy && <p className="hint">{a.vendor_name || a.client_name || 'This client'} requires a client-approved timesheet. Attach it above to submit.</p>}
        </>
      )}
      {ts?.status === 'SUBMITTED' && (
        <div className="actions" style={{ marginTop: 12 }}>
          {error && <p className="error">{error}</p>}
          <button type="button" className="secondary" onClick={recall}>Recall to edit</button>
        </div>
      )}
    </section>
  );
}

// Employee: enter and submit weekly hours for each project assignment
export default function MyTimesheets() {
  const [week, setWeek] = useState('');
  const data = useApi(`/timesheets/mine${week ? `?week=${week}` : ''}`);
  const [message, setMessage] = useState('');
  if (!data.data) return <Loading {...data} />;
  const d = data.data;
  const thisMonday = (() => { const x = new Date(`${d.today}T00:00:00`); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toLocaleDateString('en-CA'); })();
  const go = (w) => { setMessage(''); setWeek(w); };
  const saved = (msg) => { setMessage(msg); data.reload(); };

  return (
    <>
      <div className="page-head">
        <h2>My timesheets</h2>
        <div className="week-nav">
          <button className="secondary" onClick={() => go(addDays(d.week_start, -7))} aria-label="Previous week">‹</button>
          <strong>{short(d.days[0])} – {short(d.days[6])}, {d.days[6].slice(0, 4)}</strong>
          <button className="secondary" onClick={() => go(addDays(d.week_start, 7))} disabled={d.week_start >= thisMonday} aria-label="Next week">›</button>
          {d.week_start !== thisMonday && <button className="link" onClick={() => go(thisMonday)}>This week</button>}
        </div>
      </div>
      <p className="hint">Enter the hours you worked each day and submit the week. HR approves it, and the approved hours are used for client billing and your pay.</p>
      {message && <p className="notice-box">{message}</p>}

      {d.missing.length > 0 && (
        <div className="error-box">
          <strong>{d.missing.length} past week{d.missing.length > 1 ? 's' : ''} not submitted:</strong>{' '}
          {d.missing.map((m) => (
            <button key={`${m.work_id}-${m.week_start}`} className="chip" onClick={() => go(m.week_start)}>
              {short(m.week_start)}{m.status === 'REJECTED' ? ' (sent back)' : m.status === 'DRAFT' ? ' (draft)' : ''}
            </button>
          ))}
        </div>
      )}

      {d.assignments.length === 0 && (
        <section className="card"><p className="muted">You have no project assignment in this week, so there is nothing to enter. Bench time doesn&apos;t need a timesheet.</p></section>
      )}
      {d.assignments.map((a) => (
        <WeekCard key={`${a.work_id}-${d.week_start}`} a={a} days={d.days} today={d.today}
          ts={d.timesheets.find((t) => t.work_id === a.work_id)} onSaved={saved} />
      ))}

      <section className="card">
        <h3>Recent weeks</h3>
        <Table rows={d.recent} empty="No timesheets yet." columns={[
          { key: 'week_start', label: 'Week', render: (r) => <button className="link" onClick={() => go(r.week_start)}>{short(r.week_start)} – {short(addDays(r.week_start, 6))}</button> },
          { key: 'client_name', label: 'Client' },
          { key: 'total_hours', label: 'Hours', render: (r) => <span className="num">{r.total_hours}</span> },
          { key: 'status', label: 'Status', render: (r) => <span title={STATUS_TEXT[r.status]}><StatusPill value={r.status} /></span> },
          { key: 'review_note', label: 'HR note', render: (r) => r.review_note || '—' },
        ]} />
      </section>
    </>
  );
}
