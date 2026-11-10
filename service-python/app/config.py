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
    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", "worksphere-alerts@example.com")


settings = Settings()
