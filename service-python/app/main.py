"""
WorkSphere Python service: scheduled visa/LCA expiry alerts + reports.
Only the Node API calls this service; every request needs the X-Internal-Key header.

Run:  uvicorn app.main:app --reload --port 8000
"""

import logging
import secrets
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI, Header, HTTPException, Query

from . import reports
from .config import settings
from .jobs.expiry_alerts import run_expiry_check
from .jobs.document_expiry import run_document_expiry_check
from .jobs.followups import run_followup_check
from .jobs.timesheet_reminders import run_timesheet_reminders

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("worksphere")

scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(
        run_expiry_check,
        CronTrigger(hour=settings.alert_hour, minute=settings.alert_minute),
        id="expiry_alerts",
        replace_existing=True,
    )
    scheduler.add_job(
        run_document_expiry_check,
        CronTrigger(hour=settings.alert_hour, minute=settings.alert_minute),
        id="document_expiry",
        replace_existing=True,
    )
    scheduler.add_job(
        run_followup_check,
        CronTrigger(day_of_week="mon-fri", hour=settings.followup_hour, minute=0),
        id="followups",
        replace_existing=True,
    )
    scheduler.add_job(
        run_timesheet_reminders,
        CronTrigger(day_of_week=settings.timesheet_reminder_day, hour=settings.timesheet_reminder_hour, minute=0),
        id="timesheet_reminders",
        replace_existing=True,
    )
    scheduler.start()
    log.info("Expiry alert job scheduled daily at %02d:%02d", settings.alert_hour, settings.alert_minute)
    log.info("Vendor follow-up job scheduled weekdays at %02d:00", settings.followup_hour)
    log.info("Timesheet reminders scheduled %s at %02d:00", settings.timesheet_reminder_day, settings.timesheet_reminder_hour)
    yield
    scheduler.shutdown()


app = FastAPI(title="WorkSphere Service", version="1.0.0", lifespan=lifespan)


def require_internal_key(x_internal_key: str = Header(default="")):
    if not settings.internal_api_key or not secrets.compare_digest(x_internal_key, settings.internal_api_key):
        raise HTTPException(status_code=401, detail="Invalid internal key")


@app.get("/health")
def health():
    job = scheduler.get_job("expiry_alerts")
    return {"status": "ok", "next_alert_run": job.next_run_time.isoformat() if job and job.next_run_time else None}


@app.post("/alerts/run", dependencies=[Depends(require_internal_key)])
def run_alerts_now():
    # Visa/LCA records and employee documents are checked together
    return {**run_expiry_check(), "documents": run_document_expiry_check()}


@app.post("/followups/run", dependencies=[Depends(require_internal_key)])
def run_followups_now():
    return run_followup_check()


@app.post("/timesheets/remind", dependencies=[Depends(require_internal_key)])
def send_timesheet_reminders_now():
    return run_timesheet_reminders()


@app.get("/reports/summary", dependencies=[Depends(require_internal_key)])
def report_summary():
    return reports.summary()


@app.get("/reports/expiring", dependencies=[Depends(require_internal_key)])
def report_expiring(days: int = Query(180, ge=1, le=1000)):
    return reports.expiring(days)


@app.get("/reports/marketing", dependencies=[Depends(require_internal_key)])
def report_marketing():
    return reports.marketing()
