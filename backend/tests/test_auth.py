
from tests.conftest import sign_in


CREDS = {"username": "john", "password": "correct-horse-9"}


async def test_register_login_roundtrip(client):
    r = await client.post("/api/v1/auth/register", json=CREDS)
    assert r.status_code == 201
    assert r.json()["user"]["username"] == "john"

    r = await client.post("/api/v1/auth/login", json=CREDS)
    assert r.status_code == 200
    token = r.json()["session_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200


async def test_registration_closed_for_unlisted_usernames(client):
    r = await client.post(
        "/api/v1/auth/register", json={"username": "stranger", "password": "whatever-123"}
    )
    assert r.status_code == 403


async def test_duplicate_registration_rejected(client):
    assert (await client.post("/api/v1/auth/register", json=CREDS)).status_code == 201
    # 403 rather than 409: a distinct "already taken" would confirm the name
    # exists, turning registration into a username oracle.
    assert (await client.post("/api/v1/auth/register", json=CREDS)).status_code == 403


async def test_wrong_password_rejected(client):
    await client.post("/api/v1/auth/register", json=CREDS)
    r = await client.post(
        "/api/v1/auth/login", json={"username": "john", "password": "wrong-password-1"}
    )
    assert r.status_code == 401


async def test_login_throttles_after_failures(client):
    await client.post("/api/v1/auth/register", json=CREDS)
    for _ in range(5):
        await client.post(
            "/api/v1/auth/login", json={"username": "john", "password": "wrong-password-1"}
        )
    r = await client.post("/api/v1/auth/login", json=CREDS)
    assert r.status_code == 429


async def test_bad_username_shape_rejected(client):
    r = await client.post(
        "/api/v1/auth/register", json={"username": "John Doe!", "password": "whatever-123"}
    )
    assert r.status_code == 400


async def test_logout_kills_session(client):
    token = await sign_in(client)
    headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 200
    assert (await client.post("/api/v1/auth/logout", headers=headers)).status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401
