"""
Daily employee-document expiry check (passport, I-94, visa stamp, I-797, EAD, I-20, LCA, licence, green card).

Looks only at the newest non-rejected document of each type per employee (a renewed passport
replaces the old one). When its expiry date is within one of ALERT_THRESHOLDS days (default 180/90/60/30)
or already past, one document_alerts row is written per threshold, so each reminder goes out once.
New reminders are emailed to DOC_ALERT_ROLES (default HR, LEGAL) and to the employee.
"""

import logging
from collections import defaultdict
from datetime import date

from sqlalchemy import bindparam, text

from ..config import settings
from ..db import engine, fetch_all
from ..notify import send_email
from .expiry_alerts import pick_threshold

log = logging.getLogger("worksphere.documents")

LABELS = {
    "PASSPORT": "Passport", "VISA_STAMP": "Visa stamp", "I94": "I-94", "I797": "I-797 approval notice", "LCA": "LCA",
    "EAD": "EAD card", "I20": "I-20", "GREEN_CARD": "Green card", "H4_I797": "Spouse I-797 (H-4)",
    "DRIVERS_LICENSE": "Driver's licence / state ID",
}


def _msg(name: str, label: str, expiry: date, days: int) -> str:
    if days < 0:
        return f"{name}'s {label} EXPIRED on {expiry:%b %d, %Y} ({-days} days ago)."
    return f"{name}'s {label} expires on {expiry:%b %d, %Y} ({days} days left)."


def run_document_expiry_check(today: date | None = None) -> dict:
    today = today or date.today()
    docs = fetch_all(
        """
        SELECT d.document_id, d.employee_id, d.doc_type, d.expiry_date,
               e.first_name || ' ' || e.last_name AS employee_name,
               (SELECT u.email FROM users u WHERE u.employee_id = e.employee_id AND u.is_active = TRUE) AS employee_email
        FROM documents d JOIN emp e ON e.employee_id = d.employee_id
        WHERE d.status != 'REJECTED' AND d.expiry_date IS NOT NULL
          AND d.document_id = (SELECT d2.document_id FROM documents d2
                               WHERE d2.employee_id = d.employee_id AND d2.doc_type = d.doc_type AND d2.status != 'REJECTED'
                               ORDER BY d2.uploaded_at DESC, d2.document_id DESC LIMIT 1)
        """
    )
    created = []
    with engine.begin() as conn:
        for d in docs:
            expiry = date.fromisoformat(str(d["expiry_date"])[:10])
            days = (expiry - today).days
            threshold = pick_threshold(days, settings.alert_thresholds)
            if threshold is None:
                continue
            r = conn.execute(text("INSERT OR IGNORE INTO document_alerts (document_id, threshold_days) VALUES (:id, :t)"),
                             {"id": d["document_id"], "t": threshold})
            if r.rowcount:
                created.append({**d, "days": days,
                                "message": _msg(d["employee_name"], LABELS.get(d["doc_type"], d["doc_type"]), expiry, days)})

    if created:
        created.sort(key=lambda a: a["days"])
        sql = text("SELECT u.email FROM users u JOIN roles r ON r.role_id = u.role_id "
                   "WHERE u.is_active = TRUE AND r.role_name IN :roles").bindparams(bindparam("roles", expanding=True))
        with engine.connect() as conn:
            staff = [row.email for row in conn.execute(sql, {"roles": settings.doc_alert_roles})]
        send_email(staff, f"WorkSphere: {len(created)} employee document(s) expiring",
                   "These employee documents need renewing:\n\n" + "\n".join(f"  - {a['message']}" for a in created)
                   + "\n\nOpen WorkSphere > Documents to upload the renewed copies.")
        per_emp = defaultdict(list)
        for a in created:
            if a["employee_email"]:
                per_emp[(a["employee_email"], a["employee_name"])].append(a)
        for (email, name), items in per_emp.items():
            lines = [f"Hi {name.split()[0]},", "", "Please renew and upload the new copy of:"]
            lines += [f"  - {LABELS.get(a['doc_type'], a['doc_type'])}: "
                      + (f"expired {-a['days']} days ago" if a["days"] < 0 else f"expires in {a['days']} days") for a in items]
            lines += ["", "Upload it in WorkSphere > My Profile > My documents. HR will verify it.", "", "Thank you,", "HR"]
            send_email([email], "WorkSphere: a document of yours is expiring", "\n".join(lines))

    log.info("Document expiry check on %s: %d documents scanned, %d new reminders", today, len(docs), len(created))
    return {"run_date": today.isoformat(), "scanned": len(docs), "new_alerts": len(created),
            "alerts": [{"message": a["message"], "days_left": a["days"]} for a in created]}
