"""Magic-link auth, allowlist-gated. No passwords anywhere.

Flow: request-link (allowlisted emails only) -> emailed token -> verify ->
opaque session token. Responses are identical for allowed and unknown emails
so the endpoint can't be used to probe the allowlist.
"""

import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.email import magic_link_body, send_email
from app.core.security import hash_token, new_token
from app.database import get_db
from app.deps import get_current_user
from app.models import MagicLinkToken, User, UserSession
from app.schemas import RequestLinkIn, RequestLinkOut, SessionOut, UserOut, VerifyIn

router = APIRouter(prefix="/auth", tags=["auth"])

_GENERIC = "If that email is allowed, a sign-in link is on its way."

# In-memory throttle: per-email request cap. Resets on restart — fine at this
# scale; move to Redis if this ever runs multi-instance.
_REQUESTS: dict[str, list[float]] = {}
_MAX_REQUESTS = 5
_WINDOW = 15 * 60


def _throttled(email: str) -> bool:
    now = time.time()
    recent = [t for t in _REQUESTS.get(email, []) if now - t < _WINDOW]
    _REQUESTS[email] = recent
    return len(recent) >= _MAX_REQUESTS


@router.post("/request-link", response_model=RequestLinkOut)
async def request_link(payload: RequestLinkIn, db: AsyncSession = Depends(get_db)) -> RequestLinkOut:
    email = payload.email.strip().lower()
    if _throttled(email):
        return RequestLinkOut(message=_GENERIC)
    _REQUESTS.setdefault(email, []).append(time.time())

    if email not in settings.allowed_email_set:
        return RequestLinkOut(message=_GENERIC)

    raw, token_hash = new_token()
    db.add(
        MagicLinkToken(
            email=email,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=settings.magic_link_ttl_minutes),
        )
    )
    link = f"{settings.app_url}/?token={raw}"

    if settings.smtp_host:
        subject, body = magic_link_body(link)
        await send_email(email, subject, body)
        return RequestLinkOut(message=_GENERIC)
    if settings.debug:
        # Dev only: no mail server, surface the link so the flow can complete.
        return RequestLinkOut(message=_GENERIC, dev_magic_link=link)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Email delivery is not configured.",
    )


@router.post("/verify", response_model=SessionOut)
async def verify(payload: VerifyIn, db: AsyncSession = Depends(get_db)) -> SessionOut:
    now = datetime.now(timezone.utc)
    token = (
        await db.execute(
            select(MagicLinkToken).where(MagicLinkToken.token_hash == hash_token(payload.token))
        )
    ).scalar_one_or_none()
    if (
        token is None
        or token.used_at is not None
        or token.expires_at.replace(tzinfo=timezone.utc) < now
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That sign-in link is invalid or has expired.",
        )
    token.used_at = now

    user = (
        await db.execute(select(User).where(User.email == token.email))
    ).scalar_one_or_none()
    if user is None:
        user = User(email=token.email)
        db.add(user)
        await db.flush()

    raw, token_hash = new_token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=now + timedelta(days=settings.session_ttl_days),
        )
    )
    return SessionOut(session_token=raw, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    # Drop every session for this user (single-user tool; "sign out everywhere").
    sessions = (
        await db.execute(select(UserSession).where(UserSession.user_id == user.id))
    ).scalars()
    for s in sessions:
        await db.delete(s)
