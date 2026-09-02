from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class LoginFailure(Base):
    """One row per failed credential check. Lives in the database rather than
    a process dictionary so it is shared by every worker and survives a
    restart — an in-memory table resets to zero on deploy, which is exactly
    when someone hammering the login form would like it to."""

    __tablename__ = "login_failures"
    __table_args__ = (Index("ix_login_failures_key_at", "key", "at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # "<username>|<client ip>" for logins, "pw:<user id>" for password changes.
    key: Mapped[str] = mapped_column(String(120))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
