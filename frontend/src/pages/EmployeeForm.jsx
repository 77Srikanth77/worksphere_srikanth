import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

// Fields of the EMP table, in form order
const FIELDS = [
  { name: 'employee_id', label: 'Employee ID', required: true, createOnly: true },
  { name: 'first_name', label: 'First name', required: true },
  { name: 'middle_name', label: 'Middle name' },
  { name: 'last_name', label: 'Last name', required: true },
  { name: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { name: 'hire_date', label: 'Hire date', type: 'date', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'phone_number', label: 'Phone number', type: 'tel' },
  { name: 'emergency_contact_name', label: 'Emergency contact name' },
  { name: 'emergency_contact_number', label: 'Emergency contact number', type: 'tel' },
];

const EMPTY = Object.fromEntries([...FIELDS.map((f) => [f.name, '']), ['bio', '']]);

export default function EmployeeForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    api(`/employees/${id}`)
      .then((emp) => setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, emp[k] ? String(emp[k]).slice(0, k.includes('date') ? 10 : undefined) : '']))))
      .catch((e) => setError(e.message));
  }, [id, isEdit]);

  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const saved = isEdit
        ? await api(`/employees/${id}`, { method: 'PUT', body: form })
        : await api('/employees', { method: 'POST', body: form });
      navigate(`/employees/${saved.employee_id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2>{isEdit ? `Edit employee ${id}` : 'New employee'}</h2>
      <form className="card form-grid" onSubmit={submit}>
        {FIELDS.map((f) => (
          <div key={f.name} className="field">
            <label htmlFor={f.name}>{f.label}{f.required && ' *'}</label>
            <input
              id={f.name}
              type={f.type || 'text'}
              value={form[f.name]}
              onChange={set(f.name)}
              required={f.required}
              disabled={isEdit && f.createOnly}
            />
          </div>
        ))}
        <div className="field wide">
          <label htmlFor="bio">Bio / skills summary</label>
          <textarea id="bio" rows={4} value={form.bio} onChange={set('bio')} />
        </div>
        {error && <p className="error wide">{error}</p>}
        <div className="actions wide">
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save employee'}</button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </>
  );
}
