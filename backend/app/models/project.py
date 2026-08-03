import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    """A saved design: the scene graph as JSON, never meshes."""

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), default="Untitled")
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    # A small picture of the design, rendered by the client and stored as
    # opaque bytes — the server never inspects it, and never generates it.
    # Kept in its own column so listing projects stays a metadata-only query.
    thumbnail: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    thumbnail_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    thumbnail_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
