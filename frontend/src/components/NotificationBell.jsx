import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const ICON = {
  JOB_POSTING: '💼', JOB_RESPONSE: '🙋', SUBMISSION_UPDATE: '📨', UPDATE_REQUEST: '❓',
  TIMESHEET_REJECTED: '⏱️', DOCUMENT_REJECTED: '📄',
};
const ago = (ts) => {
  const s = (Date.now() - new Date(String(ts).replace(' ', 'T')).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

/** Bell in the top bar: unread count, dropdown list, click to open. Refreshes every 30 seconds. */
export default function NotificationBell() {
  const [data, setData] = useState({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(() => { api('/notifications').then((d) => d && setData(d)).catch(() => {}); }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read_at) await api(`/notifications/${n.notification_id}/read`, { method: 'POST' }).catch(() => {});
    load();
    if (n.link) navigate(n.link);
  };
  const readAll = async () => { await api('/notifications/read-all', { method: 'POST' }).catch(() => {}); load(); };

  return (
    <div className="bell" ref={box}>
      <button type="button" className="bell-btn" onClick={() => { setOpen(!open); if (!open) load(); }}
        aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z" /></svg>
        {data.unread > 0 && <span className="bell-count">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {data.unread > 0 && <button type="button" className="link small" onClick={readAll}>Mark all read</button>}
          </div>
          {data.items.length === 0 ? <p className="muted pad">No notifications yet.</p> : (
            <ul>
              {data.items.map((n) => (
                <li key={n.notification_id}>
                  <button type="button" className={`bell-item ${n.read_at ? '' : 'unread'}`} onClick={() => openItem(n)}>
                    <span className="bell-icon" aria-hidden="true">{ICON[n.type] || '🔔'}</span>
                    <span className="bell-text">
                      <strong>{n.title}</strong>
                      {n.body && <span className="muted small">{n.body}</span>}
                      <span className="muted small">{ago(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
