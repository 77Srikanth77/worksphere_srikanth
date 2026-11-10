"""
Friday timesheet reminders.

For every employee on a project, find the weeks with no submitted or approved timesheet:
this week (it ends on Sunday, so Friday is the time to submit) and the previous
TIMESHEET_LOOKBACK_WEEKS weeks, limited to the assignment's dates. Draft and sent-back weeks count as missing.
Weeks submitted without a required client-approved copy are listed too.

  1. each employee with a login gets one email listing their weeks
  2. HR (TIMESHEET_REMINDER_ROLES) gets a summary, including people on a project who have no login
"""

import logging
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import bindparam, text

from ..config import settings
from ..db import engine, fetch_all
from ..notify import send_email

log = logging.getLogger("worksphere.timesheets")


def _d(raw) -> date:
    return date.fromisoformat(str(raw)[:10])


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _week(m: date) -> str:
    return f"{m:%b %d} - {m + timedelta(days=6):%b %d}"


def run_timesheet_reminders(today: date | None = None) -> dict:
    today = today or date.today()
    this_monday = monday_of(today)
    first = this_monday - timedelta(weeks=settings.timesheet_lookback_weeks)

    work = fetch_all(
        """
        SELECT w.work_id, w.employee_id, w.start_date, w.end_date, w.client_timesheet_required,
               e.first_name || ' ' || e.last_name AS employee_name,
               c.client_name, v.vendor_name,
               (SELECT u.email FROM users u WHERE u.employee_id = e.employee_id AND u.is_active = TRUE) AS login_email
        FROM work w JOIN emp e ON e.employee_id = w.employee_id
        LEFT JOIN clients c ON c.client_id = w.client_id
        LEFT JOIN vendors v ON v.vendor_id = w.vendor_id
        WHERE w.status = 'PROJECT' AND w.start_date <= :end AND (w.end_date IS NULL OR w.end_date >= :first)
        """,
        end=(this_monday + timedelta(days=6)).isoformat(), first=first.isoformat(),
    )
    sheets = fetch_all(
        """
        SELECT t.work_id, t.week_start, t.status,
               (SELECT COUNT(*) FROM timesheet_attachments a WHERE a.timesheet_id = t.timesheet_id) AS files
        FROM timesheets t WHERE t.week_start >= :first
        """,
        first=first.isoformat(),
    )
    state = {(s["work_id"], str(s["week_start"])[:10]): s for s in sheets}

    # employee_id -> {"name", "email", "missing": [...], "no_copy": [...]}
    people: dict[str, dict] = defaultdict(lambda: {"missing": [], "no_copy": [], "approved_no_copy": []})
    for w in work:
        start, end = _d(w["start_date"]), _d(w["end_date"]) if w["end_date"] else None
        m = first
        while m <= this_monday:
            sunday = m + timedelta(days=6)
            if start <= sunday and (end is None or end >= m):
                s = state.get((w["work_id"], m.isoformat()))
                label = f"{_week(m)} ({w['client_name'] or 'project'})"
                p = people[w["employee_id"]]
                p["name"], p["email"] = w["employee_name"], w["login_email"]
                if not s or s["status"] in ("DRAFT", "REJECTED"):
                    extra = " - sent back by HR, please fix and resubmit" if s and s["status"] == "REJECTED" else ""
                    p["missing"].append(label + (" - this week" if m == this_monday else "") + extra)
                elif w["client_timesheet_required"] and not s["files"]:
                    # Submitted weeks: the employee can still attach it. Approved weeks are locked: HR must add it.
                    p["no_copy" if s["status"] == "SUBMITTED" else "approved_no_copy"].append(label)
            m += timedelta(weeks=1)

    people = {k: v for k, v in people.items() if v["missing"] or v["no_copy"] or v["approved_no_copy"]}
    emailed, no_login = [], []
    for emp_id, p in sorted(people.items(), key=lambda kv: kv[1]["name"]):
        if not (p["missing"] or p["no_copy"]):
            continue  # only HR can fix approved weeks
        if not p["email"]:
            no_login.append(p)
            continue
        body = [f"Hi {p['name'].split()[0]},", ""]
        if p["missing"]:
            body += ["Please enter and submit your timesheet for:", *[f"  - {x}" for x in p["missing"]], ""]
        if p["no_copy"]:
            body += ["Your client requires a client-approved timesheet. Please attach it for:",
                     *[f"  - {x}" for x in p["no_copy"]], ""]
        body += ["Open WorkSphere > My Timesheets. Approved hours are used for your pay and for client billing.",
                 "", "Thank you,", "HR"]
        if send_email([p["email"]], "WorkSphere: please submit your timesheet", "\n".join(body)):
            emailed.append(p)

    if people:
        sql = text("SELECT u.email FROM users u JOIN roles r ON r.role_id = u.role_id "
                   "WHERE u.is_active = TRUE AND r.role_name IN :roles").bindparams(bindparam("roles", expanding=True))
        with engine.connect() as conn:
            hr = [row.email for row in conn.execute(sql, {"roles": settings.timesheet_reminder_roles})]
        lines = [f"Timesheet reminders sent on {today:%a %b %d, %Y}:", ""]
        for p in emailed:
            lines.append(f"  - {p['name']}: {len(p['missing'])} week(s) not submitted"
                         + (f", {len(p['no_copy'])} missing the client copy" if p["no_copy"] else ""))
        hr_fix = [p for p in people.values() if p["approved_no_copy"]]
        if hr_fix:
            lines += ["", "Approved weeks with no client-approved copy (only HR can attach to approved weeks):"]
            lines += [f"  - {p['name']}: " + ", ".join(p["approved_no_copy"]) for p in hr_fix]
        if no_login:
            lines += ["", "On a project but no WorkSphere login (could not be reminded):"]
            lines += [f"  - {p['name']}: {len(p['missing'])} week(s) not submitted" for p in no_login]
        lines += ["", "Open WorkSphere > Timesheets to review."]
        send_email(hr, f"WorkSphere: {len(people)} employee(s) with missing timesheets", "\n".join(lines))

    log.info("Timesheet reminders on %s: %d employees with gaps, %d emailed, %d without login",
             today, len(people), len(emailed), len(no_login))
    return {"run_date": today.isoformat(), "employees_with_gaps": len(people), "emailed": len(emailed),
            "without_login": [p["name"] for p in no_login],
            "weeks_missing": sum(len(p["missing"]) for p in people.values()),
            "weeks_missing_client_copy": sum(len(p["no_copy"]) + len(p["approved_no_copy"]) for p in people.values())}
