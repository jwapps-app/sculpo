"""Startup must stop a first deployment whose admin name is up for grabs,
and must never stop an established one. The second half is what matters
most: a running instance whose operator never set a signup secret has an
admin already, and refusing to start it locks everyone out for nothing."""

import pytest

from app.config import settings
from app.main import unclaimed_admin_names
from tests.conftest import sign_in

pytestmark = pytest.mark.asyncio


async def test_unclaimed_admin_name_is_reported_until_registered(client):
    assert await unclaimed_admin_names() == {"john"}
    await sign_in(client, "john")
    assert await unclaimed_admin_names() == set()


async def test_established_instance_starts_without_a_signup_secret(client, monkeypatch):
    from app.main import lifespan, app

    await sign_in(client, "john")
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "admin_signup_secret", "")
    monkeypatch.setattr(settings, "allow_open_admin_signup", False)
    async with lifespan(app):
        pass  # started


async def test_fresh_instance_refuses_without_a_signup_secret(monkeypatch):
    from app.main import lifespan, app

    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "admin_signup_secret", "")
    monkeypatch.setattr(settings, "allow_open_admin_signup", False)
    with pytest.raises(RuntimeError, match="not registered yet"):
        async with lifespan(app):
            pass
