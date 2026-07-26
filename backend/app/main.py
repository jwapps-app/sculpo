from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Report what was wrong without echoing the payload.

    FastAPI's default handler includes the offending input verbatim, so a
    malformed 40MB body comes straight back as a 40MB error response — work
    the size cap never gets to refuse, since validation fails first."""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": [
                {"loc": e.get("loc", []), "msg": e.get("msg", ""), "type": e.get("type", "")}
                for e in exc.errors()
            ]
        },
    )

@app.middleware("http")
async def reject_oversized_bodies(request: Request, call_next):
    """Refuse too-large uploads on Content-Length, before the body is read.

    The per-project cap is also enforced in the router, but only after the
    whole body has been buffered, parsed into Python objects and validated —
    peaking at several times the payload size in RAM. Checking the declared
    length first means an over-cap request costs almost nothing."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > settings.max_request_bytes:
        return JSONResponse(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            content={"detail": "Request too large."},
        )
    return await call_next(request)


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
