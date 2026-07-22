import pytest

from tests.conftest import sign_in

pytestmark = pytest.mark.asyncio


async def test_unknown_email_gets_identical_response(client):
    ok = await client.post("/api/v1/auth/request-link", json={"email": "allowed@example.com"})
    bad = await client.post("/api/v1/auth/request-link", json={"email": "stranger@example.com"})
    assert ok.status_code == bad.status_code == 200
    assert ok.json()["message"] == bad.json()["message"]
    # The stranger never gets a link, even in debug.
    assert bad.json()["dev_magic_link"] is None


async def test_magic_link_is_single_use(client):
    r = await client.post("/api/v1/auth/request-link", json={"email": "allowed@example.com"})
    token = r.json()["dev_magic_link"].split("token=")[1]
    first = await client.post("/api/v1/auth/verify", json={"token": token})
    second = await client.post("/api/v1/auth/verify", json={"token": token})
    assert first.status_code == 200
    assert second.status_code == 400


async def test_garbage_token_rejected(client):
    r = await client.post("/api/v1/auth/verify", json={"token": "not-a-real-token-at-all"})
    assert r.status_code == 400


async def test_request_link_throttles(client):
    for _ in range(5):
        await client.post("/api/v1/auth/request-link", json={"email": "allowed@example.com"})
    r = await client.post("/api/v1/auth/request-link", json={"email": "allowed@example.com"})
    assert r.status_code == 200
    assert r.json()["dev_magic_link"] is None  # throttled: no link issued


async def test_logout_kills_session(client):
    token = await sign_in(client)
    headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 200
    assert (await client.post("/api/v1/auth/logout", headers=headers)).status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401
