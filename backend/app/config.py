import logging
import os
from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_log = logging.getLogger("sculpo.config")

# Origins the native shells serve their bundled web app from.
PACKAGED_APP_ORIGINS = ["app://sculpo"]


class Settings(BaseSettings):
    # Tests must not inherit the developer's .env: a stray value there (an
    # admin signup secret, say) would otherwise change test outcomes on one
    # machine and not another.
    model_config = SettingsConfigDict(
        env_file=None if os.getenv("SCULPO_TEST") else ".env",
        extra="ignore",
    )

    app_name: str = "Sculpo"
    environment: str = "production"
    database_url: str = "postgresql+asyncpg://app:app@db:5432/app"
    allowed_origins: str = ""
    # Sessions are opaque random tokens stored hashed, and passwords are
    # bcrypt: nothing here is signed, so there is no signing secret to set.

    # Comma-separated admin usernames. Admins can always register and manage
    # other users from the UI; everyone else needs an invite created there.
    # ALLOWED_USERS is accepted as a legacy alias so stacks configured before
    # the rename keep working.
    admin_users: str = Field(
        default="",
        validation_alias=AliasChoices("ADMIN_USERS", "ALLOWED_USERS"),
    )

    session_ttl_days: int = 90

    # How long an invite code stays good. Short enough that a code left in an
    # old chat message stops being a way in.
    invite_ttl_days: int = 14

    # Optional shared secret that must accompany registration of an admin
    # username. Without it, whoever reaches a public instance first can claim
    # the admin name and own the instance. Unset = no extra check (fine on a
    # LAN-only or Access-gated deployment).
    admin_signup_secret: str = ""
    # Production refuses to start with no signup secret unless this says the
    # operator knows what that means: the instance is on a trusted network
    # and nobody untrusted can reach it to register the admin name first.
    allow_open_admin_signup: bool = False

    # Hard cap on a stored project's serialized size (imported meshes ride
    # inside the JSON; full-resolution imports can be tens of MB).
    max_project_bytes: int = 50_000_000
    max_projects_per_user: int = 200

    # A project thumbnail: a ~320px WebP of the viewport, measured around
    # 70 KB with the workplane grid in shot. Generous enough for that, tight
    # enough that the column cannot be used as free storage.
    max_thumbnail_bytes: int = 200_000

    @property
    def max_request_bytes(self) -> int:
        """Body ceiling enforced before parsing. Slightly above the project cap
        to leave room for JSON framing around the scene graph."""
        return self.max_project_bytes + 2_000_000

    @property
    def cors_origins(self) -> list[str]:
        configured = [o.strip() for o in self.allowed_origins.split(",") if o.strip()]
        # The packaged apps serve their bundle from a fixed custom-scheme
        # origin, so they can reach any Sculpo server without the operator
        # having to allowlist anything. Safe because auth is a bearer token,
        # never a cookie — CORS is not what protects this API.
        return [*configured, *PACKAGED_APP_ORIGINS]

    @property
    def admin_user_set(self) -> set[str]:
        return {u.strip().lower() for u in self.admin_users.split(",") if u.strip()}

    def validate_production(self) -> None:
        if self.environment == "production":
            if not self.admin_user_set:
                raise RuntimeError(
                    "Refusing to start: ADMIN_USERS is empty — nobody would be able "
                    "to sign in. Set at least one admin username."
                )
            # An empty value looks identical to a set one in a compose file,
            # and the difference is who owns the instance — so say which it
            # is, every boot, where it can actually be checked. Whether an
            # empty value is dangerous depends on the database (an admin
            # name nobody has registered yet), so that decision is made at
            # startup, in main.py, once the database is reachable.
            names = ", ".join(sorted(self.admin_user_set))
            if self.admin_signup_secret:
                _log.info(
                    "ADMIN_SIGNUP_SECRET is set — registering %s requires it.", names
                )
            else:
                _log.warning(
                    "ADMIN_SIGNUP_SECRET is empty. Anyone who reaches this server "
                    "and registers %s first becomes an admin. Set it unless this "
                    "instance is on a trusted network.",
                    names,
                )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
