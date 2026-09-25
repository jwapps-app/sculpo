"""Version a user's credentials, so a session issued against an old password
is refused even if its login finished after the password changed.

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1")
    )
    op.add_column(
        "user_sessions",
        sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("user_sessions", "auth_version")
    op.drop_column("users", "auth_version")
