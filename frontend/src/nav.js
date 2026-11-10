// Every section of the app, who may open it, and a one-line description for the Home page.
// ADMIN sees all of them.
export const NAV = [
  { to: '/dashboard', label: 'Dashboard', roles: ['CEO'], desc: 'Company headcount, bench, expiring visas and placements' },
  { to: '/marketing-team', label: 'Marketing Team', roles: ['CEO', 'MARKETING_MANAGER'], desc: 'Agent scorecard, overdue vendor follow-ups, employee update requests' },
  { to: '/employees', label: 'Employees', roles: ['CEO', 'HR', 'LEGAL', 'MARKETING_MANAGER'], desc: 'Search and filter every employee by client, vendor, visa and status' },
  { to: '/documents', label: 'Documents', roles: ['CEO', 'HR', 'LEGAL'], desc: 'Passports, visas, I-94s, I-797s and other required documents' },
  { to: '/timesheet-review', label: 'Timesheets', roles: ['CEO', 'HR'], desc: 'Approve weekly timesheets, chase missing weeks, hours for payroll' },
  { to: '/finance', label: 'Finance', roles: ['CEO', 'HR'], desc: 'Bill rates, invoices, payments and what vendors owe' },
  { to: '/immigration', label: 'Immigration', roles: ['CEO', 'HR', 'LEGAL'], desc: 'Visa and LCA register, expiry alerts and case status' },
  { to: '/marketing', label: 'My Marketing', roles: ['MARKETING'], desc: 'Your bench consultants, submissions and vendor follow-ups' },
  { to: '/jobs', label: 'Job Postings', roles: ['MARKETING', 'MARKETING_MANAGER'], desc: 'Describe a role, see matching employees live, send it to them' },
  { to: '/profile', label: 'My Profile', roles: ['EMPLOYEE'], desc: 'Your details, project, interviews, submissions and documents' },
  { to: '/timesheets', label: 'My Timesheets', roles: ['EMPLOYEE'], desc: 'Enter and submit your weekly hours' },
  { to: '/my-jobs', label: 'Job Openings', roles: ['EMPLOYEE'], desc: 'Roles your marketing agent sent you; reply interested or not' },
  { to: '/users', label: 'Users', roles: ['ADMIN'], desc: 'Create logins and manage access' },
];

export const navFor = (role) => NAV.filter((n) => role === 'ADMIN' || n.roles.includes(role));
