import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { fmtDate, fmtMoney } from '../api';
import { useApi } from '../components/ui';
import { COMPANY_NAME, CompanyLogo } from '../branding';
import { navFor } from '../nav';

// Data each role's Home needs. A source loads only if the viewer's role may call it.
// ADMIN may call all of them except `own` ones, which are about the signed-in person's own work.
const SOURCES = {
  summary: { path: '/reports/summary', roles: ['CEO', 'HR', 'LEGAL'] },
  timesheets: { path: '/timesheets/summary', roles: ['CEO', 'HR'] },
  docs: { path: '/documents/compliance', roles: ['CEO', 'HR', 'LEGAL'] },
  finance: { path: '/finance/summary', roles: ['CEO', 'HR'] },
  team: { path: '/marketing/team', roles: ['CEO', 'MARKETING_MANAGER'] },
  agent: { path: '/marketing/dashboard', roles: ['MARKETING'], own: true },
  alerts: { path: '/alerts?unread=true', roles: ['CEO', 'HR', 'LEGAL'] },
  expiring: { path: '/immigration?within=90', roles: ['CEO', 'HR', 'LEGAL'] },
  lca: { path: '/lca-reviews/summary', roles: ['CEO', 'HR', 'LEGAL'] },
  myTimesheets: { path: '/timesheets/mine', roles: ['EMPLOYEE'], own: true },
  myDocs: { path: '/documents/mine', roles: ['EMPLOYEE'], own: true },
  myProfile: { path: '/me/profile', roles: ['EMPLOYEE'], own: true },
  myJobs: { path: '/jobs/mine', roles: ['EMPLOYEE'], own: true },
  postings: { path: '/jobs', roles: ['MARKETING', 'MARKETING_MANAGER'], own: true },
  users: { path: '/users', roles: ['ADMIN'] },
};

