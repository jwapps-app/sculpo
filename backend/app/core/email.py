import asyncio
import smtplib
from email.message import EmailMessage

from app.config import settings


def _send_sync(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)


async def send_email(to: str, subject: str, body: str) -> None:
    await asyncio.to_thread(_send_sync, to, subject, body)


def magic_link_body(link: str) -> tuple[str, str]:
    subject = f"Sign in to {settings.app_name}"
    body = (
        f"Click to sign in to {settings.app_name}:\n\n{link}\n\n"
        f"The link is valid for {settings.magic_link_ttl_minutes} minutes and "
        "can be used once. If you didn't request it, ignore this email."
    )
    return subject, body
