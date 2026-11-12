import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { BrandBanner, BrandFooter } from '../branding';
import { navFor } from '../nav';
import NotificationBell from './NotificationBell';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = navFor(user.role);

  return (
    <div className="shell">
      <BrandBanner />
      <header className="topbar">
        <Link to="/home" className="brand" aria-label="WorkSphere home" title="Home">
          <span className="brand-name">WorkSphere</span>
        </Link>
        <nav>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <NotificationBell />
          <span>{user.full_name}</span>
          <span className="role">{user.role}</span>
          <button className="link" onClick={() => { logout(); navigate('/login'); }}>Log out</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <BrandFooter />
    </div>
  );
}
