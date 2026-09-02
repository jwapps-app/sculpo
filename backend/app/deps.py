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
    """The address nginx says the request came from. Behind the Cloudflare
    tunnel that is CF-Connecting-IP; on a plain proxy, the first hop of
    X-Forwarded-For; otherwise the socket peer. Only meaningful because the
    app is reachable solely through nginx, which sets these — a client that
    could talk to :8000 directly could claim any address it liked."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
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
    # Re-resolve the user each request so a deleted user's tokens die.
    user = await db.get(User, session.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired.")
    return user
