"""Deploy-configuration regressions: misconfigured stacks must fail loudly at
startup, never silently lock everyone out at runtime."""

import pytest

from app.config import Settings


def make(**overrides) -> Settings:
    base = dict(
        environment="production",
        ADMIN_USERS="john",  # the field is addressed by its env alias
        admin_signup_secret="a-real-value",
        _env_file=None,  # ignore the local .env
    )
    base.update(overrides)
    return Settings(**base)


def test_production_requires_admin_users():
    with pytest.raises(RuntimeError, match="ADMIN_USERS"):
        make(ADMIN_USERS="").validate_production()


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


def test_empty_admin_signup_secret_warns_at_startup(caplog):
    """An empty value is indistinguishable from a set one in a compose file,
    and the difference decides who can claim the admin account. Boot has to
    say which it is. Whether to refuse is decided against the database, in
    main.py — see test_startup."""
    with caplog.at_level("WARNING", logger="sculpo.config"):
        make(admin_signup_secret="").validate_production()
    assert "ADMIN_SIGNUP_SECRET is empty" in caplog.text
    # Names the account at stake, so the warning is actionable.
    assert "john" in caplog.text


def test_set_admin_signup_secret_is_confirmed_at_startup(caplog):
    with caplog.at_level("INFO", logger="sculpo.config"):
        make(admin_signup_secret="a-real-value").validate_production()
    joined = caplog.text
    assert "ADMIN_SIGNUP_SECRET is set" in joined
    # Never log the value itself.
    assert "a-real-value" not in joined
