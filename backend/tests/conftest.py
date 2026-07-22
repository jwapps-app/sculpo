import os

os.environ.update(
    ENVIRONMENT="test",
    DEBUG="true",
    DATABASE_URL="sqlite+aiosqlite:///:memory:",
    ALLOWED_EMAILS="allowed@example.com",
    SECRET_KEY="test-secret-key-that-is-long-enough!",
)

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.database import Base, engine
from app.main import app


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture(autouse=True)
async def _schema():
    from app.routers.auth import _REQUESTS

    _REQUESTS.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def sign_in(client: AsyncClient, email: str = "allowed@example.com") -> str:
    r = await client.post("/api/v1/auth/request-link", json={"email": email})
    assert r.status_code == 200
    link = r.json()["dev_magic_link"]
    assert link, "dev link should be surfaced in debug"
    token = link.split("token=")[1]
    r = await client.post("/api/v1/auth/verify", json={"token": token})
    assert r.status_code == 200
    return r.json()["session_token"]
