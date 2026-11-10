from .db import fetch_all, fetch_one


def summary() -> dict:
    """Company-wide numbers for the CEO / management dashboard."""
    counts = fetch_one(
        """
        SELECT
          (SELECT COUNT(*) FROM emp) AS total_employees,
          (SELECT COUNT(DISTINCT employee_id) FROM work WHERE end_date IS NULL AND status = 'PROJECT') AS on_project,
          (SELECT COUNT(DISTINCT employee_id) FROM work WHERE end_date IS NULL AND status = 'BENCH')   AS on_bench,
          (SELECT COUNT(*) FROM immigration
             WHERE case_status NOT IN ('FILED','RENEWED','EXPIRED')
               AND MIN(expiry_date, COALESCE(lca_expiry_date, expiry_date)) <= date('now','localtime','+180 days')
          ) AS expiring_180_days,
          (SELECT COUNT(*) FROM alerts WHERE is_read = FALSE) AS unread_alerts,
          (SELECT COUNT(*) FROM submissions WHERE submitted_on >= date('now','localtime','-30 days')) AS submissions_30_days,
          (SELECT COUNT(*) FROM submissions WHERE status = 'PLACED') AS total_placements
        """
    )
    by_visa = fetch_all("SELECT visa_type, COUNT(*) AS count FROM immigration GROUP BY visa_type ORDER BY count DESC")
    by_client = fetch_all(
        """
        SELECT c.client_name, COUNT(*) AS consultants
        FROM work w JOIN clients c ON c.client_id = w.client_id
        WHERE w.end_date IS NULL AND w.status = 'PROJECT'
        GROUP BY c.client_name ORDER BY consultants DESC
        """
    )
    by_location = fetch_all(
        """
        SELECT COALESCE(city, '?') || ', ' || COALESCE(state, '?') AS location, COUNT(*) AS employees
        FROM work WHERE end_date IS NULL GROUP BY location ORDER BY employees DESC
        """
    )
    return {**counts, "by_visa_type": by_visa, "by_client": by_client, "by_location": by_location}


def expiring(days: int = 180) -> list[dict]:
    return fetch_all(
        """
        SELECT i.visa_id, i.employee_id, e.first_name || ' ' || e.last_name AS employee_name,
               i.visa_type, i.expiry_date, i.lca_expiry_date, i.case_status,
               CAST(julianday(MIN(i.expiry_date, COALESCE(i.lca_expiry_date, i.expiry_date))) - julianday(date('now','localtime')) AS INTEGER) AS days_left
        FROM immigration i JOIN emp e ON e.employee_id = i.employee_id
        WHERE MIN(i.expiry_date, COALESCE(i.lca_expiry_date, i.expiry_date)) <= date('now','localtime','+' || :days || ' days')
        ORDER BY days_left
        """,
        days=days,
    )


def marketing() -> list[dict]:
    """Per-agent performance for management."""
    return fetch_all(
        """
        SELECT u.user_id, u.full_name AS agent,
          (SELECT COUNT(*) FROM marketing_assignments ma WHERE ma.agent_user_id = u.user_id AND ma.is_active) AS employees_assigned,
          (SELECT COUNT(*) FROM submissions s WHERE s.agent_user_id = u.user_id) AS profiles_submitted,
          (SELECT COUNT(*) FROM submissions s WHERE s.agent_user_id = u.user_id AND s.status = 'PLACED') AS placements,
          (SELECT COUNT(DISTINCT vendor_id) FROM vendor_contacts vc WHERE vc.agent_user_id = u.user_id) AS vendors_contacted
        FROM users u JOIN roles r ON r.role_id = u.role_id
        WHERE r.role_name = 'MARKETING' AND u.is_active
        ORDER BY placements DESC, profiles_submitted DESC
        """
    )
