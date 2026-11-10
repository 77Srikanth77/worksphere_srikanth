# WorkSphere

Employee workforce compliance and performance management for IT consulting and staffing companies.
It tracks employees, visa/LCA status, client and vendor assignments, trainings, interviews and
marketing activity. It also alerts Legal and management **6 months before a visa or LCA expires**.

## Architecture

```
Browser (React, port 5173)
   │  REST /api/*  + JWT
   ▼
Node.js API – Express (port 4000)      login, roles, all data entry
   │  proxy /reports, /alerts  (X-Internal-Key)
   ▼
Python FastAPI (port 8000)             daily expiry-alert job, reports, email
   │
   ▼
SQLite file – db/worksphere.db        both services read and write (WAL mode)
```

| Folder | What it is |
|---|---|
| `db/` | `schema.sql` (all tables), `seed.sql` (sample data), `migrations/` (upgrades for existing databases) and the generated `worksphere.db` file |
| `api-node/` | Express REST API: auth (JWT + bcrypt), role checks, CRUD |
| `service-python/` | FastAPI: APScheduler jobs (visa/LCA expiry alerts, vendor follow-up reminders), reports, SMTP email |
| `frontend/` | React + Vite app with a home screen for each role |

## Roles and what they see

| Role | Lands on | Sees |
|---|---|---|
| CEO | Dashboard | Headcount, project vs bench, expiring visas, agent performance, Finance (read-only) |
| ADMIN | Dashboard | Everything, plus user management (`/api/users`) |
| HR | Employees | Add/edit employees, work assignments, searchable/filterable employee list with CSV export; Finance: bill rates, invoices, payments, vendor balances |
| LEGAL | Immigration | Visa/LCA register with each case's document status, alert inbox, case status, "Run alert check now"; Documents: every employee's passport, visa, I-94, I-797, LCA, EAD… (view, upload, verify) |
| MARKETING | My Marketing | Assigned employees, submissions with follow-up due/overdue flags, vendor follow-up log, employee update requests, weekly status |
| MARKETING_MANAGER | Marketing Team | Agent scorecard, overdue follow-ups across all agents, escalated employee update requests; assigns bench employees to agents |
| EMPLOYEE | My Profile, My Timesheets | Bio, hire date, client, past/present duties, trainings, interviews; bench employees also see every submission's stage, agent notes and vendor feedback, can request an update and add their own feedback. Employees on a project enter daily hours each week and submit them for approval |

## Prerequisites

- **Node.js 18+** (`brew install node`)
- **Python 3.11+**
- **sqlite3** command (built into macOS)
- Optional: the **SQLite Viewer** extension for VS Code, to browse `db/worksphere.db`

## Setup

### 1. Database

From the project root:

```bash
sqlite3 db/worksphere.db < db/schema.sql
sqlite3 db/worksphere.db < db/seed.sql
```

To open it, click `db/worksphere.db` in VS Code with the SQLite Viewer extension installed.
To start over with fresh sample data later, run `npm run db:reset` inside `api-node`.
After pulling new code, run `npm run db:migrate` inside `api-node` to upgrade an existing database without losing data.
The database file is in `.gitignore`, so each developer builds their own copy.

### 2. Node API

```bash
cd api-node
cp .env.example .env        # set JWT_SECRET and INTERNAL_API_KEY
npm install
npm run set-passwords       # gives every seeded account the DEMO_PASSWORD
npm run dev                 # http://localhost:4000/api/health
```

### 3. Python service

```bash
cd service-python
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # INTERNAL_API_KEY must match api-node/.env
uvicorn app.main:app --reload --port 8000    # http://localhost:8000/docs
```

Leave `SMTP_HOST` empty during development. Alert emails are then printed in this terminal
instead of being sent.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

## Demo logins

Password for all accounts: `Password@123` (or whatever `DEMO_PASSWORD` is set to)

| Email | Role |
|---|---|
| ceo@example.com | CEO |
| admin@example.com | ADMIN |
| hr@example.com | HR |
| legal@example.com | LEGAL |
| marketing@example.com | MARKETING |
| manager@example.com | MARKETING_MANAGER |
| ravi.kumar@example.com | EMPLOYEE (on project) |
| arjun.patel@example.com | EMPLOYEE (on bench) |

Sign in as **legal@example.com** and click **Run alert check now** to create the first alerts from the seed data.

## How the expiry alert works

1. FastAPI runs `run_expiry_check` every day at `ALERT_HOUR:ALERT_MINUTE` (default 06:00).
2. For every visa not marked FILED / RENEWED / EXPIRED, it checks the visa and LCA expiry dates.
3. When a date is within 180, 90, 60 or 30 days, or already past, it inserts one `alerts` row.
   A unique key makes sure each window fires only once.
4. New alerts are emailed to active users with the roles in `ALERT_ROLES` (default LEGAL and CEO)
   and appear on the Immigration page.
5. When Legal sets the case to FILED or RENEWED, the reminders stop.

## Job postings and notifications

1. A marketing agent opens **Job Postings > New posting** and enters the role: title, client, vendor, location, work mode,
   duration, internal rate, required skills and job duties.
