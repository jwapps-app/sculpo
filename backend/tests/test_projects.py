import pytest

from tests.conftest import sign_in

pytestmark = pytest.mark.asyncio

DOC = {"id": "p1", "name": "test", "version": 1, "nodes": {}, "rootOrder": []}


async def auth(client, email="allowed@example.com"):
    return {"Authorization": f"Bearer {await sign_in(client, email)}"}


async def test_requires_auth(client):
    assert (await client.get("/api/v1/projects")).status_code in (401, 403)


async def test_crud_roundtrip(client):
    h = await auth(client)
    r = await client.post("/api/v1/projects", json={"name": "boat", "data": DOC}, headers=h)
    assert r.status_code == 201
    pid = r.json()["id"]

    r = await client.get(f"/api/v1/projects/{pid}", headers=h)
    assert r.status_code == 200
    assert r.json()["data"] == DOC

    r = await client.put(
        f"/api/v1/projects/{pid}", json={"name": "boat2", "data": DOC}, headers=h
    )
    assert r.status_code == 200
    assert r.json()["name"] == "boat2"

    assert (await client.delete(f"/api/v1/projects/{pid}", headers=h)).status_code == 204
    assert (await client.get(f"/api/v1/projects/{pid}", headers=h)).status_code == 404


async def test_cross_user_isolation(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(
        type(settings),
        "allowed_email_set",
        property(lambda self: {"allowed@example.com", "other@example.com"}),
    )
    h1 = await auth(client, "allowed@example.com")
    h2 = await auth(client, "other@example.com")

    pid = (
        await client.post("/api/v1/projects", json={"name": "mine", "data": DOC}, headers=h1)
    ).json()["id"]

    # Another user's id reads as missing — get, update, and delete alike.
    assert (await client.get(f"/api/v1/projects/{pid}", headers=h2)).status_code == 404
    assert (
        await client.put(f"/api/v1/projects/{pid}", json={"name": "x", "data": DOC}, headers=h2)
    ).status_code == 404
    assert (await client.delete(f"/api/v1/projects/{pid}", headers=h2)).status_code == 404
    # And the owner's list is untouched by the other user.
    assert len((await client.get("/api/v1/projects", headers=h2)).json()) == 0


async def test_oversized_project_rejected(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "max_project_bytes", 500)
    h = await auth(client)
    big = {**DOC, "blob": "x" * 1000}
    r = await client.post("/api/v1/projects", json={"name": "big", "data": big}, headers=h)
    assert r.status_code == 413
