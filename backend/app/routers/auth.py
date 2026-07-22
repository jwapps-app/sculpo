"""Username + password auth. Admins (ADMIN_USERS env) can always register;
everyone else needs an invite created in the UI. Sessions are opaque bearer
tokens stored hashed."""

import asyncio
import re
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import hash_password, new_token, verify_password
from app.database import get_db
from app.deps import get_current_user
from app.models import AllowedUsername, User, UserSession
from app.schemas import ChangePasswordIn, CredentialsIn, SessionOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

USERNAME_RE = re.compile(r"^[a-z0-9_-]{3,32}$")

# In-memory brute-force throttle: lock a username out after too many failed
# logins in a window. Resets on restart — fine at this scale.
_FAILS: dict[str, list[float]] = {}
_MAX_FAILS = 5
_WINDOW = 15 * 60


def _throttled(username: str) -> bool:
    now = time.time()
    recent = [t for t in _FAILS.get(username, []) if now - t < _WINDOW]
    _FAILS[username] = recent
    return len(recent) >= _MAX_FAILS


def _record_fail(username: str) -> None:
    _FAILS.setdefault(username, []).append(time.time())


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        is_admin=user.username in settings.admin_user_set,
    )


async def _issue_session(db: AsyncSession, user: User) -> SessionOut:
    raw, token_hash = new_token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.session_ttl_days),
        )
    )
    return SessionOut(session_token=raw, user=user_out(user))


@router.post("/register", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def register(payload: CredentialsIn, db: AsyncSession = Depends(get_db)) -> SessionOut:
    username = payload.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Usernames are 3–32 characters: letters, digits, - or _.",
        )
    invite = (
        await db.execute(select(AllowedUsername).where(AllowedUsername.username == username))
    ).scalar_one_or_none()
    if username not in settings.admin_user_set and invite is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is not open for this username.",
        )
    existing = (
        await db.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That username is already registered.",
        )
    password_hash = await asyncio.to_thread(hash_password, payload.password)
    user = User(username=username, password_hash=password_hash)
    db.add(user)
    if invite is not None:
        await db.delete(invite)  # invite consumed
    await db.flush()
    return await _issue_session(db, user)


@router.post("/login", response_model=SessionOut)
async def login(payload: CredentialsIn, db: AsyncSession = Depends(get_db)) -> SessionOut:
    username = payload.username.strip().lower()
    if _throttled(username):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts — try again in a few minutes.",
        )
    user = (
        await db.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    # Verify even when the user is missing so timing doesn't reveal usernames.
    ok = await asyncio.to_thread(
        verify_password, payload.password, user.password_hash if user else None
    )
    if not ok or user is None:
        _record_fail(username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )
    return await _issue_session(db, user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    ok = await asyncio.to_thread(verify_password, payload.current_password, user.password_hash)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Current password is wrong."
        )
    user.password_hash = await asyncio.to_thread(hash_password, payload.new_password)
    await db.flush()


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return user_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    # Drop every session for this user ("sign out everywhere").
    sessions = (
        await db.execute(select(UserSession).where(UserSession.user_id == user.id))
    ).scalars()
    for s in sessions:
        await db.delete(s)