/** Turns the loaded data into "needs your attention" items for this role */
function buildTasks(role, d) {
  const t = [];
  const add = (show, item) => { if (show) t.push(item); };
  const is = (...roles) => role === 'ADMIN' || roles.includes(role);
  const docTotals = (d.docs || []).reduce((a, r) => {
    a.pending += r.summary.pending; a.expired += r.summary.expired; a.expiring += r.summary.expiring;
    if (r.summary.missing + r.summary.rejected > 0) a.incomplete += 1;
    r.items.filter((i) => i.category === 'Immigration' && ['MISSING', 'REJECTED', 'EXPIRED'].includes(i.state)).forEach(() => { a.immGaps += 1; });
    return a;
  }, { pending: 0, expired: 0, expiring: 0, incomplete: 0, immGaps: 0 });

  if (is('HR', 'CEO') && d.timesheets) {
    add(is('HR') && d.timesheets.pending, { tone: 'warn', count: d.timesheets.pending, title: 'Timesheets waiting for approval', detail: 'Approve them so hours can be paid and billed', to: '/timesheet-review' });
    add(d.timesheets.missing, { tone: 'bad', count: d.timesheets.missing, title: 'Timesheet weeks not submitted', detail: 'Employees on a project who still owe a week (last 8 weeks)', to: '/timesheet-review' });
  }
  if (is('HR', 'LEGAL', 'CEO') && d.docs) {
    add(is('HR', 'LEGAL') && docTotals.pending, { tone: 'warn', count: docTotals.pending, title: 'Documents waiting for review', detail: 'Uploaded by employees; verify or reject', to: '/documents' });
    add(docTotals.expired, { tone: 'bad', count: docTotals.expired, title: 'Expired employee documents', detail: 'Passport, I-94, EAD, I-797… need a renewed copy', to: '/documents' });
    add(is('LEGAL') && docTotals.immGaps, { tone: 'bad', count: docTotals.immGaps, title: 'Immigration documents missing', detail: 'Required for each employee’s visa status', to: '/documents' });
    add(is('HR', 'CEO') && docTotals.incomplete, { tone: 'warn', count: docTotals.incomplete, title: 'Employees with missing documents', detail: 'Required paperwork not on file', to: '/documents' });
  }
  if (is('HR', 'LEGAL', 'CEO')) {
    const alerts = d.alerts?.length || 0;
    add(alerts, { tone: 'bad', count: alerts, title: 'Unread visa / LCA alerts', detail: 'Expiry reminders from the daily check', to: '/immigration' });
    const exp = (d.expiring || []).filter((v) => !['FILED', 'RENEWED', 'EXPIRED'].includes(v.case_status)).length;
    add(is('LEGAL', 'HR') && exp, { tone: 'warn', count: exp, title: 'Visas / LCAs expiring within 90 days', detail: 'Open cases that are not yet filed or renewed', to: '/immigration' });
  }
  if (is('HR', 'LEGAL', 'CEO') && d.lca) {
    const go = '/immigration?tab=changes';
    add(is('LEGAL') && d.lca.awaiting_decision, { tone: 'bad', count: d.lca.awaiting_decision, title: 'H-1B assignment changes to review', detail: 'New client, worksite or job title: decide if a new LCA / amendment is needed', to: go });
    add(is('LEGAL', 'HR') && d.lca.amendment_to_file, { tone: 'bad', count: d.lca.amendment_to_file, title: 'LCA amendments to file', detail: 'The employee must not start or move until it is filed', to: go });
    add(is('LEGAL', 'HR') && d.lca.posting_to_do, { tone: 'warn', count: d.lca.posting_to_do, title: 'LCA notices to post', detail: 'Post at the new worksite for 10 business days', to: go });
    add(d.lca.h1b_on_bench, { tone: 'warn', count: d.lca.h1b_on_bench, title: 'H-1B employees on bench', detail: 'The LCA wage must still be paid while on bench', to: go });
  }
  if (is('HR', 'CEO') && d.finance) {
    add(d.finance.overdue_cents > 0, { tone: 'bad', count: fmtMoney(d.finance.overdue_cents), title: 'Overdue from vendors / clients', detail: `${fmtMoney(d.finance.outstanding_cents)} outstanding in total`, to: '/finance' });
    const behind = d.finance.invoicing_behind + d.finance.consultants_without_rate;
    add(is('HR') && behind, { tone: 'warn', count: behind, title: 'Consultants not invoiced on time / no bill rate', detail: 'Create the invoice or set the rate', to: '/finance' });
  }
  if (is('CEO', 'MARKETING_MANAGER') && d.team) {
    const overdue = d.team.scorecard.reduce((n, a) => n + a.overdue, 0);
    add(overdue, { tone: 'bad', count: overdue, title: 'Vendor follow-ups overdue', detail: 'Bench submissions with no follow-up for 5+ business days', to: '/marketing-team' });
    add(d.team.open_update_requests.length, { tone: 'warn', count: d.team.open_update_requests.length, title: 'Employee update requests open', detail: 'Bench employees waiting to hear from their agent', to: '/marketing-team' });
  }
  if (role === 'MARKETING' && d.agent) {
    const s = d.agent.summary;
    add(s.open_update_requests, { tone: 'warn', count: s.open_update_requests, title: 'Employees asked for an update', detail: 'Log a vendor follow-up to answer them', to: '/marketing' });
    add(s.follow_ups_overdue, { tone: 'bad', count: s.follow_ups_overdue, title: 'Follow-ups overdue', detail: 'No vendor follow-up for 5+ business days', to: '/marketing' });
    add(s.follow_ups_due, { tone: 'warn', count: s.follow_ups_due, title: 'Follow-ups due today', detail: 'Check in with the vendor', to: '/marketing' });
  }
  if (d.postings && ['MARKETING', 'MARKETING_MANAGER'].includes(role)) {
    const interested = d.postings.filter((p) => p.status === 'OPEN').reduce((n, p) => n + (p.interested || 0) - (p.submitted || 0), 0);
    add(interested > 0, { tone: 'warn', count: interested, title: 'Employees interested in your postings', detail: 'Submit them to the vendor', to: '/jobs' });
  }
  if (role === 'EMPLOYEE') {
    const newJobs = (d.myJobs || []).filter((j) => j.status === 'OPEN' && j.response === 'PENDING').length;
    add(newJobs, { tone: 'warn', count: newJobs, title: `Job ${newJobs === 1 ? 'opening' : 'openings'} waiting for your reply`, detail: 'Your agent sent roles that match your profile', to: '/my-jobs' });
    const ts = d.myTimesheets;
    if (ts) {
      const thisWeek = ts.assignments.length > 0 && !ts.timesheets.some((x) => ['SUBMITTED', 'APPROVED'].includes(x.status));
      add(ts.missing.length, { tone: 'bad', count: ts.missing.length, title: `Past ${ts.missing.length === 1 ? 'week' : 'weeks'} to submit`, detail: 'Your hours are needed for your pay', to: '/timesheets' });
      add(thisWeek, { tone: 'warn', count: '—', title: 'This week’s timesheet', detail: 'Enter your hours and submit by Friday', to: '/timesheets' });
      const back = ts.recent.filter((x) => x.status === 'REJECTED').length;
      add(back, { tone: 'bad', count: back, title: 'Timesheets sent back by HR', detail: 'Fix and resubmit', to: '/timesheets' });
    }
    const ds = d.myDocs?.summary;
    if (ds) {
      add(ds.missing + ds.rejected, { tone: 'bad', count: ds.missing + ds.rejected, title: 'Documents to upload', detail: 'Required for your employment and visa records', to: '/profile' });
      add(ds.expired + ds.expiring, { tone: 'warn', count: ds.expired + ds.expiring, title: 'Documents expiring or expired', detail: 'Upload the renewed copy', to: '/profile' });
    }
    const subs = d.myProfile?.submissions || [];
    const fresh = subs.filter((x) => x.follow_up_state !== 'CLOSED' && x.latest_vendor_feedback).length;
    add(d.myProfile?.status === 'BENCH' && fresh, { tone: 'info', count: fresh, title: 'Open submissions with vendor feedback', detail: 'See what the vendors said', to: '/profile' });
  }
  if (role === 'ADMIN' && d.users) {
    const inactive = d.users.filter((u) => !u.is_active).length;
    add(inactive, { tone: 'info', count: inactive, title: 'Inactive logins', detail: 'Reactivate or leave as is', to: '/users' });
  }
  return t;
}

