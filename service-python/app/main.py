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
    scheduler.start()
    log.info("Expiry alert job scheduled daily at %02d:%02d", settings.alert_hour, settings.alert_minute)
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
    return run_expiry_check()


@app.get("/reports/summary", dependencies=[Depends(require_internal_key)])
def report_summary():
    return reports.summary()


@app.get("/reports/expiring", dependencies=[Depends(require_internal_key)])
def report_expiring(days: int = Query(180, ge=1, le=1000)):
    return reports.expiring(days)


@app.get("/reports/marketing", dependencies=[Depends(require_internal_key)])
def report_marketing():
    return reports.marketing()
