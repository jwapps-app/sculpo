#!/bin/sh
set -e
alembic upgrade head
# Two workers so a large project save — which FastAPI parses synchronously
# on that worker's event loop — does not freeze the whole API while it does.
# The login throttle lives in Postgres, so it is shared between them.
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
