"""Store a client-rendered thumbnail per project.

Its own column, not part of `data`: listing projects is a metadata-only query
and must stay that way, so the picture is fetched per-project by its own
endpoint rather than riding along in the list response.

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("thumbnail", sa.LargeBinary(), nullable=True))
    op.add_column("projects", sa.Column("thumbnail_type", sa.String(20), nullable=True))
    op.add_column(
        "projects", sa.Column("thumbnail_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("projects", "thumbnail_at")
    op.drop_column("projects", "thumbnail_type")
    op.drop_column("projects", "thumbnail")
