"""
Daily visa / LCA expiry check.

For every visa that is not already FILED, RENEWED or EXPIRED, look at the visa
expiry date and the LCA expiry date. When a date is within one of the alert
thresholds (default 180, 90, 60, 30 days), insert one ALERTS row for the
closest threshold crossed. The unique key on alerts makes the job safe to run
any number of times: each threshold fires only once per expiry date.
New alerts are then emailed to every active user in ALERT_ROLES (Legal + CEO).
"""

import logging
from datetime import date

from sqlalchemy import bindparam, text

from ..config import settings
from ..db import engine, fetch_all
from ..notify import send_email

log = logging.getLogger("worksphere.alerts")


def pick_threshold(days_left: int, thresholds: list[int]) -> int | None:
    """Smallest threshold the date has crossed, 0 if already expired, None if too far away."""
    if days_left < 0:
        return 0
    crossed = [t for t in sorted(thresholds) if days_left <= t]
    return crossed[0] if crossed else None


def _message(kind: str, name: str, visa_type: str, expiry: date, days_left: int) -> str:
    what = f"{visa_type} visa" if kind == "VISA" else f"LCA ({visa_type})"
    if days_left < 0:
        return f"{what} for {name} EXPIRED on {expiry:%b %d, %Y} ({-days_left} days ago)."
    return f"{what} for {name} expires on {expiry:%b %d, %Y} ({days_left} days left)."


def run_expiry_check(today: date | None = None) -> dict:
    today = today or date.today()
    records = fetch_all(
        """
        SELECT i.visa_id, i.employee_id, i.visa_type, i.expiry_date, i.lca_expiry_date, i.case_status,
               e.first_name || ' ' || e.last_name AS employee_name
        FROM immigration i JOIN emp e ON e.employee_id = i.employee_id
        WHERE i.case_status NOT IN ('FILED', 'RENEWED', 'EXPIRED')
        """
    )

    created = []
    with engine.begin() as conn:
        for r in records:
            for kind, raw in (("VISA", r["expiry_date"]), ("LCA", r["lca_expiry_date"])):
                if not raw:
                    continue
                expiry = date.fromisoformat(str(raw)[:10])  # SQLite stores dates as 'YYYY-MM-DD' text
                days_left = (expiry - today).days
                threshold = pick_threshold(days_left, settings.alert_thresholds)
                if threshold is None:
                    continue
                msg = _message(kind, r["employee_name"], r["visa_type"], expiry, days_left)
                result = conn.execute(
                    text(
                        """
                        INSERT OR IGNORE INTO alerts (visa_id, employee_id, alert_type, threshold_days, expiry_date, message)
                        VALUES (:visa_id, :employee_id, :kind, :threshold, :expiry, :msg)
                        """
                    ),
                    dict(visa_id=r["visa_id"], employee_id=r["employee_id"], kind=kind,
                         threshold=threshold, expiry=expiry.isoformat(), msg=msg),
                )
                if result.rowcount:  # 0 means this alert already existed
                    created.append({"alert_id": result.lastrowid, "days_left": days_left, "message": msg})

    emailed = False
    if created:
        roles_sql = text(
            """
            SELECT u.email FROM users u JOIN roles r ON r.role_id = u.role_id
            WHERE u.is_active = TRUE AND r.role_name IN :roles
            """
        ).bindparams(bindparam("roles", expanding=True))
        with engine.connect() as conn:
            recipients = [row.email for row in conn.execute(roles_sql, {"roles": settings.alert_roles})]
        created.sort(key=lambda a: a["days_left"])
        body = "The following visa / LCA dates need attention:\n\n" + "\n".join(
            f"  - {a['message']}" for a in created
        ) + "\n\nOpen WorkSphere > Immigration to update the case status."
        emailed = send_email(recipients, f"WorkSphere: {len(created)} visa/LCA expiry alert(s)", body)
        if emailed:
            mark_sql = text("UPDATE alerts SET emailed = TRUE WHERE alert_id IN :ids").bindparams(
                bindparam("ids", expanding=True)
            )
            with engine.begin() as conn:
                conn.execute(mark_sql, {"ids": [a["alert_id"] for a in created]})

    log.info("Expiry check on %s: %d records scanned, %d new alerts", today, len(records), len(created))
    return {"run_date": today.isoformat(), "scanned": len(records), "new_alerts": len(created),
            "emailed": emailed, "alerts": created}