/** Headline numbers for this role (each links to the page behind it) */
function glance(role, d) {
  if (role === 'EMPLOYEE' && d.myProfile) {
    const p = d.myProfile;
    const visa = [...(p.immigration || [])].sort((a, b) => String(b.expiry_date).localeCompare(String(a.expiry_date)))[0];
    return [
      { label: 'My status', value: p.status === 'BENCH' ? 'On bench' : 'On project', to: '/profile' },
      { label: p.status === 'BENCH' ? 'Profiles submitted' : 'Client', value: p.status === 'BENCH' ? p.profiles_submitted : (p.current_assignment?.client_name || '—'), to: '/profile' },
      ...(visa ? [{ label: `${visa.visa_type} expires`, value: fmtDate(visa.expiry_date), to: '/profile' }] : []),
      ...(d.myDocs ? [{ label: 'Documents on file', value: `${d.myDocs.summary.complete}/${d.myDocs.summary.required}`, to: '/profile' }] : []),
    ];
  }
  if (d.summary) {
    const s = d.summary;
    return [
      { label: 'Employees', value: s.total_employees, to: '/employees' },
      { label: 'On project', value: s.on_project, to: '/employees?status=PROJECT' },
      { label: 'On bench', value: s.on_bench, to: '/employees?status=BENCH' },
      { label: 'Visa/LCA expiring ≤ 180 days', value: s.expiring_180_days, to: '/employees?expiring=180' },
    ];
  }
  if (role === 'MARKETING' && d.agent) {
    const s = d.agent.summary;
    return [
      { label: 'Bench consultants assigned', value: s.employees_assigned, to: '/marketing' },
      { label: 'Profiles submitted', value: s.profiles_submitted, to: '/marketing' },
      { label: 'Placed', value: s.employees_placed, to: '/marketing' },
    ];
  }
  if (role === 'MARKETING_MANAGER' && d.team) {
    const sum = (k) => d.team.scorecard.reduce((n, a) => n + (a[k] || 0), 0);
    return [
      { label: 'Agents', value: d.team.scorecard.length, to: '/marketing-team' },
      { label: 'Open submissions', value: sum('open_submissions'), to: '/marketing-team' },
      { label: 'Placements', value: sum('placed'), to: '/marketing-team' },
    ];
  }
  return [];
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const ROLE_NAME = {
  CEO: 'CEO', ADMIN: 'Administrator', HR: 'HR', LEGAL: 'Legal', MARKETING: 'Marketing', MARKETING_MANAGER: 'Marketing Manager', EMPLOYEE: 'Employee',
};

// Home: greeting, what needs attention for this role, headline numbers, and every section the role can open
export default function Home() {
  const { user } = useAuth();
  const allowed = (s) => s.roles.includes(user.role) || (user.role === 'ADMIN' && !s.own);
  // One useApi per source, always in the same order (null path = not loaded for this role)
  const loaded = Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, useApi(allowed(s) ? s.path : null)])); // eslint-disable-line react-hooks/rules-of-hooks
  const data = Object.fromEntries(Object.entries(loaded).map(([k, v]) => [k, v.data]));
  const loading = Object.entries(loaded).some(([k, v]) => allowed(SOURCES[k]) && v.loading && !v.error);
  const tasks = buildTasks(user.role, data);
  const stats = glance(user.role, data);
  const sections = navFor(user.role);
  const firstName = (user.full_name || '').split(/[\s(]/)[0];

  return (
    <>
      <section className="home-hero">
        <div>
          <p className="muted">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <h1>{greeting()}, {firstName}</h1>
          <p className="muted">You are signed in as <strong>{ROLE_NAME[user.role] || user.role}</strong>. Here is what needs your attention today.</p>
        </div>
        <div className="home-company">
          <CompanyLogo className="home-logo" />
          <span className="muted small">WorkSphere · {COMPANY_NAME}</span>
        </div>
      </section>

      {stats.length > 0 && (
        <div className="stats">
          {stats.map((s) => (
            <Link key={s.label} to={s.to} className="stat clickable home-stat">
              <div className="stat-value">{s.value ?? '—'}</div>
              <div className="stat-label">{s.label}</div>
            </Link>
          ))}
        </div>
      )}

      <section className="card">
        <h3>Needs your attention</h3>
        {loading && !tasks.length ? <p className="muted">Checking…</p>
          : tasks.length === 0 ? <p className="all-clear">✓ You&apos;re all caught up. Nothing needs your attention right now.</p>
            : (
              <ul className="task-list">
                {tasks.map((t) => (
                  <li key={t.title}>
                    <Link to={t.to} className={`task tone-${t.tone}`}>
                      <span className="task-count">{t.count}</span>
                      <span className="task-body"><strong>{t.title}</strong><span className="muted small">{t.detail}</span></span>
                      <span className="task-go" aria-hidden="true">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
      </section>

      <section>
        <h3>Go to</h3>
        <div className="section-grid">
          {sections.map((n) => (
            <Link key={n.to} to={n.to} className="section-tile">
              <strong>{n.label}</strong>
              <span className="muted small">{n.desc}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

