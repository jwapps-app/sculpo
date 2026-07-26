"""Regressions for the 2026-07-26 security audit. Each test pins a hole that
was found open, so it cannot quietly reopen."""

import pytest

from app.core.security import hash_password, verify_password
from tests.conftest import sign_in

pytestmark = pytest.mark.asyncio

CREDS = {"username": "john", "password": "correct-horse-9"}


async def test_admin_name_needs_the_signup_secret(client, monkeypatch):
    """Land-grab: without this, whoever registers the ADMIN_USERS name first
    becomes admin — on a public instance, a stranger."""
    from app.config import settings

    monkeypatch.setattr(settings, "admin_signup_secret", "s3cret-bootstrap-value")

    stranger = await client.post(
        "/api/v1/auth/register", json={"username": "john", "password": "attacker-pw-1"}
    )
    assert stranger.status_code == 403

    wrong = await client.post(
        "/api/v1/auth/register",
        json={"username": "john", "password": "attacker-pw-1", "admin_secret": "guess"},
    )
    assert wrong.status_code == 403

    right = await client.post(
        "/api/v1/auth/register",
        json={
            "username": "john",
            "password": "real-admin-pw-1",
            "admin_secret": "s3cret-bootstrap-value",
        },
    )
    assert right.status_code == 201
    assert right.json()["user"]["is_admin"] is True


async def test_registration_does_not_reveal_which_usernames_exist(client):
    """Every refusal must look alike, or /register becomes a username oracle."""
    await client.post("/api/v1/auth/register", json=CREDS)

    taken = await client.post("/api/v1/auth/register", json=CREDS)
    unknown = await client.post(
        "/api/v1/auth/register", json={"username": "nobody-here", "password": "whatever-12"}
    )
    assert taken.status_code == unknown.status_code == 403
    assert taken.json()["detail"] == unknown.json()["detail"]


async def test_long_passphrase_is_accepted_not_a_500(client):
    """bcrypt rejects >72 bytes outright; unhandled, that's an unauthenticated
    500 and long passphrases can't register at all."""
    long_pw = "correct horse battery staple " * 4  # ~116 bytes
    r = await client.post(
        "/api/v1/auth/register", json={"username": "john", "password": long_pw}
    )
    assert r.status_code == 201

    ok = await client.post("/api/v1/auth/login", json={"username": "john", "password": long_pw})
    assert ok.status_code == 200

    # A different long password sharing the first 72 bytes must NOT authenticate.
    near = long_pw[:72] + "-different-tail"
    bad = await client.post("/api/v1/auth/login", json={"username": "john", "password": near})
    assert bad.status_code == 401


async def test_changing_password_revokes_other_sessions(client):
    """Changing a password is how a user evicts a token thief."""
    token_a = await sign_in(client, "john")
    token_b = (
        await client.post(
            "/api/v1/auth/login", json={"username": "john", "password": "pw-for-john-123"}
        )
    ).json()["session_token"]
    hb = {"Authorization": f"Bearer {token_b}"}
    assert (await client.get("/api/v1/auth/me", headers=hb)).status_code == 200

    changed = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "pw-for-john-123", "new_password": "brand-new-pass-9"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert changed.status_code == 200

    # The other session is dead; the caller received a working replacement.
    assert (await client.get("/api/v1/auth/me", headers=hb)).status_code == 401
    fresh = {"Authorization": f"Bearer {changed.json()['session_token']}"}
    assert (await client.get("/api/v1/auth/me", headers=fresh)).status_code == 200


async def test_change_password_is_throttled(client):
    token = await sign_in(client, "john")
    h = {"Authorization": f"Bearer {token}"}
    for _ in range(5):
        await client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "wrong-guess-11", "new_password": "irrelevant-99"},
            headers=h,
        )
    r = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "wrong-guess-12", "new_password": "irrelevant-99"},
        headers=h,
    )
    assert r.status_code == 429


async def test_case_variation_cannot_bypass_the_login_throttle(client):
    await client.post("/api/v1/auth/register", json=CREDS)
    for name in ["john", "John", "JOHN", "jOhN", "JoHn"]:
        await client.post(
            "/api/v1/auth/login", json={"username": name, "password": "wrong-pass-1"}
        )
    for name in ["john", "JOHN"]:
        r = await client.post("/api/v1/auth/login", json={"username": name, "password": CREDS["password"]})
        assert r.status_code == 429, f"{name} bypassed the throttle"


def test_empty_hash_never_authenticates():
    """An empty column value must not fall through to the dummy hash."""
    assert verify_password("anything-at-all", "") is False
    assert verify_password("anything-at-all", None) is False


def test_password_round_trip():
    h = hash_password("a-perfectly-fine-password")
    assert verify_password("a-perfectly-fine-password", h) is True
    assert verify_password("not-the-password", h) is False


def test_legacy_hashes_still_verify():
    """Accounts created before pre-hashing must keep working."""
    import bcrypt

    legacy = bcrypt.hashpw(b"old-format-password", bcrypt.gensalt()).decode()
    assert verify_password("old-format-password", legacy) is True
    assert verify_password("wrong", legacy) is False


async def test_health_does_not_touch_the_database(client, monkeypatch):
    """Unauthenticated + DB round trip = anyone can exhaust the pool by
    hammering an endpoint that needs no credentials."""
    from app import main

    class NoDatabase:
        def connect(self):
            raise AssertionError("health must not open a database connection")

    # The route resolves `engine` from the module at call time, so swapping the
    # whole object is what proves the endpoint never reaches for the database.
    monkeypatch.setattr(main, "engine", NoDatabase())
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

    # Readiness is the one that may check the database.
    with pytest.raises(AssertionError):
        await client.get("/api/v1/health/ready")
