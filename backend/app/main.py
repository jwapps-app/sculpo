from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.routers import admin, auth, projects


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_production()
    yield
    await engine.dispose()


app = FastAPI(title=settings.app_name, lifespan=lifespan, docs_url=None, redoc_url=None)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # Auth is a bearer token, never a cookie, so the browser never needs to
        # send credentials cross-origin. Allowing them would only widen what a
        # hostile page could attempt.
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    """Liveness. Deliberately does not touch the database: this endpoint is
    unauthenticated, so a database round trip here would let anyone exhaust the
    connection pool by hammering it. The clients that call this only need to
    know a Sculpo server is on the other end."""
    return {"status": "ok"}


@app.get("/api/v1/health/ready")
async def readiness() -> dict[str, str]:
    """Readiness, including the database — for the operator, not the public."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
