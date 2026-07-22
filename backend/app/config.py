from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

_PLACEHOLDER_SECRETS = {"dev-secret-change-me", "changeme", "secret", ""}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Sculpo"
    environment: str = "production"
    debug: bool = False
    database_url: str = "postgresql+asyncpg://app:app@db:5432/app"
    secret_key: str = "dev-secret-change-me"
    allowed_origins: str = ""
    app_url: str = "http://localhost:5199"

    # Comma-separated admin usernames. Admins can always register and manage
    # other users from the UI; everyone else needs an invite created there.
    admin_users: str = ""

    session_ttl_days: int = 90

    # Hard cap on a stored project's serialized size (imported meshes ride
    # inside the JSON).
    max_project_bytes: int = 15_000_000
    max_projects_per_user: int = 200

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
