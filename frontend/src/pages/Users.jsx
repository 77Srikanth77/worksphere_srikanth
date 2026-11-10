import { useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Loading, StatusPill, Table, useApi } from '../components/ui';

// Admin: create and manage login accounts (marketing agents, HR, Legal, employees, ...)
const ROLES = ['MARKETING', 'HR', 'LEGAL', 'EMPLOYEE', 'CEO', 'ADMIN'];
const EMPTY = { full_name: '', email: '', password: '', role: 'MARKETING', employee_id: '' };

export default function Users() {
  const { user: me } = useAuth();
  const users = useApi('/users');
  const employees = useApi('/employees');
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Employees that do not have a login yet
  const linked = new Set((users.data || []).map((u) => u.employee_id).filter(Boolean));
  const unlinked = (employees.data || []).filter((e) => !linked.has(e.employee_id));

  const pickEmployee = (e) => {
    const emp = unlinked.find((x) => x.employee_id === e.target.value);
    setForm({
      ...form,
      employee_id: e.target.value,
      full_name: emp ? `${emp.first_name} ${emp.last_name}` : form.full_name,
      email: emp ? emp.email : form.email,
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const body = { ...form, employee_id: form.role === 'EMPLOYEE' ? form.employee_id : null };
      const created = await api('/users', { method: 'POST', body });
      setMessage(`Account created for ${created.full_name} (${created.role}).`);
      setForm(EMPTY);
      setShowForm(false);
      users.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u) => {
    setError('');
    setMessage('');
    try {
      await api(`/users/${u.user_id}/active`, { method: 'PATCH', body: { is_active: !u.is_active } });
      users.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const rows = (users.data || []).filter((u) => !roleFilter || u.role === roleFilter);

  return (
    <>
      <div className="page-head">
        <h2>Users</h2>
        <button onClick={() => { setShowForm(!showForm); setError(''); }}>{showForm ? 'Close' : 'New user'}</button>
      </div>

      {message && <p className="notice-box">{message}</p>}

      {showForm && (
        <section className="card">
          <h3>New login account</h3>
          <form className="form-grid" onSubmit={submit}>
            <div className="field"><label htmlFor="u-role">Role *</label>
              <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, employee_id: '' })}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select></div>
            {form.role === 'EMPLOYEE' && (
              <div className="field"><label htmlFor="u-emp">Employee record *</label>
                <select id="u-emp" value={form.employee_id} onChange={pickEmployee} required>
                  <option value="">Select employee…</option>
                  {unlinked.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.employee_id} · {e.first_name} {e.last_name}</option>)}
                </select>
                {!unlinked.length && <p className="hint">Every employee already has a login. Ask HR to add the employee first.</p>}
              </div>
            )}
            <div className="field"><label htmlFor="u-name">Full name *</label><input id="u-name" value={form.full_name} onChange={set('full_name')} required /></div>
            <div className="field"><label htmlFor="u-email">Email *</label><input id="u-email" type="email" value={form.email} onChange={set('email')} required /></div>
            <div className="field"><label htmlFor="u-pass">Temporary password *</label>
              <input id="u-pass" type="password" value={form.password} onChange={set('password')} minLength={8} required autoComplete="new-password" />
              <p className="hint">At least 8 characters. Share it with the user securely.</p></div>
            {error && <p className="error wide">{error}</p>}
            <div className="actions wide"><button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create account'}</button></div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="page-head">
          <h3>All accounts</h3>
          <select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        {!showForm && error && <p className="error">{error}</p>}
        {users.data ? (
          <Table
            rows={rows}
            empty="No accounts for this role."
            columns={[
              { key: 'full_name', label: 'Name' },
              { key: 'email', label: 'Email' },
              { key: 'role', label: 'Role', render: (u) => <span className="pill">{u.role}</span> },
              { key: 'employee_id', label: 'Employee' },
              { key: 'is_active', label: 'Status', render: (u) => <StatusPill value={u.is_active ? 'ACTIVE' : 'INACTIVE'} /> },
              {
                key: 'x', label: '', render: (u) => (u.user_id === me.user_id ? <span className="muted">You</span> : (
                  <button className="link" onClick={() => toggleActive(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                )),
              },
            ]}
          />
        ) : <Loading {...users} />}
      </section>
    </>
  );
}
