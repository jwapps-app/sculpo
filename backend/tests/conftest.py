import os

os.environ.update(
    # Makes Settings ignore the developer's .env so the suite is hermetic.
    SCULPO_TEST="1",
    ENVIRONMENT="test",
    # In-memory SQLite by default: fast, no services. CI also runs the whole
    # suite against PostgreSQL (TEST_DATABASE_URL), which is what production
    # runs and the only place row locks and real concurrency mean anything.
    DATABASE_URL=os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:"),
    ADMIN_USERS="john",
    ADMIN_SIGNUP_SECRET="",
)

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from sqlalchemy import event

from app.database import Base, engine
from app.main import app


# SQLite does not enforce foreign keys unless asked, per connection. Without
# this, the cascades the models declare are never exercised here, and a test
# could pass on a delete that Postgres would refuse or cascade differently.
@event.listens_for(engine.sync_engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, _record):
    if engine.dialect.name != "sqlite":
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture(autouse=True)
async def _schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    # Each test runs on its own event loop; a pooled connection made on the
    # previous one cannot be used on this one (asyncpg refuses). Start each
    # test with an empty pool.
    await engine.dispose()


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def sign_in(client: AsyncClient, username: str = "john") -> str:
    creds = {"username": username, "password": f"pw-for-{username}-123"}
    r = await client.post("/api/v1/auth/register", json=creds)
    # Registration refusals are deliberately indistinguishable (they must not
    # reveal which usernames exist), so on any refusal try logging in first —
    # that tells us whether the account already existed.
    if r.status_code in (403, 409):
        login = await client.post("/api/v1/auth/login", json=creds)
        if login.status_code == 200:
            return login.json()["session_token"]
        if username != "john":
            admin = await sign_in(client, "john")
            inv = await client.post(
                "/api/v1/admin/invites",
                json={"username": username},
                headers={"Authorization": f"Bearer {admin}"},
            )
            assert inv.status_code == 201, inv.text
            # An invite is only good with its code — the username alone is not
            # a credential.
            r = await client.post(
                "/api/v1/auth/register", json={**creds, "invite_code": inv.json()["code"]}
            )
    assert r.status_code in (200, 201), r.text
    return r.json()["session_token"]
