"""Give each invite a secret code, so an invited username cannot be claimed
by whoever guesses it first.

Existing rows get no code, which makes them unusable by design — an invite
that predates this migration has no secret to prove, so it fails closed and
the admin re-issues it.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "allowed_usernames", sa.Column("code_hash", sa.String(64), nullable=True)
    )
    op.add_column(
        "allowed_usernames",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("allowed_usernames", "expires_at")
    op.drop_column("allowed_usernames", "code_hash")
