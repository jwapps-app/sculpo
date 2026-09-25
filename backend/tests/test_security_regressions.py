"""Regressions for the 2026-07-26 security audit. Each test pins a hole that
was found open, so it cannot quietly reopen."""

import pytest

from app.core.security import hash_password, verify_password
from tests.conftest import sign_in


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


async def test_project_list_does_not_load_data_blobs(client):
    """The list returns four scalars per project. Loading whole rows would drag
    every inline mesh into memory — hundreds of MB for a few-hundred-byte
    response, and an OOM kill on a memory-capped container."""
    import tracemalloc

    h = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    big = {"id": "p", "name": "n", "version": 1, "nodes": {}, "rootOrder": [], "blob": "A" * 1_000_000}
    for i in range(4):
        assert (
            await client.post("/api/v1/projects", json={"name": f"p{i}", "data": big}, headers=h)
        ).status_code == 201

    tracemalloc.start()
    base = tracemalloc.get_traced_memory()[0]
    r = await client.get("/api/v1/projects", headers=h)
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()

    assert r.status_code == 200
    assert len(r.json()) == 4
    grew = peak - base
    # 4MB stored; listing must not allocate anything like that.
    assert grew < 1_000_000, f"list allocated {grew / 1e6:.1f}MB — is it loading data blobs?"


async def test_validation_errors_do_not_echo_the_payload(client):
    """FastAPI's default handler returns the offending input verbatim, so a
    malformed multi-MB body comes straight back as a multi-MB response."""
    h = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    junk = "A" * 200_000
    r = await client.post("/api/v1/projects", json={"name": "x", "data": junk}, headers=h)
    assert r.status_code == 422
    assert len(r.content) < 2_000, f"error response was {len(r.content)} bytes — echoing input?"
    assert junk not in r.text


async def test_oversized_body_refused_before_parsing(client):
    """Rejected on Content-Length, so an over-cap upload costs almost nothing."""
    from app.config import settings

    body = "x" * 2_000
    r = await client.post(
        "/api/v1/projects",
        content=body,
        headers={
            "Content-Type": "application/json",
            "Content-Length": str(settings.max_request_bytes + 1),
        },
    )
    assert r.status_code == 413


async def test_invited_username_cannot_be_claimed_by_a_stranger(client):
    """The hole this closes: an invite used to be a username on a list, and a
    username is guessable. Whoever registered "sarah" first got the account,
    invited or not."""
    admin = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    created = await client.post("/api/v1/admin/invites", json={"username": "sarah"}, headers=admin)
    assert created.status_code == 201
    code = created.json()["code"]

    # A stranger who knows only the username gets nothing.
    for attempt in (None, "", "guessed-code"):
        body = {"username": "sarah", "password": "attacker-pw-1"}
        if attempt is not None:
            body["invite_code"] = attempt
        r = await client.post("/api/v1/auth/register", json=body)
        assert r.status_code == 403, f"invite_code={attempt!r} got in"

    # Sarah, holding the code, registers normally.
    ok = await client.post(
        "/api/v1/auth/register",
        json={"username": "sarah", "password": "sarahs-own-pw-1", "invite_code": code},
    )
    assert ok.status_code == 201


async def test_invite_code_is_single_use(client):
    admin = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    code = (
        await client.post("/api/v1/admin/invites", json={"username": "sarah"}, headers=admin)
    ).json()["code"]
    first = await client.post(
        "/api/v1/auth/register",
        json={"username": "sarah", "password": "sarahs-own-pw-1", "invite_code": code},
    )
    assert first.status_code == 201
    again = await client.post(
        "/api/v1/auth/register",
        json={"username": "sarah", "password": "someone-else-pw", "invite_code": code},
    )
    assert again.status_code == 403


async def test_invite_code_is_not_stored_in_the_clear(client):
    """A database copy must not hand over live invites."""
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import AllowedUsername

    admin = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    code = (
        await client.post("/api/v1/admin/invites", json={"username": "sarah"}, headers=admin)
    ).json()["code"]

    async with SessionLocal() as db:
        row = (await db.execute(select(AllowedUsername))).scalar_one()
    assert row.code_hash and code not in row.code_hash


async def test_expired_invite_is_refused(client):
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import AllowedUsername

    admin = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    code = (
        await client.post("/api/v1/admin/invites", json={"username": "sarah"}, headers=admin)
    ).json()["code"]

    async with SessionLocal() as db:
        row = (await db.execute(select(AllowedUsername))).scalar_one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()

    r = await client.post(
        "/api/v1/auth/register",
        json={"username": "sarah", "password": "sarahs-own-pw-1", "invite_code": code},
    )
    assert r.status_code == 403


async def test_pre_code_invites_fail_closed(client):
    """Rows that predate the migration have no code, so nothing can prove
    ownership of them. They must be refused, not treated as open."""
    from app.database import SessionLocal
    from app.models import AllowedUsername

    async with SessionLocal() as db:
        db.add(AllowedUsername(username="legacy"))
        await db.commit()

    r = await client.post(
        "/api/v1/auth/register", json={"username": "legacy", "password": "whoever-gets-here"}
    )
    assert r.status_code == 403


