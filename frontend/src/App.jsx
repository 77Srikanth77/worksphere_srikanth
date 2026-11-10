import { Navigate, Route, Routes } from 'react-router-dom';
import { HOME_BY_ROLE, useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import EmployeeForm from './pages/EmployeeForm';
import EmployeeDetail from './pages/EmployeeDetail';
import Immigration from './pages/Immigration';
import Marketing from './pages/Marketing';
import MyProfile from './pages/MyProfile';
import Users from './pages/Users';

/** Shows the page only to the listed roles (ADMIN sees everything). */
function RequireRole({ roles, children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted pad">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && user.role !== 'ADMIN' && !roles.includes(user.role)) {
    return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
  }
  return children;
}

export default function App() {
  const { user } = useAuth();
  const home = user ? HOME_BY_ROLE[user.role] : '/login';

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={home} replace /> : <Login />} />
      <Route element={<RequireRole><Layout /></RequireRole>}>
        <Route path="/dashboard" element={<RequireRole roles={['CEO']}><Dashboard /></RequireRole>} />
        <Route path="/employees" element={<RequireRole roles={['CEO', 'HR', 'LEGAL']}><Employees /></RequireRole>} />
        <Route path="/employees/new" element={<RequireRole roles={['HR']}><EmployeeForm /></RequireRole>} />
        <Route path="/employees/:id" element={<RequireRole roles={['CEO', 'HR', 'LEGAL', 'MARKETING']}><EmployeeDetail /></RequireRole>} />
        <Route path="/employees/:id/edit" element={<RequireRole roles={['HR']}><EmployeeForm /></RequireRole>} />
        <Route path="/immigration" element={<RequireRole roles={['CEO', 'HR', 'LEGAL']}><Immigration /></RequireRole>} />
        <Route path="/marketing" element={<RequireRole roles={['MARKETING']}><Marketing /></RequireRole>} />
        <Route path="/users" element={<RequireRole roles={['ADMIN']}><Users /></RequireRole>} />
        <Route path="/profile" element={<RequireRole roles={['EMPLOYEE']}><MyProfile /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}
