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
import Home from './pages/Home';
import JobPostings from './pages/JobPostings';
import JobComposer from './pages/JobComposer';
import JobPosting from './pages/JobPosting';
import MyJobs from './pages/MyJobs';
import MarketingTeam from './pages/MarketingTeam';
import Finance from './pages/Finance';
import MyTimesheets from './pages/MyTimesheets';
import Timesheets from './pages/Timesheets';
import DocumentsOverview from './pages/DocumentsOverview';

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
        <Route path="/home" element={<Home />} />
        <Route path="/jobs" element={<RequireRole roles={['MARKETING', 'MARKETING_MANAGER']}><JobPostings /></RequireRole>} />
        <Route path="/jobs/new" element={<RequireRole roles={['MARKETING', 'MARKETING_MANAGER']}><JobComposer /></RequireRole>} />
        <Route path="/jobs/:id" element={<RequireRole roles={['MARKETING', 'MARKETING_MANAGER']}><JobPosting /></RequireRole>} />
        <Route path="/my-jobs" element={<RequireRole roles={['EMPLOYEE']}><MyJobs /></RequireRole>} />
        <Route path="/my-jobs/:id" element={<RequireRole roles={['EMPLOYEE']}><MyJobs /></RequireRole>} />
        <Route path="/dashboard" element={<RequireRole roles={['CEO']}><Dashboard /></RequireRole>} />
        <Route path="/employees" element={<RequireRole roles={['CEO', 'HR', 'LEGAL', 'MARKETING_MANAGER']}><Employees /></RequireRole>} />
        <Route path="/employees/new" element={<RequireRole roles={['HR']}><EmployeeForm /></RequireRole>} />
        <Route path="/employees/:id" element={<RequireRole roles={['CEO', 'HR', 'LEGAL', 'MARKETING', 'MARKETING_MANAGER']}><EmployeeDetail /></RequireRole>} />
        <Route path="/employees/:id/edit" element={<RequireRole roles={['HR']}><EmployeeForm /></RequireRole>} />
        <Route path="/immigration" element={<RequireRole roles={['CEO', 'HR', 'LEGAL']}><Immigration /></RequireRole>} />
        <Route path="/marketing" element={<RequireRole roles={['MARKETING']}><Marketing /></RequireRole>} />
        <Route path="/timesheets" element={<RequireRole roles={['EMPLOYEE']}><MyTimesheets /></RequireRole>} />
        <Route path="/timesheet-review" element={<RequireRole roles={['HR', 'CEO']}><Timesheets /></RequireRole>} />
        <Route path="/documents" element={<RequireRole roles={['HR', 'LEGAL', 'CEO']}><DocumentsOverview /></RequireRole>} />
        <Route path="/finance" element={<RequireRole roles={['CEO', 'HR']}><Finance /></RequireRole>} />
        <Route path="/marketing-team" element={<RequireRole roles={['CEO', 'MARKETING_MANAGER']}><MarketingTeam /></RequireRole>} />
        <Route path="/users" element={<RequireRole roles={['ADMIN']}><Users /></RequireRole>} />
        <Route path="/profile" element={<RequireRole roles={['EMPLOYEE']}><MyProfile /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}
