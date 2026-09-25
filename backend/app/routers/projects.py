"""Project CRUD. Every query is scoped to the signed-in user; a foreign id is
indistinguishable from a missing one (404), never a 403."""

import asyncio
import base64
import binascii
import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import Project, User
from app.schemas import ProjectIn, ProjectMetaOut, ProjectOut, ThumbnailIn

router = APIRouter(prefix="/projects", tags=["projects"])


async def _check_size(payload: ProjectIn, request: Request) -> None:
    # The body contains the data, so the data cannot be larger than the body.
    # When the declared length is already under the cap there is nothing to
    # measure — and measuring meant re-serialising the whole scene graph on
    # the event loop, ~130ms per 20MB, on every save, to learn a number the
    # request had already told us.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) <= settings.max_project_bytes:
        return
    # Over or unknown: measure precisely, off the loop.
    size = len(await asyncio.to_thread(json.dumps, payload.data, separators=(",", ":")))
    if size > settings.max_project_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Project too large ({size} bytes; limit {settings.max_project_bytes}).",
        )


_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

# The metadata columns — everything except `data` and the thumbnail bytes.
# Loading a whole Project row means loading and parsing its JSON, which for
# an imported mesh is tens of megabytes; nothing below needs that except the
# one route that returns it.
_META = (
    Project.id,
    Project.name,
    Project.created_at,
    Project.updated_at,
    Project.thumbnail_at,
    Project.revision,
)


def _meta(row: Any) -> ProjectMetaOut:
    return ProjectMetaOut(
        id=row.id,
        name=row.name,
        created_at=row.created_at,
        updated_at=row.updated_at,
        thumbnail_at=row.thumbnail_at,
        revision=row.revision,
    )


async def _owned(db: AsyncSession, user: User, project_id: str) -> Project:
    """The full row, data included — only for the route that returns it."""
    project = (
        await db.execute(
            select(Project).where(Project.id == project_id, Project.user_id == user.id)
        )
    ).scalar_one_or_none()
    if project is None:
        raise _NOT_FOUND
    return project


async def _owned_meta(db: AsyncSession, user: User, project_id: str) -> ProjectMetaOut:
    row = (
        await db.execute(
            select(*_META).where(Project.id == project_id, Project.user_id == user.id)
        )
    ).one_or_none()
    if row is None:
        raise _NOT_FOUND
    return _meta(row)


@router.get("", response_model=list[ProjectMetaOut])
async def list_projects(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[ProjectMetaOut]:
    # Select only the metadata columns. Loading whole entities would drag every
    # project's `data` blob into memory (and parse it) just to return four
    # scalars — with imported meshes stored inline that is hundreds of
    # megabytes for a response measured in bytes, and an OOM kill on the way.
    rows = (
        await db.execute(
            select(*_META).where(Project.user_id == user.id).order_by(Project.updated_at.desc())
        )
    ).all()
    return [_meta(r) for r in rows]


# Saves answer with metadata only. The client just sent the data, holds it,
# and never reads it back from the response — echoing it doubled the bytes
# and the serialisation time of every save for nothing.
@router.post("", response_model=ProjectMetaOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectMetaOut:
    await _check_size(payload, request)
    # Lock the user's row for the rest of the transaction, so two creates at
    # the limit cannot both count, both see room, and both insert. (A no-op
    # on SQLite, which serializes writers anyway.)
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    count = (
        await db.execute(select(func.count(Project.id)).where(Project.user_id == user.id))
    ).scalar_one()
    if count >= settings.max_projects_per_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project limit reached — delete something first.",
        )
    project = Project(user_id=user.id, name=payload.name, data=payload.data)
    db.add(project)
    await db.flush()
    return ProjectMetaOut.model_validate(project)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    return ProjectOut.model_validate(await _owned(db, user, project_id))


@router.put("/{project_id}", response_model=ProjectMetaOut)
async def update_project(
    project_id: str,
    payload: ProjectIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectMetaOut:
    await _check_size(payload, request)
    # One conditional UPDATE, so the revision check and the write are the
    # same statement: two saves racing on the same revision cannot both win.
    stmt = (
        update(Project)
        .where(Project.id == project_id, Project.user_id == user.id)
        .values(
            name=payload.name,
            data=payload.data,
            revision=Project.revision + 1,
            updated_at=datetime.now(timezone.utc),
        )
    )
    if payload.expected_revision is not None:
        stmt = stmt.where(Project.revision == payload.expected_revision)
    result = await db.execute(stmt)
    if result.rowcount == 1:
        return await _owned_meta(db, user, project_id)
    # Nothing matched: either the project is not this user's, or it has moved
    # on. Tell the two apart, since the client acts differently on each.
    current = await _owned_meta(db, user, project_id)
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "message": "This project was saved from elsewhere since you opened it.",
            "revision": current.revision,
            "updated_at": current.updated_at.isoformat(),
        },
    )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        delete(Project).where(Project.id == project_id, Project.user_id == user.id)
    )
    if result.rowcount != 1:
        raise _NOT_FOUND


# Only the formats a browser canvas actually produces. Anything else is either
# a mistake or someone using the column as a file host.
_DATA_URL = re.compile(r"^data:image/(webp|png|jpeg);base64,([A-Za-z0-9+/=\s]+)$")


@router.put("/{project_id}/thumbnail", status_code=status.HTTP_204_NO_CONTENT)
async def put_thumbnail(
    project_id: str,
    payload: ThumbnailIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The client renders its own preview and sends it here. The server stores
    the bytes and never looks inside them — all geometry stays client-side."""
    project = await _owned_meta(db, user, project_id)
    match = _DATA_URL.match(payload.image.strip())
    if not match:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Thumbnail must be a base64 data URL of a webp, png or jpeg image.",
        )
    try:
        raw = base64.b64decode(match.group(2), validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Thumbnail is not valid base64."
        ) from None
    if len(raw) > settings.max_thumbnail_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=(
                f"Thumbnail too large ({len(raw)} bytes; "
                f"limit {settings.max_thumbnail_bytes})."
            ),
        )
    # A Core UPDATE with updated_at pinned to itself, in SQL: the column's
    # onupdate would otherwise fire and a preview refresh would count as an
    # edit, reshuffling the library's "last touched" order for no reason.
    # Pinned to the column, not to the value read above, so an edit that
    # commits between that read and this write keeps its newer stamp.
    await db.execute(
        update(Project)
        .where(Project.id == project.id)
        .values(
            thumbnail=raw,
            thumbnail_type=f"image/{match.group(1)}",
            thumbnail_at=datetime.now(timezone.utc),
            updated_at=Project.updated_at,
        )
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/thumbnail")
async def get_thumbnail(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    row = (
        await db.execute(
            select(Project.thumbnail, Project.thumbnail_type).where(
                Project.id == project_id, Project.user_id == user.id
            )
        )
    ).one_or_none()
    if row is None:
        raise _NOT_FOUND
    if not row.thumbnail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No thumbnail.")
    return Response(
        content=row.thumbnail,
        media_type=row.thumbnail_type or "image/webp",
        headers={
            # The client appends ?v=<thumbnail_at>, so a given URL never
            # changes content and can be cached hard. Private: it is a picture
            # of someone's design, not public content.
            "Cache-Control": "private, max-age=31536000, immutable",
        },
    )
