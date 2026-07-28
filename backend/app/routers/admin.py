"""User management, admins only (ADMIN_USERS env). Invites are usernames that
may register; the invited person picks their own password when they do."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import new_token
from app.database import get_db
from app.deps import get_current_user
from app.models import AllowedUsername, User
from app.routers.auth import USERNAME_RE, user_out
from app.schemas import AdminOverviewOut, AllowUserIn, InviteCreatedOut

router = APIRouter(prefix="/admin", tags=["admin"])


async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if user.username not in settings.admin_user_set:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only.")
    return user


@router.get("/users", response_model=AdminOverviewOut)
async def overview(
    _: User = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> AdminOverviewOut:
    users = (await db.execute(select(User).order_by(User.username))).scalars().all()
    invited = (
        (await db.execute(select(AllowedUsername).order_by(AllowedUsername.username)))
        .scalars()
        .all()
    )
    return AdminOverviewOut(
        users=[user_out(u) for u in users],
        invited=[i.username for i in invited],
    )


@router.post("/invites", response_model=InviteCreatedOut, status_code=status.HTTP_201_CREATED)
async def invite(
    payload: AllowUserIn,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> InviteCreatedOut:
    username = payload.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Usernames are 3–32 characters: letters, digits, - or _.",
        )
    taken = (
        await db.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="That username is already registered."
        )
    # Re-inviting an existing name issues a fresh code and invalidates the old
    # one, which doubles as the way to replace a code the admin has lost.
    exists = (
        await db.execute(select(AllowedUsername).where(AllowedUsername.username == username))
    ).scalar_one_or_none()
    raw_code, code_hash = new_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.invite_ttl_days)
    if exists is None:
        exists = AllowedUsername(username=username)
        db.add(exists)
    exists.code_hash = code_hash
    exists.expires_at = expires_at
    await db.flush()
    return InviteCreatedOut(
        username=username,
        code=raw_code,
        expires_at=expires_at,
        overview=await overview(admin, db),
    )


@router.delete("/invites/{username}", response_model=AdminOverviewOut)
async def revoke_invite(
    username: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminOverviewOut:
    invite_row = (
        await db.execute(
            select(AllowedUsername).where(AllowedUsername.username == username.lower())
        )
    ).scalar_one_or_none()
    if invite_row is not None:
        await db.delete(invite_row)
        await db.flush()
    return await overview(admin, db)


@router.delete("/users/{user_id}", response_model=AdminOverviewOut)
async def delete_user(
    user_id: str,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminOverviewOut:
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="You can't delete yourself."
        )
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such user.")
    await db.delete(target)  # sessions and projects cascade
    await db.flush()
    return await overview(admin, db)