2. While they type, the right-hand panel ranks employees (bench by default, or everyone) by how well their profile matches:
   bio, every job title/project/duties they have had, and trainings (`api-node/src/utils/matching.js`). Required skills weigh 70%,
   other keywords 30%; each card shows the skills the employee has (✓) and lacks (✗). Common spellings are treated as the same
   (ReactJS = React.js = React, k8s = Kubernetes, plurals = singulars).
3. The agent ticks employees and sends. Agents can send only to their own assigned employees; the Marketing Manager to anyone.
4. Each employee gets a notification (bell in the top bar) and sees the opening under **Job Openings**, without the rate, and
   replies **Interested** / **Not interested** with a note. The agent is notified.
5. On the posting page the agent sees who opened it and replied, and turns an interested employee into a vendor submission in one
   click, which starts the normal follow-up tracking. Postings can be sent to more people later, or closed.

The bell (every role, refreshes every 30 seconds) also announces: timesheet sent back by HR, document rejected, vendor update on
a submission (agent logged feedback or a stage change), and an employee asking their agent for an update.

## Employee documents

HR and Legal keep every employee's paperwork in WorkSphere (Documents page, and the Documents card on each employee page).

- **Required checklist by visa status** (`api-node/src/utils/documentTypes.js`, have your immigration attorney review it):
  everyone needs an offer letter, I-9 and résumé; H-1B adds passport, visa stamp, I-94, I-797 and LCA; L-1 adds passport, visa stamp,
  I-94, I-797; OPT adds passport, EAD, I-20, I-94; STEM-OPT also the I-983; H-4 EAD / GC-EAD add the EAD; green-card holders the green card.
  Optional types: degree, SSN card (last 4 digits only), W-4, driver's licence, other.
- Each document stores its number, issue and expiry date. Status per required item: Missing, Waiting for review, Rejected, Verified,
  Expiring (≤ 90 days) or Expired. Uploading a new passport keeps the old one as history.
- **Who sees what:** HR, Legal, CEO and Admin see everything; Marketing only résumés; employees only their own (My Profile >
  My documents). Employee uploads wait for HR/Legal to verify or reject (with a reason the employee sees). HR/Legal uploads are
  verified straight away. Files are stored in `api-node/uploads/documents/` and only served through permission-checked downloads.
- **Expiry reminders:** the daily alert job emails `DOC_ALERT_ROLES` (default HR, Legal) and the employee when the newest copy of a
  passport, visa stamp, I-94, I-797, LCA, EAD, I-20, green card or licence is 180/90/60/30 days from expiry or expired (once each).
- The Immigration page shows, for every visa case, how many immigration documents are on file and what is missing.

## Timesheets

1. The employee opens **My Timesheets**, enters hours per day for each project assignment (no future days, nothing outside
   the assignment dates) and **submits** the week. A submitted week can be recalled until HR reviews it.
2. HR (**Timesheets** page) **approves** it or **sends it back** with a note; the employee fixes and resubmits.
   An approved week can only be sent back if no invoice covers it yet.
3. Approved hours drive pay and billing: the **Hours report** gives approved / pending / unsubmitted hours per employee for any
   date range (CSV for payroll), and **New invoice** on the Finance page pre-fills the hours from approved timesheets in the
   billing period and warns about pending or unsubmitted hours. Hours are stored per day, so a calendar-month invoice
   counts exactly the days of weeks that cross the month boundary.
4. Weeks without a submitted timesheet (last 8 weeks) are listed for HR and shown to the employee.
5. **Friday reminders:** every `TIMESHEET_REMINDER_DAY` at `TIMESHEET_REMINDER_HOUR` (default Friday 14:00) FastAPI emails each
   employee the weeks they still need to submit (this week and the last `TIMESHEET_LOOKBACK_WEEKS`), and HR a summary,
   including people on a project with no login. HR can also click **Send reminders now** on the Timesheets page.
6. **Client-approved timesheets:** the employee (or HR) attaches the copy the vendor/client signed off (PDF, image, Word,
   Excel; max 10 MB) to each week. Files are stored in `api-node/uploads/timesheets/` and only the employee, HR and the CEO can
   download them. When HR ticks **Client-approved timesheet required** for an assignment (employee page, Billing card), the
   week cannot be submitted or approved without it, reminders ask for it, and New invoice warns about weeks missing it.

## Finance (HR, CEO, Admin)

Bill rates, invoices and payments live in their own tables (`billing_rates`, `invoices`, `invoice_payments`) and are only
served by `/api/finance`, so Legal, Marketing and employees never see rates or balances. Money is stored in whole cents.

- **Bill rate** per assignment (per hour/day/month), payment terms (Net N days) and invoice cycle. A new rate closes the
  previous one, so history is kept. Set it on the employee page (Billing card).
- **Invoices** go to the vendor, or to the client when there is no vendor. Overlapping periods for the same assignment are refused.
  Projects that ended in the last 180 days stay billable until they are invoiced through their end date (final invoice).
