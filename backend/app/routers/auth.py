"""Username + password auth. Admins (ADMIN_USERS env) can always register;
everyone else needs an invite created in the UI. Sessions are opaque bearer
tokens stored hashed."""

import asyncio
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import (
    check_password,
    hash_password,
    hash_token,
    new_token,
    verify_password,
)
from app.core.throttle import MAX_FAILS_PER_USERNAME, record_fail, throttled
from app.database import get_db
from app.deps import client_ip, get_current_user
from app.models import AllowedUsername, User, UserSession
from app.schemas import ChangePasswordIn, CredentialsIn, SessionOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

USERNAME_RE = re.compile(r"^[a-z0-9_-]{3,32}$")

# One message for every registration refusal, so the endpoint can't be used to
# discover which usernames are admin names, invited, or already taken.
_CLOSED = "Registration is not open for this username."

_TOO_MANY = "Too many attempts — try again in a few minutes."


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
            auth_version=user.auth_version,
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
    is_admin_name = username in settings.admin_user_set
    if not is_admin_name:
        # The username is not the credential — anyone can guess "sarah". The
        # invite code is, so an invite is only good in the hands of whoever
        # the admin sent it to. Unusable covers both a pre-code invite and an
        # expired one; both fail closed and need re-issuing.
        supplied = payload.invite_code or ""
        if (
            invite is None
            or not invite.is_usable()
            or not secrets.compare_digest(hash_token(supplied), invite.code_hash or "")
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=_CLOSED,
            )
    # ADMIN_USERS names are guessable (they're just usernames), so on a public
    # instance a stranger could otherwise claim admin simply by registering
    # first. When the operator sets a signup secret, prove knowledge of it.
    if is_admin_name and settings.admin_signup_secret:
        supplied = payload.admin_secret or ""
        # Compared as bytes: the str form of compare_digest only takes ASCII,
        # and a secret or a guess with an accent in it was a 500.
        if not secrets.compare_digest(
            supplied.encode("utf-8"), settings.admin_signup_secret.encode("utf-8")
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=_CLOSED,
            )
    existing = (
        await db.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    if existing is not None:
        # Same shape as the closed-registration error: distinguishing "taken"
        # from "not open" would confirm which usernames exist.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_CLOSED,
        )
    password_hash = await asyncio.to_thread(hash_password, payload.password)
    user = User(username=username, password_hash=password_hash)
    db.add(user)
    if invite is not None:
        await db.delete(invite)  # invite consumed
    try:
        await db.flush()
    except IntegrityError:
        # Two registrations for the same name raced past the existence check;
        # the unique constraint caught the loser. Same refusal as "taken".
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_CLOSED) from None
    return await _issue_session(db, user)


@router.post("/login", response_model=SessionOut)
async def login(
    payload: CredentialsIn, request: Request, db: AsyncSession = Depends(get_db)
) -> SessionOut:
    username = payload.username.strip().lower()
    # Keyed by username AND source address. Keyed by username alone, five bad
    # guesses from anywhere locked the real owner out for fifteen minutes —
    # a denial of service that cost the attacker nothing.
    key = f"{username}|{client_ip(request)}"
    # And a looser budget per username from anywhere, for when addresses
    # cannot be told apart (see client_ip).
    user_key = f"user:{username}"
    if await throttled(db, key) or await throttled(db, user_key, MAX_FAILS_PER_USERNAME):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=_TOO_MANY)
    user = (
        await db.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    # Verify even when the user is missing so timing doesn't reveal usernames.
    ok, legacy = await asyncio.to_thread(
        check_password, payload.password, user.password_hash if user else None
    )
    if not ok or user is None:
        await record_fail(db, key, user_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )
    # Migrate pre-upgrade password hashes once their owner proves the password.
    # `legacy` came free with the verification; re-checking would cost a
    # second bcrypt on every login, forever.
    if legacy:
        user.password_hash = await asyncio.to_thread(hash_password, payload.password)
    # Every login adds a session row and nothing ever removed the expired
    # ones, so the table only grew. Clear this user's dead sessions on the way
    # in: cheap, indexed, and keeps growth bounded by the TTL.
    await db.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id,
            UserSession.expires_at < datetime.now(timezone.utc),
        )
    )
    await db.flush()
    return await _issue_session(db, user)


@router.post("/change-password", response_model=SessionOut)
async def change_password(
    payload: ChangePasswordIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    # Throttle here too: a stolen token could otherwise be used to brute-force
    # the plaintext password (valuable because people reuse it elsewhere).
    if await throttled(db, f"pw:{user.id}"):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=_TOO_MANY)
    ok = await asyncio.to_thread(verify_password, payload.current_password, user.password_hash)
    if not ok:
        await record_fail(db, f"pw:{user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Current password is wrong."
        )
    user.password_hash = await asyncio.to_thread(hash_password, payload.new_password)
    # Changing a password is how someone locks out a thief, so every other
    # session must die — otherwise a stolen token stays valid for its full 90
    # days. The caller gets a fresh token in the response. The version bump
    # also kills a session whose login read the old hash and finished after
    # this: it carries the old version and is refused on its first use.
    user.auth_version += 1
    for session in (
        await db.execute(select(UserSession).where(UserSession.user_id == user.id))
    ).scalars():
        await db.delete(session)
    await db.flush()
    return await _issue_session(db, user)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return user_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    # Drop every session for this user ("sign out everywhere"), including
    # any a concurrent login is about to insert.
    user.auth_version += 1
    sessions = (
        await db.execute(select(UserSession).where(UserSession.user_id == user.id))
    ).scalars()
    for s in sessions:
        await db.delete(s)
