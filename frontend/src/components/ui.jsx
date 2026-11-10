import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

/** Loads `path` from the API. Returns { data, error, loading, reload }. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const load = useCallback(() => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    api(path)
      .then((data) => setState({ data, error: '', loading: false }))
      .catch((e) => setState({ data: null, error: e.message, loading: false }));
  }, [path]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

export function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-value">{value ?? '—'}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/** Colored pill for days until a visa / LCA expires. */
export function DaysLeft({ days }) {
  if (days == null) return <span className="muted">—</span>;
  const tone = days < 0 ? 'critical' : days <= 30 ? 'critical' : days <= 90 ? 'warning' : days <= 180 ? 'notice' : 'ok';
  return <span className={`pill ${tone}`}>{days < 0 ? `Expired ${-days}d ago` : `${days} days`}</span>;
}

export function StatusPill({ value }) {
  return <span className={`pill tag-${String(value || '').toLowerCase()}`}>{String(value || '—').replace('_', ' ')}</span>;
}

export function Loading({ error, loading }) {
  if (error) return <p className="error">{error}</p>;
  if (loading) return <p className="muted">Loading…</p>;
  return null;
}

/** Simple table. columns: [{ key, label, render?(row) }] */
export function Table({ columns, rows, empty = 'Nothing here yet.' }) {
  if (!rows?.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
