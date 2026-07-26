import os
from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_PLACEHOLDER_SECRETS = {"dev-secret-change-me", "changeme", "secret", ""}

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
    debug: bool = False
    database_url: str = "postgresql+asyncpg://app:app@db:5432/app"
    secret_key: str = "dev-secret-change-me"
    allowed_origins: str = ""
    app_url: str = "http://localhost:5199"

    # Comma-separated admin usernames. Admins can always register and manage
    # other users from the UI; everyone else needs an invite created there.
    # ALLOWED_USERS is accepted as a legacy alias so stacks configured before
    # the rename keep working.
    admin_users: str = Field(
        default="",
        validation_alias=AliasChoices("ADMIN_USERS", "ALLOWED_USERS"),
    )

    session_ttl_days: int = 90

    # Optional shared secret that must accompany registration of an admin
    # username. Without it, whoever reaches a public instance first can claim
    # the admin name and own the instance. Unset = no extra check (fine on a
    # LAN-only or Access-gated deployment).
    admin_signup_secret: str = ""

    # Hard cap on a stored project's serialized size (imported meshes ride
    # inside the JSON; full-resolution imports can be tens of MB).
    max_project_bytes: int = 50_000_000
    max_projects_per_user: int = 200

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
            if len(self.secret_key) < 32 or self.secret_key in _PLACEHOLDER_SECRETS:
                raise RuntimeError(
                    "Refusing to start: SECRET_KEY is missing or a placeholder. "
                    "Set a strong 32+ character secret."
                )
            if not self.admin_user_set:
                raise RuntimeError(
                    "Refusing to start: ADMIN_USERS is empty — nobody would be able "
                    "to sign in. Set at least one admin username."
                )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
