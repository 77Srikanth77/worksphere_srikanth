import logging
import smtplib
from email.message import EmailMessage

from .config import settings

log = logging.getLogger("worksphere.notify")


def send_email(to: list[str], subject: str, body: str) -> bool:
    """Send a plain-text email. Without SMTP_HOST, the email is logged instead."""
    if not to:
        log.warning("No recipients for %r", subject)
        return False

    if not settings.smtp_host:
        log.info("EMAIL (SMTP not configured)\nTo: %s\nSubject: %s\n\n%s", ", ".join(to), subject, body)
        return True

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
            smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        return True
    except Exception:  # keep the job running even if email fails
        log.exception("Failed to send alert email")
        return False