# ── Second audit (2026-09) ────────────────────────────────────────────────────


async def test_login_throttle_table_is_bounded(client):
    """Keyed by any username a stranger sends; must not grow without limit.
    Rows outside the window are swept on every insert, so however many novel
    names get sprayed, the table holds at most one window's worth."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import func, select

    from app.core import throttle
    from app.database import SessionLocal
    from app.models import LoginFailure

    async with SessionLocal() as db:
        stale = datetime.now(timezone.utc) - throttle.WINDOW - timedelta(seconds=1)
        for i in range(500):
            db.add(LoginFailure(key=f"spray-{i}|1.2.3.4", at=stale))
        await db.commit()

    async with SessionLocal() as db:
        await throttle.record_fail(db, "fresh|1.2.3.4")

    async with SessionLocal() as db:
        n = await db.scalar(select(func.count()).select_from(LoginFailure))
    assert n == 1, f"{n} rows survived the sweep"


async def test_throttle_is_per_address_so_strangers_cannot_lock_you_out(client):
    """Five bad guesses at your username from one address must not stop you
    signing in from another."""
    await client.post("/api/v1/auth/register", json=CREDS)
    attacker = {"X-Real-IP": "203.0.113.9"}
    for _ in range(5):
        await client.post(
            "/api/v1/auth/login",
            json={"username": "john", "password": "wrong-pass-1"},
            headers=attacker,
        )
    # The attacker's address is now shut out...
    r = await client.post("/api/v1/auth/login", json=CREDS, headers=attacker)
    assert r.status_code == 429
    # ...and the real owner, elsewhere, is not.
    r = await client.post(
        "/api/v1/auth/login", json=CREDS, headers={"X-Real-IP": "198.51.100.7"}
    )
    assert r.status_code == 200


async def test_throttle_survives_a_rolled_back_request(client):
    """The failure is recorded even though the request that records it ends
    in a 401 — which rolls back the request's own session."""
    from sqlalchemy import func, select

    from app.database import SessionLocal
    from app.models import LoginFailure

    await client.post("/api/v1/auth/login", json={"username": "ghost", "password": "wrong-pass-1"})
    async with SessionLocal() as db:
        n = await db.scalar(select(func.count()).select_from(LoginFailure))
    # One row per budget: the username-and-address one, and the per-username one.
    assert n == 2


async def test_chunked_body_over_the_cap_is_refused(client):
    """A chunked upload declares no Content-Length, so the up-front check
    cannot see it. It must be cut off as it streams, not after it is parsed."""
    from app.config import settings

    async def firehose():
        chunk = b"x" * 65_536
        sent = 0
        while sent <= settings.max_request_bytes + chunk_len:
            yield chunk
            sent += len(chunk)

    chunk_len = 65_536
    r = await client.post(
        "/api/v1/projects",
        content=firehose(),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 413


def test_login_verifies_with_one_bcrypt(monkeypatch):
    """Login used to verify, then run a second full bcrypt just to ask whether
    the hash was legacy-format. That doubled the cost of every login."""
    import bcrypt as _bcrypt

    from app.core import security

    calls = {"n": 0}
    real = _bcrypt.checkpw

    def counted(*a, **k):
        calls["n"] += 1
        return real(*a, **k)

    monkeypatch.setattr(security.bcrypt, "checkpw", counted)
    h = security.hash_password("correct-horse-battery")
    ok, legacy = security.check_password("correct-horse-battery", h)
    assert ok and not legacy
    assert calls["n"] == 1


async def test_login_purges_that_users_expired_sessions(client):
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import User, UserSession

    await sign_in(client, "john")
    async with SessionLocal() as db:
        user = (await db.execute(select(User).where(User.username == "john"))).scalar_one()
        for i in range(2):
            db.add(
                UserSession(
                    user_id=user.id,
                    token_hash=f"{i:064d}",
                    expires_at=datetime.now(timezone.utc) - timedelta(days=1),
                )
            )
        await db.commit()

    r = await client.post("/api/v1/auth/login", json={"username": "john", "password": "pw-for-john-123"})
    assert r.status_code == 200

    async with SessionLocal() as db:
        rows = (await db.execute(select(UserSession).where(UserSession.user_id == user.id))).scalars().all()
    assert all(s.expires_at.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc) for s in rows), (
        "expired sessions survived login"
    )


async def test_saves_do_not_echo_the_project_back(client):
    """The client holds the data it just sent; returning it doubled the bytes
    and serialisation time of every save."""
    h = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    doc = {"id": "p", "name": "n", "version": 1, "nodes": {}, "rootOrder": [], "pad": "x" * 50_000}
    created = await client.post("/api/v1/projects", json={"name": "p", "data": doc}, headers=h)
    assert created.status_code == 201
    assert "data" not in created.json()
    assert len(created.content) < 1_000

    updated = await client.put(
        f"/api/v1/projects/{created.json()['id']}", json={"name": "p2", "data": doc}, headers=h
    )
    assert updated.status_code == 200
    assert "data" not in updated.json()
    # ...but a real read still returns it.
    got = await client.get(f"/api/v1/projects/{created.json()['id']}", headers=h)
    assert got.json()["data"] == doc


