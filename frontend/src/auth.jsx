import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';

const AuthContext = createContext(null);

// Landing page for each role after login
export const HOME_BY_ROLE = {
  CEO: '/dashboard',
  ADMIN: '/dashboard',
  HR: '/employees',
  LEGAL: '/immigration',
  MARKETING: '/marketing',
  MARKETING_MANAGER: '/marketing-team',
  EMPLOYEE: '/profile',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then((u) => u && setUser(u))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { token, user: u } = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(token);
    setUser(u);
    return u;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
