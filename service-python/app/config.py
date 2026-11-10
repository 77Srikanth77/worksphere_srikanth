import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SERVICE_DIR = Path(__file__).resolve().parents[1]  # service-python/


class Settings:
    # SQLite file shared with the Node API; relative paths are from service-python/
    db_file = (SERVICE_DIR / os.getenv("DB_FILE", "../db/worksphere.db")).resolve()
    db_url = f"sqlite:///{db_file}"
    internal_api_key = os.getenv("INTERNAL_API_KEY", "")
    alert_hour = int(os.getenv("ALERT_HOUR", "6"))
    alert_minute = int(os.getenv("ALERT_MINUTE", "0"))
    alert_thresholds = sorted(int(x) for x in os.getenv("ALERT_THRESHOLDS", "180,90,60,30").split(","))
    alert_roles = [r.strip() for r in os.getenv("ALERT_ROLES", "LEGAL,CEO").split(",") if r.strip()]
    # Vendor follow-ups (business days)
    follow_up_due_days = int(os.getenv("FOLLOW_UP_DUE_DAYS", "3"))
    follow_up_overdue_days = int(os.getenv("FOLLOW_UP_OVERDUE_DAYS", "5"))
    update_request_escalate_days = int(os.getenv("UPDATE_REQUEST_ESCALATE_DAYS", "2"))
    followup_escalation_roles = [r.strip() for r in os.getenv("FOLLOWUP_ESCALATION_ROLES", "MARKETING_MANAGER,CEO").split(",") if r.strip()]
    followup_hour = int(os.getenv("FOLLOWUP_HOUR", "8"))
    # Employee document expiry reminders go to these roles (and to the employee)
    doc_alert_roles = [r.strip() for r in os.getenv("DOC_ALERT_ROLES", "HR,LEGAL").split(",") if r.strip()]
    # Friday timesheet reminders
    timesheet_reminder_day = os.getenv("TIMESHEET_REMINDER_DAY", "fri")
    timesheet_reminder_hour = int(os.getenv("TIMESHEET_REMINDER_HOUR", "14"))
    timesheet_lookback_weeks = int(os.getenv("TIMESHEET_LOOKBACK_WEEKS", "8"))
    timesheet_reminder_roles = [r.strip() for r in os.getenv("TIMESHEET_REMINDER_ROLES", "HR").split(",") if r.strip()]
    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", "worksphere-alerts@example.com")


settings = Settings()
