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

    # Comma-separated emails allowed to sign in. Empty = nobody (locked).
    allowed_emails: str = ""

    magic_link_ttl_minutes: int = 15
    session_ttl_days: int = 90

    # SMTP for magic-link delivery. Unset host + debug=true surfaces the link
    # in the API response instead (dev only).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    # Hard cap on a stored project's serialized size (imported meshes ride
    # inside the JSON).
    max_project_bytes: int = 15_000_000
    max_projects_per_user: int = 200

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def allowed_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}

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
