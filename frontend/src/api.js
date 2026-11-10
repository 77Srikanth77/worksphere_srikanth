// Small fetch wrapper: adds the login token and turns API errors into exceptions.
const TOKEN_KEY = 'worksphere_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && token) {
    setToken(null);
    window.location.href = '/login';
    return null;
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `Request failed (${res.status})`);
  return data;
}

export const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString() : '—');

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
/** Whole cents -> "$1,234.56" */
export const fmtMoney = (cents) => (cents == null ? '—' : usd.format(cents / 100));
const UNIT_SHORT = { HOUR: 'hr', DAY: 'day', MONTH: 'mo' };
/** 9500, 'HOUR' -> "$95.00/hr" */
export const fmtRate = (cents, unit = 'HOUR') => (cents == null ? '—' : `${fmtMoney(cents)}/${UNIT_SHORT[unit] || 'hr'}`);

/** Upload one file (multipart/form-data, field "file", plus any text fields) with the login token. */
export async function apiUpload(path, file, fields = {}) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v != null && v !== '') form.append(k, v); });
  form.append('file', file);
  const token = getToken();
  const res = await fetch(`/api${path}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data;
}

/** Download a protected file: fetch with the login token, then save it under its original name. */
export async function apiDownload(path, fileName) {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Download failed (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmtSize = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
