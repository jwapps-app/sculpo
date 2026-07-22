FROM python:3.12-slim

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini entrypoint.sh ./
RUN chmod +x entrypoint.sh && useradd -r -u 10001 appuser
USER appuser

EXPOSE 8000
CMD ["./entrypoint.sh"]
