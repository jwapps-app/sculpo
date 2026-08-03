"""Project CRUD. Every query is scoped to the signed-in user; a foreign id is
indistinguishable from a missing one (404), never a 403."""

import base64
import binascii
import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import Project, User
from app.schemas import ProjectIn, ProjectMetaOut, ProjectOut, ThumbnailIn

router = APIRouter(prefix="/projects", tags=["projects"])


def _check_size(payload: ProjectIn) -> None:
    size = len(json.dumps(payload.data, separators=(",", ":")))
    if size > settings.max_project_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Project too large ({size} bytes; limit {settings.max_project_bytes}).",
        )


async def _owned(db: AsyncSession, user: User, project_id: str) -> Project:
    project = (
        await db.execute(
            select(Project).where(Project.id == project_id, Project.user_id == user.id)
        )
    ).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return project


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
            select(
                Project.id,
                Project.name,
                Project.created_at,
                Project.updated_at,
                Project.thumbnail_at,
            )
            .where(Project.user_id == user.id)
            .order_by(Project.updated_at.desc())
        )
    ).all()
    return [
        ProjectMetaOut(
            id=r.id,
            name=r.name,
            created_at=r.created_at,
            updated_at=r.updated_at,
            thumbnail_at=r.thumbnail_at,
        )
        for r in rows
    ]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    _check_size(payload)
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
    return ProjectOut.model_validate(project)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    return ProjectOut.model_validate(await _owned(db, user, project_id))


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    payload: ProjectIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    _check_size(payload)
    project = await _owned(db, user, project_id)
    project.name = payload.name
    project.data = payload.data
    await db.flush()
    return ProjectOut.model_validate(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await db.delete(await _owned(db, user, project_id))


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
    project = await _owned(db, user, project_id)
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
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Thumbnail too large ({len(raw)} bytes; "
                f"limit {settings.max_thumbnail_bytes})."
            ),
        )
    project.thumbnail = raw
    project.thumbnail_type = f"image/{match.group(1)}"
    project.thumbnail_at = datetime.now(timezone.utc)
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/thumbnail")
async def get_thumbnail(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    project = await _owned(db, user, project_id)
    if not project.thumbnail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No thumbnail.")
    return Response(
        content=project.thumbnail,
        media_type=project.thumbnail_type or "image/webp",
        headers={
            # The client appends ?v=<thumbnail_at>, so a given URL never
            # changes content and can be cached hard. Private: it is a picture
            # of someone's design, not public content.
            "Cache-Control": "private, max-age=31536000, immutable",
        },
    )
