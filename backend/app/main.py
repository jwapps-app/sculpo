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

class BodySizeLimit:
    """Refuse over-cap uploads before they are buffered, parsed and validated —
    a path that peaks at several times the payload size in RAM.

    A declared Content-Length is checked up front, so an honest over-cap
    request costs almost nothing. A chunked body declares nothing, so it is
    counted as it streams and cut off the moment it passes the cap. nginx
    enforces the same ceiling at the edge; this is what holds if anything
    ever reaches the app another way.

    The cut-off cannot be an exception: FastAPI turns anything raised while it
    reads the body into a generic 400. So the 413 is sent from inside
    `receive` itself — the app is still reading, so nothing has been sent
    yet — and the app is then told the client went away, which unwinds it
    cleanly. Whatever it tries to send after that is dropped."""

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        for name, value in scope.get("headers", []):
            if name == b"content-length" and value.isdigit() and int(value) > self.max_bytes:
                return await self._refuse(send)

        seen = 0
        refused = False

        async def counting_receive():
            nonlocal seen, refused
            if refused:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    refused = True
                    await self._refuse(send)
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message):
            if not refused:
                await send(message)

        await self.app(scope, counting_receive, guarded_send)

    @staticmethod
    async def _refuse(send):
        body = b'{"detail":"Request too large."}'
        await send({
            "type": "http.response.start",
            "status": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": body})


app.add_middleware(BodySizeLimit, max_bytes=settings.max_request_bytes)


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
