"""
Daily vendor follow-up check (weekdays).

Same rules as api-node/src/utils/followups.js:
  - a follow-up is DUE when the agent's planned date has arrived, or FOLLOW_UP_DUE_DAYS business
    days have passed since the agent's last activity
  - it is OVERDUE after FOLLOW_UP_OVERDUE_DAYS business days with no activity
  - closed submissions (placed, rejected, position closed, no response) are skipped

The job then:
  1. emails each agent their overdue and due follow-ups
  2. escalates employee "request update"s unanswered for UPDATE_REQUEST_ESCALATE_DAYS business days
     to the Marketing Manager(s) and CEO (each request escalates once)
  3. emails the Marketing Manager(s) and CEO a summary of overdue follow-ups per agent
"""

import logging
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import bindparam, text

from ..config import settings
from ..db import engine, fetch_all
from ..notify import send_email

log = logging.getLogger("worksphere.followups")

CLOSED = ("PLACED", "REJECTED", "POSITION_CLOSED", "NO_RESPONSE")
STAGE_LABEL = lambda s: s.replace("_", " ").title()  # noqa: E731


def _d(raw) -> date:
    return date.fromisoformat(str(raw)[:10])


def add_business_days(start: date, n: int) -> date:
    d = start
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


def business_days_between(start: date, end: date) -> int:
    n, d = 0, start
    while d < end:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def _emails_for_roles(roles: list[str]) -> list[str]:
    sql = text(
        """
        SELECT u.email FROM users u JOIN roles r ON r.role_id = u.role_id
        WHERE u.is_active = TRUE AND r.role_name IN :roles
        """
    ).bindparams(bindparam("roles", expanding=True))
    with engine.connect() as conn:
        return [row.email for row in conn.execute(sql, {"roles": roles})]


def _line(s: dict) -> str:
    where = " / ".join(x for x in (s["vendor_name"], s["client_name"]) if x) or "vendor"
    return (f"  - {s['employee_name']} - {s['job_title'] or 'role'} at {where} "
            f"[{STAGE_LABEL(s['status'])}] - no activity for {s['idle']} business day(s)")


def run_followup_check(today: date | None = None) -> dict:
    today = today or date.today()
    subs = fetch_all(
        f"""
        SELECT s.submission_id, s.status, s.submitted_on, s.last_activity_on, s.next_follow_up_on,
               s.client_name, s.job_title, s.agent_user_id, v.vendor_name,
               e.first_name || ' ' || e.last_name AS employee_name,
               u.full_name AS agent_name, u.email AS agent_email, u.is_active AS agent_active
        FROM submissions s
        JOIN emp e ON e.employee_id = s.employee_id
        JOIN users u ON u.user_id = s.agent_user_id
        LEFT JOIN vendors v ON v.vendor_id = s.vendor_id
        WHERE s.status NOT IN {CLOSED}
        """
    )

    overdue, due = [], []
    for s in subs:
        last = _d(s["last_activity_on"] or s["submitted_on"])
        s["idle"] = business_days_between(last, today)
        due_on = _d(s["next_follow_up_on"]) if s["next_follow_up_on"] else add_business_days(last, settings.follow_up_due_days)
        if s["idle"] >= settings.follow_up_overdue_days:
            overdue.append(s)
        elif due_on <= today:
            due.append(s)

    # 1. Each agent: their own list
    per_agent: dict[str, dict] = defaultdict(lambda: {"overdue": [], "due": [], "name": ""})
    for kind, rows in (("overdue", overdue), ("due", due)):
        for s in rows:
            if s["agent_active"]:
                per_agent[s["agent_email"]][kind].append(s)
                per_agent[s["agent_email"]]["name"] = s["agent_name"]
    for email, a in per_agent.items():
        parts = [f"Hi {a['name']},", ""]
        if a["overdue"]:
            parts += [f"OVERDUE - no vendor follow-up for {settings.follow_up_overdue_days}+ business days:",
                      *map(_line, a["overdue"]), ""]
        if a["due"]:
            parts += ["Due today:", *map(_line, a["due"]), ""]
        parts.append("Open WorkSphere > My Marketing and log each follow-up with the vendor's feedback.")
        send_email([email], f"WorkSphere: {len(a['overdue'])} overdue, {len(a['due'])} due vendor follow-ups",
                   "\n".join(parts))

    managers = _emails_for_roles(settings.followup_escalation_roles)

    # 2. Escalate unanswered employee update requests (once each)
    pending = fetch_all(
        """
        SELECT ur.request_id, ur.requested_on, ur.message, s.job_title, s.client_name, v.vendor_name,
               e.first_name || ' ' || e.last_name AS employee_name, u.full_name AS agent_name
        FROM update_requests ur
        JOIN submissions s ON s.submission_id = ur.submission_id
        JOIN emp e ON e.employee_id = ur.employee_id
        JOIN users u ON u.user_id = s.agent_user_id
        LEFT JOIN vendors v ON v.vendor_id = s.vendor_id
        WHERE ur.resolved_on IS NULL AND ur.escalated_on IS NULL
        """
    )
    escalate = [r for r in pending
                if business_days_between(_d(r["requested_on"]), today) >= settings.update_request_escalate_days]
    if escalate:
        body = "\n".join(
            [f"These employee update requests got no answer from the agent in "
             f"{settings.update_request_escalate_days}+ business days:", ""]
            + [f"  - {r['employee_name']} asked {r['agent_name']} on {str(r['requested_on'])[:10]} about "
               f"{r['job_title'] or 'a role'} ({r['vendor_name'] or r['client_name'] or 'vendor'})"
               + (f': "{r["message"]}"' if r["message"] else "") for r in escalate]
            + ["", "Open WorkSphere > Marketing Team to follow up."]
        )
        send_email(managers, f"WorkSphere: {len(escalate)} employee update request(s) escalated", body)
        mark = text("UPDATE update_requests SET escalated_on = datetime('now','localtime') WHERE request_id IN :ids") \
            .bindparams(bindparam("ids", expanding=True))
        with engine.begin() as conn:
            conn.execute(mark, {"ids": [r["request_id"] for r in escalate]})

    # 3. Managers: overdue summary per agent
    if overdue:
        by_agent: dict[str, list] = defaultdict(list)
        for s in overdue:
            by_agent[s["agent_name"]].append(s)
        body = [f"Vendor follow-ups overdue ({settings.follow_up_overdue_days}+ business days with no activity):", ""]
        for agent, rows in sorted(by_agent.items()):
            body += [f"{agent} - {len(rows)} overdue", *map(_line, rows), ""]
        body.append("Open WorkSphere > Marketing Team for the full scorecard.")
        send_email(managers, f"WorkSphere: {len(overdue)} overdue vendor follow-up(s)", "\n".join(body))

    log.info("Follow-up check on %s: %d open, %d overdue, %d due, %d escalated",
             today, len(subs), len(overdue), len(due), len(escalate))
    return {"run_date": today.isoformat(), "open_submissions": len(subs), "overdue": len(overdue),
            "due": len(due), "agents_notified": len(per_agent), "escalated_requests": len(escalate)}
