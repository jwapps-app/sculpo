"""Project CRUD. Every query is scoped to the signed-in user; a foreign id is
indistinguishable from a missing one (404), never a 403."""

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import Project, User
from app.schemas import ProjectIn, ProjectMetaOut, ProjectOut

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
    rows = (
        await db.execute(
            select(Project)
            .where(Project.user_id == user.id)
            .order_by(Project.updated_at.desc())
        )
    ).scalars()
    return [ProjectMetaOut.model_validate(p) for p in rows]


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
