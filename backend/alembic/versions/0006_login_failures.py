"""Move the login throttle out of process memory.

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "login_failures",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(120), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_login_failures_at", "login_failures", ["at"])
    op.create_index("ix_login_failures_key_at", "login_failures", ["key", "at"])


def downgrade() -> None:
    op.drop_table("login_failures")
