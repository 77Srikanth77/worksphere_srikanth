import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Number tile. With onClick it becomes a button that opens the list behind the number
 * (shown in a <DrillPanel> below the tiles); `active` marks the tile whose list is open.
 */
export function Stat({ label, value, tone, onClick, active }) {
  const body = (
    <>
      <div className="stat-value">{value ?? '—'}</div>
      <div className="stat-label">{label}</div>
      {onClick && <div className="stat-more">{active ? 'Hide list ▴' : 'View list ▾'}</div>}
    </>
  );
  if (!onClick) return <div className={`stat ${tone || ''}`}>{body}</div>;
  return (
    <button type="button" className={`stat clickable ${tone || ''} ${active ? 'active' : ''}`} onClick={onClick} aria-expanded={!!active}>
      {body}
    </button>
  );
}

/** Tracks which tile's list is open. Clicking the same tile again closes it. */
export function useDrill() {
  const [open, setOpen] = useState(null);
  return {
    open,
    toggle: (key) => setOpen((cur) => (cur === key ? null : key)),
    close: () => setOpen(null),
    is: (key) => open === key,
  };
}

/** The list behind a clicked tile. Scrolls itself into view when it opens or changes. */
export function DrillPanel({ title, rows, columns, empty, loading, error, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [title]);
  return (
    <section className="card drill" ref={ref} aria-live="polite">
      <div className="page-head">
        <h3>{title} <span className="muted">· {rows ? rows.length : '…'}</span></h3>
        <button className="link" onClick={onClose}>Close</button>
      </div>
      {children}
      {rows ? <Table rows={rows} columns={columns} empty={empty} /> : <Loading loading={loading ?? true} error={error} />}
    </section>
  );
}

/** Colored pill for days until a visa / LCA expires. */
export function DaysLeft({ days }) {
  if (days == null) return <span className="muted">—</span>;
  const tone = days < 0 ? 'critical' : days <= 30 ? 'critical' : days <= 90 ? 'warning' : days <= 180 ? 'notice' : 'ok';
  return <span className={`pill ${tone}`}>{days < 0 ? `Expired ${-days}d ago` : `${days} days`}</span>;
}

export function StatusPill({ value }) {
  return <span className={`pill tag-${String(value || '').toLowerCase()}`}>{String(value || '—').replaceAll('_', ' ')}</span>;
}

export function Loading({ error, loading }) {
  if (error) return <p className="error">{error}</p>;
  if (loading) return <p className="muted">Loading…</p>;
  return null;
}

/**
 * Simple table. columns: [{ key, label, render?(row) }]
 * renderBelow(row) -> optional content (e.g. a form) shown in a full-width row right under that row.
 */
export function Table({ columns, rows, empty = 'Nothing here yet.', renderBelow }) {
  if (!rows?.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const below = renderBelow ? renderBelow(r) : null;
            return (
              <Fragment key={r.id ?? i}>
                <tr className={below ? 'row-open' : undefined}>
                  {columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
                </tr>
                {below && <tr className="row-below"><td colSpan={columns.length}>{below}</td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
