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
| `db/` | `schema.sql` (all tables), `seed.sql` (sample data) and the generated `worksphere.db` file |
| `api-node/` | Express REST API: auth (JWT + bcrypt), role checks, CRUD |
| `service-python/` | FastAPI: APScheduler alert job (180/90/60/30 days), reports, SMTP email |
| `frontend/` | React + Vite app with a home screen for each role |

## Roles and what they see

| Role | Lands on | Sees |
|---|---|---|
| CEO | Dashboard | Headcount, project vs bench, expiring visas, agent performance |
| ADMIN | Dashboard | Everything, plus user management (`/api/users`) |
| HR | Employees | Add/edit employees, work assignments |
| LEGAL | Immigration | Visa/LCA register, alert inbox, case status, "Run alert check now" |
| MARKETING | My Marketing | Assigned employees, submissions, vendors contacted, placements, weekly status |
| EMPLOYEE | My Profile | Bio, hire date, client, past/present duties, trainings, interviews; bench employees also see their marketing agent and submissions |

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
| `POST /marketing/assignments` | CEO, HR |
| `GET /reports/summary`, `/reports/expiring`, `/reports/marketing`, `POST /reports/alerts/run` | proxied to FastAPI |
| `GET,POST /users` | ADMIN |
| `POST /documents` (multipart), `GET /documents/:id/download` | HR, LEGAL, MARKETING |
