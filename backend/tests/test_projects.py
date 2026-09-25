import pytest

from tests.conftest import sign_in

pytestmark = pytest.mark.asyncio

DOC = {"id": "p1", "name": "test", "version": 1, "nodes": {}, "rootOrder": []}


async def auth(client, username="john"):
    return {"Authorization": f"Bearer {await sign_in(client, username)}"}


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


async def test_cross_user_isolation(client):
    h1 = await auth(client, "john")
    h2 = await auth(client, "other")

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


async def test_revision_counts_saves_and_refuses_stale_ones(client):
    """Two devices open the same design at revision 1. The first to save
    wins and moves it to 2; the second, still on 1, is refused with the
    current revision so it can keep its work as a copy rather than
    overwriting the first device's."""
    h = await auth(client)
    r = await client.post("/api/v1/projects", json={"name": "boat", "data": DOC}, headers=h)
    pid = r.json()["id"]
    assert r.json()["revision"] == 1

    first = await client.put(
        f"/api/v1/projects/{pid}",
        json={"name": "boat", "data": {**DOC, "from": "A"}, "expected_revision": 1},
        headers=h,
    )
    assert first.status_code == 200
    assert first.json()["revision"] == 2

    second = await client.put(
        f"/api/v1/projects/{pid}",
        json={"name": "boat", "data": {**DOC, "from": "B"}, "expected_revision": 1},
        headers=h,
    )
    assert second.status_code == 409
    assert second.json()["detail"]["revision"] == 2
    # The first device's work is what is stored.
    assert (await client.get(f"/api/v1/projects/{pid}", headers=h)).json()["data"]["from"] == "A"

    # A save that names no revision still replaces (older clients), and
    # still counts.
    third = await client.put(
        f"/api/v1/projects/{pid}", json={"name": "boat", "data": DOC}, headers=h
    )
    assert third.status_code == 200
    assert third.json()["revision"] == 3
    listed = (await client.get("/api/v1/projects", headers=h)).json()
    assert listed[0]["revision"] == 3


async def test_stale_save_on_foreign_project_is_still_404(client):
    """The conflict branch must not leak whether a foreign id exists."""
    h1 = await auth(client, "john")
    h2 = await auth(client, "other")
    pid = (
        await client.post("/api/v1/projects", json={"name": "mine", "data": DOC}, headers=h1)
    ).json()["id"]
    r = await client.put(
        f"/api/v1/projects/{pid}",
        json={"name": "x", "data": DOC, "expected_revision": 99},
        headers=h2,
    )
    assert r.status_code == 404
