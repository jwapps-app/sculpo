import pytest

from tests.conftest import sign_in

pytestmark = pytest.mark.asyncio


async def admin_headers(client):
    return {"Authorization": f"Bearer {await sign_in(client, 'john')}"}


async def test_admin_endpoints_require_admin(client):
    h = {"Authorization": f"Bearer {await sign_in(client, 'guest')}"}
    assert (await client.get("/api/v1/admin/users", headers=h)).status_code == 403
    assert (
        await client.post("/api/v1/admin/invites", json={"username": "x-1"}, headers=h)
    ).status_code == 403


async def test_invite_flow(client):
    h = await admin_headers(client)
    r = await client.post("/api/v1/admin/invites", json={"username": "friend"}, headers=h)
    assert r.status_code == 201
    assert "friend" in r.json()["invited"]

    # The invited user registers with their own password; invite is consumed.
    r = await client.post(
        "/api/v1/auth/register", json={"username": "friend", "password": "friend-pass-1"}
    )
    assert r.status_code == 201
    assert r.json()["user"]["is_admin"] is False

    overview = (await client.get("/api/v1/admin/users", headers=h)).json()
    assert "friend" in [u["username"] for u in overview["users"]]
    assert overview["invited"] == []


async def test_revoked_invite_blocks_registration(client):
    h = await admin_headers(client)
    await client.post("/api/v1/admin/invites", json={"username": "brief"}, headers=h)
    await client.delete("/api/v1/admin/invites/brief", headers=h)
    r = await client.post(
        "/api/v1/auth/register", json={"username": "brief", "password": "whatever-123"}
    )
    assert r.status_code == 403


async def test_delete_user_removes_their_data(client):
    h = await admin_headers(client)
    guest_token = await sign_in(client, "guest")
    gh = {"Authorization": f"Bearer {guest_token}"}
    await client.post(
        "/api/v1/projects",
        json={"name": "doomed", "data": {"id": "p", "name": "d", "version": 1, "nodes": {}, "rootOrder": []}},
        headers=gh,
    )
    overview = (await client.get("/api/v1/admin/users", headers=h)).json()
    guest_id = next(u["id"] for u in overview["users"] if u["username"] == "guest")

    r = await client.delete(f"/api/v1/admin/users/{guest_id}", headers=h)
    assert r.status_code == 200
    # Their session dies with them.
    assert (await client.get("/api/v1/auth/me", headers=gh)).status_code == 401


async def test_admin_cannot_delete_self(client):
    h = await admin_headers(client)
    me = (await client.get("/api/v1/auth/me", headers=h)).json()
    assert (await client.delete(f"/api/v1/admin/users/{me['id']}", headers=h)).status_code == 400


async def test_change_password(client):
    token = await sign_in(client, "john")
    h = {"Authorization": f"Bearer {token}"}
    r = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "pw-for-john-123", "new_password": "brand-new-pass-9"},
        headers=h,
    )
    assert r.status_code == 204
    assert (
        await client.post(
            "/api/v1/auth/login", json={"username": "john", "password": "pw-for-john-123"}
        )
    ).status_code == 401
    assert (
        await client.post(
            "/api/v1/auth/login", json={"username": "john", "password": "brand-new-pass-9"}
        )
    ).status_code == 200
