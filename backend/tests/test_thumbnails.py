"""Project thumbnails. The server stores bytes the client rendered and never
inspects them — all geometry stays client-side."""

import base64

import pytest

from tests.conftest import sign_in


# A 1x1 PNG — enough to prove the round trip without pulling in an image lib.
PNG = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
        "1f15c4890000000a49444154789c63000100000500010d0a2db4"
        "0000000049454e44ae426082"
    )
).decode()
DATA_URL = f"data:image/png;base64,{PNG}"


async def _project(client, headers, name="thing") -> str:
    r = await client.post(
        "/api/v1/projects",
        json={"name": name, "data": {"id": "p", "name": name, "version": 1, "nodes": {}, "rootOrder": []}},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_thumbnail_round_trip(client):
    h = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    pid = await _project(client, h)

    assert (await client.get(f"/api/v1/projects/{pid}/thumbnail", headers=h)).status_code == 404

    put = await client.put(
        f"/api/v1/projects/{pid}/thumbnail", json={"image": DATA_URL}, headers=h
    )
    assert put.status_code == 204

    got = await client.get(f"/api/v1/projects/{pid}/thumbnail", headers=h)
    assert got.status_code == 200
    assert got.headers["content-type"] == "image/png"
    assert got.content == base64.b64decode(PNG)


async def test_list_reports_the_thumbnail_without_carrying_it(client):
    """The list must stay a metadata-only query — the picture is fetched per
    project so a library of 200 designs is not one enormous response."""
    h = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    pid = await _project(client, h)

    before = (await client.get("/api/v1/projects", headers=h)).json()[0]
    assert before["thumbnail_at"] is None

    await client.put(f"/api/v1/projects/{pid}/thumbnail", json={"image": DATA_URL}, headers=h)
    after = (await client.get("/api/v1/projects", headers=h)).json()[0]
    assert after["thumbnail_at"] is not None
    # The bytes themselves must not appear anywhere in the listing.
    assert PNG[:32] not in (await client.get("/api/v1/projects", headers=h)).text


async def test_thumbnail_is_owner_scoped(client):
    owner = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    pid = await _project(client, owner)
    await client.put(f"/api/v1/projects/{pid}/thumbnail", json={"image": DATA_URL}, headers=owner)

    stranger = {"Authorization": f"Bearer {await sign_in(client, 'mallory')}"}
    assert (
        await client.get(f"/api/v1/projects/{pid}/thumbnail", headers=stranger)
    ).status_code == 404
    assert (
        await client.put(
            f"/api/v1/projects/{pid}/thumbnail", json={"image": DATA_URL}, headers=stranger
        )
    ).status_code == 404


async def test_oversized_thumbnail_refused(client):
    from app.config import settings

    h = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    pid = await _project(client, h)
    big = base64.b64encode(b"x" * (settings.max_thumbnail_bytes + 1)).decode()
    r = await client.put(
        f"/api/v1/projects/{pid}/thumbnail",
        json={"image": f"data:image/png;base64,{big}"},
        headers=h,
    )
    assert r.status_code == 413


@pytest.mark.parametrize(
    "image",
    [
        "not-a-data-url",
        "data:text/html;base64,PHNjcmlwdD4=",  # not an image
        "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",  # SVG can carry script
        "data:image/png;base64,@@@@not-base64@@@@",
    ],
)
async def test_only_real_raster_data_urls_are_accepted(client, image):
    h = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    pid = await _project(client, h)
    r = await client.put(
        f"/api/v1/projects/{pid}/thumbnail", json={"image": image}, headers=h
    )
    # 400 from the format check, or 422 when the value is too short to reach
    # it — either way it is refused, which is the property under test.
    assert r.status_code in (400, 422), f"accepted {image[:40]!r}"
