from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_token
from app.database import get_db
from app.models import User, UserSession

_bearer = HTTPBearer(auto_error=False)


def client_ip(request: Request) -> str:
    """The address the request came from, as nginx worked it out: X-Real-IP,
    which nginx always sets — to the Cloudflare-forwarded address when the
    request came from a proxy the operator listed in TRUSTED_PROXY_CIDRS,
    else to the socket peer. Client-sent CF-Connecting-IP and X-Forwarded-For
    are not consulted: anyone can send those. Only meaningful because the app
    is reachable solely through nginx; the dev server proxies without the
    header and gets the socket peer."""
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    return request.client.host if request.client else "unknown"


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in.")
    session = (
        await db.execute(
            select(UserSession).where(UserSession.token_hash == hash_token(credentials.credentials))
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if session is None or session.expires_at.replace(tzinfo=timezone.utc) < now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired.")
    # Re-resolve the user each request so a deleted user's tokens die, and
    # so a session from before a password change dies with the change even
    # when its login raced the change and was inserted after the purge.
    user = await db.get(User, session.user_id)
    if user is None or session.auth_version != user.auth_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired.")
    return user
