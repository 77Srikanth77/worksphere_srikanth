import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HOME_BY_ROLE, useAuth } from '../auth';
import { BrandFooter, FullBanner } from '../branding';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await login(email, password);
      navigate(HOME_BY_ROLE[user.role] || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <FullBanner />
        <h1>WorkSphere</h1>
        <p className="muted">Workforce compliance and performance</p>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="hint">Demo: ceo@, hr@, legal@, marketing@example.com or arjun.patel@example.com · Password@123</p>
      </form>
      <BrandFooter />
    </div>
  );
}