async def test_thumbnail_write_does_not_count_as_an_edit(client):
    """A preview refresh must not reshuffle the library's last-touched order."""
    import base64

    h = {"Authorization": f"Bearer {await sign_in(client, 'john')}"}
    r = await client.post(
        "/api/v1/projects",
        json={"name": "p", "data": {"id": "p", "name": "p", "version": 1, "nodes": {}, "rootOrder": []}},
        headers=h,
    )
    pid = r.json()["id"]
    before = r.json()["updated_at"]

    png = base64.b64encode(
        bytes.fromhex(
            "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
            "1f15c4890000000a49444154789c63000100000500010d0a2db4"
            "0000000049454e44ae426082"
        )
    ).decode()
    put = await client.put(
        f"/api/v1/projects/{pid}/thumbnail", json={"image": f"data:image/png;base64,{png}"}, headers=h
    )
    assert put.status_code == 204

    from datetime import datetime, timezone

    def instant(iso: str) -> datetime:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)

    after = (await client.get("/api/v1/projects", headers=h)).json()[0]
    assert instant(after["updated_at"]) == instant(before)
    assert after["thumbnail_at"] is not None


async def test_client_sent_forwarding_headers_do_not_get_a_fresh_throttle_bucket(client):
    """nginx hands the app one address header it worked out itself; the
    headers a client can send must not be believed. Five failures, then a
    sixth with a made-up CF-Connecting-IP and X-Forwarded-For, must still be
    refused — the address did not change."""
    await sign_in(client, "john")
    bad = {"username": "john", "password": "definitely-wrong-pw"}
    for _ in range(5):
        assert (await client.post("/api/v1/auth/login", json=bad)).status_code == 401
    forged = {"CF-Connecting-IP": "203.0.113.77", "X-Forwarded-For": "198.51.100.5"}
    assert (await client.post("/api/v1/auth/login", json=bad, headers=forged)).status_code == 429


async def test_old_password_login_cannot_outlive_a_concurrent_password_change(client, monkeypatch):
    """A login that has already read the old password hash, and finishes
    after the password was changed, gets a session — but one that is dead
    on arrival, because the change bumped the credential version."""
    import asyncio

    from app.routers import auth as auth_module

    token = await sign_in(client, "john")
    creds = {"username": "john", "password": "pw-for-john-123"}

    gate = asyncio.Event()
    real_check = auth_module.check_password

    async def slow_check(password, stored):
        # Hold the racing login here: it has read the hash, not yet issued.
        await gate.wait()
        return real_check(password, stored)

    async def to_thread(fn, *args):
        if fn is real_check:
            return await slow_check(*args)
        return fn(*args)

    monkeypatch.setattr(auth_module.asyncio, "to_thread", to_thread)
    racing = asyncio.create_task(client.post("/api/v1/auth/login", json=creds))
    await asyncio.sleep(0.05)

    changed = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "pw-for-john-123", "new_password": "new-pw-for-john-123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert changed.status_code == 200
    gate.set()
    late = await racing
    assert late.status_code == 200  # the login itself succeeded, as it did before
    stale = late.json()["session_token"]
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {stale}"})
    assert r.status_code == 401, "a session issued against the old password stayed valid"
    # The session the change handed back is the one that works.
    fresh = changed.json()["session_token"]
    assert (
        await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {fresh}"})
    ).status_code == 200


def test_wrong_password_costs_the_same_for_missing_and_existing_users(monkeypatch):
    """The legacy-hash fallback ran a second bcrypt only for accounts that
    exist, so a wrong password took twice as long on a real username: a
    timing tell for which usernames exist."""
    import bcrypt

    from app.core import security

    calls: list[int] = []
    real = bcrypt.checkpw

    def counting(pw, hashed):
        calls.append(1)
        return real(pw, hashed)

    monkeypatch.setattr(security.bcrypt, "checkpw", counting)
    stored = security.hash_password("right-password-1")
    security.check_password("wrong-password-1", stored)
    existing = len(calls)
    calls.clear()
    security.check_password("wrong-password-1", None)
    assert len(calls) == existing == 2


async def test_unicode_admin_signup_secret_is_refused_not_a_500(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "admin_signup_secret", "s3cret-bootstrap-value")
    r = await client.post(
        "/api/v1/auth/register",
        json={"username": "john", "password": "pw-for-john-123", "admin_secret": "é-guess-é"},
    )
    assert r.status_code == 403
    monkeypatch.setattr(settings, "admin_signup_secret", "clé-secrète-é")
    r = await client.post(
        "/api/v1/auth/register",
        json={"username": "john", "password": "pw-for-john-123", "admin_secret": "clé-secrète-é"},
    )
    assert r.status_code == 201
