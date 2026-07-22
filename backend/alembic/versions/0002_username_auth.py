"""Replace magic-link email auth with username + password.

Nothing is deployed yet, so this clears existing dev accounts rather than
migrating them: drops the magic-link table and rebuilds the users table
around a username and password hash.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("magic_link_tokens")
    # Dev-only data: recreating users (cascades sessions/projects) is simpler
    # and safer than coercing emails into usernames.
    op.execute("DELETE FROM projects")
    op.execute("DELETE FROM user_sessions")
    op.execute("DELETE FROM users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_column("users", "email")
    op.add_column("users", sa.Column("username", sa.String(32), nullable=False))
    op.add_column("users", sa.Column("password_hash", sa.String(100), nullable=False))
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    raise NotImplementedError("No path back to magic-link auth.")
