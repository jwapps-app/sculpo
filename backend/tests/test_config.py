"""Deploy-configuration regressions: misconfigured stacks must fail loudly at
startup, never silently lock everyone out at runtime."""

import pytest

from app.config import Settings


def make(**overrides) -> Settings:
    base = dict(
        environment="production",
        secret_key="a-perfectly-long-and-random-secret-key!",
        ADMIN_USERS="john",  # the field is addressed by its env alias
        _env_file=None,  # ignore the local .env
    )
    base.update(overrides)
    return Settings(**base)


def test_production_requires_admin_users():
    with pytest.raises(RuntimeError, match="ADMIN_USERS"):
        make(ADMIN_USERS="").validate_production()


def test_production_requires_strong_secret():
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        make(secret_key="short").validate_production()


def test_valid_production_config_passes():
    make().validate_production()


def test_legacy_allowed_users_env_still_works(monkeypatch):
    monkeypatch.delenv("ADMIN_USERS", raising=False)
    monkeypatch.setenv("ALLOWED_USERS", "john,jane")
    s = Settings(_env_file=None)
    assert s.admin_user_set == {"john", "jane"}


def test_admin_users_env_wins(monkeypatch):
    monkeypatch.setenv("ADMIN_USERS", "john")
    s = Settings(_env_file=None)
    assert s.admin_user_set == {"john"}
