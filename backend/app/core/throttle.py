"""Failed-attempt throttle backed by the database.

A failure is recorded in its own short transaction, deliberately outside the
request's session: the request that records it goes on to raise a 401, and the
session dependency rolls back on any exception — which would roll the failure
back with it and leave the throttle permanently at zero."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal
from app.models import LoginFailure

MAX_FAILS = 5
WINDOW = timedelta(minutes=15)


def _cutoff() -> datetime:
    return datetime.now(timezone.utc) - WINDOW


async def throttled(db: AsyncSession, key: str) -> bool:
    n = await db.scalar(
        select(func.count())
        .select_from(LoginFailure)
        .where(LoginFailure.key == key, LoginFailure.at > _cutoff())
    )
    return (n or 0) >= MAX_FAILS


async def record_fail(key: str) -> None:
    async with SessionLocal() as db:
        db.add(LoginFailure(key=key))
        # Rows outside the window are dead weight for every key, not just this
        # one. Sweeping them here keeps the table bounded by the failure rate
        # over one window, however many novel usernames get sprayed at it.
        await db.execute(delete(LoginFailure).where(LoginFailure.at <= _cutoff()))
        await db.commit()
