"""Failed-attempt throttle backed by the database.

A failure is committed on the request's own session before the 401 is
raised: the session dependency rolls back on an exception, which would
otherwise roll the failure back with it and leave the throttle at zero. It
used to be recorded on a second session from the pool, which meant every
failing login held one connection while waiting for another — a burst of
bad logins could drain the pool and stall unrelated work."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LoginFailure

MAX_FAILS = 5
WINDOW = timedelta(minutes=15)
# Failures against one username from everywhere. Much looser than the
# per-address budget — it exists so that when addresses cannot be told
# apart (no trusted proxy configured, so everyone behind the tunnel looks
# the same) the work an attacker can extract per username is still bounded.
MAX_FAILS_PER_USERNAME = 50


def _cutoff() -> datetime:
    return datetime.now(timezone.utc) - WINDOW


async def throttled(db: AsyncSession, key: str, limit: int = MAX_FAILS) -> bool:
    n = await db.scalar(
        select(func.count())
        .select_from(LoginFailure)
        .where(LoginFailure.key == key, LoginFailure.at > _cutoff())
    )
    return (n or 0) >= limit


async def record_fail(db: AsyncSession, *keys: str) -> None:
    for key in keys:
        db.add(LoginFailure(key=key))
    # Rows outside the window are dead weight for every key, not just these.
    # Sweeping them here keeps the table bounded by the failure rate over one
    # window, however many novel usernames get sprayed at it.
    await db.execute(delete(LoginFailure).where(LoginFailure.at <= _cutoff()))
    await db.commit()