- **Payments** can be partial; an invoice is Open, Partly paid, Overdue (past due date with a balance), Paid or Void.
- The Finance page shows what is owed per vendor/client with aging (not yet due, 1–30, 31–60, 61–90, 90+ days late),
  consultants whose invoicing is behind or who have no bill rate, and every invoice with search and filters.

## How vendor follow-ups work

Every profile an agent submits moves through stages:
`Submitted → Acknowledged → Screening scheduled → Screening done → Client interview → Offer → Placed`,
or closes as `Rejected`, `Position closed` or `No response`.

1. The agent logs each vendor follow-up: channel (call, email, vendor portal, LinkedIn), vendor contact,
   what the vendor said, a note, the new stage, and when they will follow up next.
2. A follow-up is **due** 3 business days after the agent's last activity and **overdue** after 5
   (`FOLLOW_UP_DUE_DAYS`, `FOLLOW_UP_OVERDUE_DAYS` in both `.env` files).
3. The bench employee sees each submission's timeline (agent notes and vendor feedback; never the bill rate
   or the vendor recruiter's name), can **request an update**, and can add their own feedback, for example
   to confirm a screening call happened.
4. Every weekday at `FOLLOWUP_HOUR` (default 08:00) FastAPI emails each agent their due and overdue follow-ups,
   emails the Marketing Manager and CEO a summary of overdue ones, and escalates update requests the agent
   has not answered within `UPDATE_REQUEST_ESCALATE_DAYS` (default 2) business days. Logging a follow-up answers
   the request. The Marketing Team page has a "Run follow-up check now" button.

## API overview (Node, all under `/api`)

| Method & path | Roles |
|---|---|
| `POST /auth/login`, `GET /auth/me` | public / any |
| `GET /me/profile` | EMPLOYEE |
| `GET,POST /employees`, `GET,PUT,DELETE /employees/:id` | read: CEO, HR, LEGAL, MARKETING · write: HR · delete: ADMIN |
| `/work`, `/clients`, `/vendors`, `/trainings`, `/interviews` | standard CRUD, role-checked |
| `GET,POST /immigration`, `PUT /immigration/:id` | CEO, HR, LEGAL |
| `GET /alerts`, `PATCH /alerts/:id/read` | CEO, HR, LEGAL |
| `GET /marketing/dashboard`, `POST /marketing/submissions`, `/vendor-contacts`, `/weekly-status` | MARKETING |
| `GET /marketing/submissions/:id` (timeline) | MARKETING (own), MARKETING_MANAGER, CEO, HR, EMPLOYEE (own) |
| `POST /marketing/submissions/:id/follow-ups` | MARKETING (own), MARKETING_MANAGER |
| `POST /marketing/submissions/:id/update-request`, `/feedback` | EMPLOYEE (own) |
| `GET /marketing/team` | MARKETING_MANAGER, CEO |
| `POST /reports/followups/run` | MARKETING_MANAGER, CEO |
| `POST /marketing/assignments`, `PATCH /marketing/assignments/:id/end` | CEO, HR, MARKETING_MANAGER |
| `GET /reports/summary`, `/reports/expiring`, `/reports/marketing`, `POST /reports/alerts/run` | proxied to FastAPI |
| `GET /finance/summary`, `/billable`, `/invoices`, `/invoices/:id`, `/employees/:id`, `/rates` | CEO, HR |
| `POST /finance/invoices`, `/invoices/:id/payments`, `/rates`, `PATCH /finance/invoices/:id/void` | HR |
| `GET,PUT /timesheets/mine`, `POST /timesheets/:id/recall` | EMPLOYEE (own) |
| `GET /timesheets`, `/timesheets/summary`, `/timesheets/missing`, `/timesheets/hours` | HR, CEO |
| `POST /timesheets/:id/approve`, `/timesheets/:id/reject` | HR |
| `POST /timesheets/:id/attachments` (multipart), `DELETE /timesheets/attachments/:aid` | EMPLOYEE (own, until approved), HR |
| `GET /timesheets/attachments/:aid/download` | EMPLOYEE (own), HR, CEO |
| `POST /reports/timesheet-reminders/run` | HR |
| `POST /jobs/match`, `GET,POST /jobs`, `GET /jobs/:id`, `POST /jobs/:id/recipients`, `POST /jobs/:id/recipients/:employeeId/submit`, `PATCH /jobs/:id/status` | MARKETING (own), MARKETING_MANAGER |
| `GET /jobs/mine`, `GET /jobs/:id`, `POST /jobs/:id/respond` | EMPLOYEE (postings sent to them) |
| `GET /notifications`, `POST /notifications/:id/read`, `/notifications/read-all` | any signed-in user (own) |
| `GET,POST /users` | ADMIN |
| `GET /documents/compliance`, `/documents/queue`, `/documents/checklist/:employeeId` | HR, LEGAL, CEO |
| `POST /documents` (multipart), `PATCH /documents/:id`, `/documents/:id/review` | HR, LEGAL (MARKETING: résumés only) |
| `GET,POST /documents/mine` | EMPLOYEE (own) |
| `GET /documents/:id/download` | HR, LEGAL, CEO; MARKETING (résumés); EMPLOYEE (own) |
| `DELETE /documents/:id` | HR; EMPLOYEE (own, while pending) |
