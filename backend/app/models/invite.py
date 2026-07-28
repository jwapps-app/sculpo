import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AllowedUsername(Base):
    """A username an admin has invited, plus the secret that proves the person
    registering it is the one who was invited. Consumed on registration.

    Without the secret this table is only a list of names, and names are
    guessable: anyone who registered an invited name before its owner got the
    account. The code is stored hashed, like a session token, so a copy of the
    database does not hand over live invites."""

    __tablename__ = "allowed_usernames"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    # Nullable only so the table can be migrated in place. An invite without a
    # code is refused at registration — see routers/auth.py.
    code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    def is_usable(self, now: datetime | None = None) -> bool:
        if not self.code_hash:
            return False
        if self.expires_at is None:
            return True
        expires = self.expires_at
        # Postgres hands back an aware datetime; SQLite (the test database)
        # drops the zone. Everything stored here is UTC, so say so rather than
        # let the comparison raise.
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return (now or _now()) < expires
