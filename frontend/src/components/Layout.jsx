import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

// Menu items per role. ADMIN sees all of them.
const NAV = [
  { to: '/dashboard', label: 'Dashboard', roles: ['CEO'] },
  { to: '/employees', label: 'Employees', roles: ['CEO', 'HR', 'LEGAL'] },
  { to: '/immigration', label: 'Immigration', roles: ['CEO', 'HR', 'LEGAL'] },
  { to: '/marketing', label: 'My Marketing', roles: ['MARKETING'] },
  { to: '/profile', label: 'My Profile', roles: ['EMPLOYEE'] },
  { to: '/users', label: 'Users', roles: ['ADMIN'] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV.filter((n) => user.role === 'ADMIN' || n.roles.includes(user.role));

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">WorkSphere</div>
        <nav>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <span>{user.full_name}</span>
          <span className="role">{user.role}</span>
          <button className="link" onClick={() => { logout(); navigate('/login'); }}>Log out</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
