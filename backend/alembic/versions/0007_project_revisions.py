"""Give projects a revision counter, so a save can say which version it is
replacing and be refused when another device got there first.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("projects", "revision")
